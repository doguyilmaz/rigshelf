import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readText } from './detect';
import type { Plan } from './model';
import { rootIdentity, syncOwnership } from './ownership';
import { syncInstallations, writeChange } from './plan-io';
import { planFile } from './plan-limits';
import { assertWritePath, checkedProject, hash, now } from './safety';
import type { Store } from './store';

async function clearStaleLock(projectPath: string, planId: string): Promise<void> {
  const path = await assertWritePath(projectPath, '.kitfold-write.lock');
  const text = await readText(path, 4096);
  if (text === undefined) return;
  if (!text)
    throw new Error(
      'The write lock is empty. Inspect it manually; recovery cannot verify its owner.',
    );
  const lock = JSON.parse(text) as { pid: number; planId: string };
  if (!Number.isInteger(lock.pid) || lock.pid <= 0 || lock.planId !== planId)
    throw new Error('Lock ownership could not be verified. Inspect the lock manually.');
  let active = true;
  try {
    process.kill(lock.pid, 0);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') active = false;
  }
  if (active)
    throw new Error('The lock belongs to a running process. Recovery will not interrupt it.');
  await unlink(path);
}

async function changedFiles(plan: Plan, direction: 'apply' | 'rollback') {
  const changed = [];
  for (const change of plan.changes) {
    const path = await assertWritePath(plan.projectPath, change.path);
    const bytes = await planFile(path);
    const current = bytes ? hash(bytes) : null;
    const afterHash = change.after === null ? null : hash(Buffer.from(change.after, 'base64'));
    if (current !== change.beforeHash && current !== afterHash)
      throw new Error(`Recovery conflict: ${change.path}. Later edits were preserved.`);
    const baseline = direction === 'apply' ? change.beforeHash : afterHash;
    if (current !== baseline) changed.push(change);
  }
  return changed;
}

export async function recoverPlan(store: Store, id: string): Promise<Plan> {
  const plan = store.get<Plan>('plan', id);
  const journal = store.get<{ id: string; state: string; direction: 'apply' | 'rollback' }>(
    'journal',
    id,
  );
  if (
    !plan ||
    !journal ||
    !['writing', 'needs-recovery'].includes(journal.state) ||
    !['apply', 'rollback'].includes(journal.direction)
  )
    throw new Error('No interrupted operation to recover. Use rollback for a completed setup.');
  await checkedProject(plan.projectPath);
  if (
    plan.rootIdentity !== undefined &&
    plan.rootIdentity !== (await rootIdentity(plan.projectPath))
  )
    throw new Error('Project root changed. Recovery will not write into a replacement directory.');
  await clearStaleLock(plan.projectPath, id);
  const lockPath = join(plan.projectPath, '.kitfold-write.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, planId: id, direction: 'recover' }));
    const changed = await changedFiles(plan, journal.direction);
    for (const change of changed.reverse())
      await writeChange(plan, change, journal.direction === 'apply' ? 'rollback' : 'apply');
    await syncOwnership(store, plan, journal.direction === 'apply' ? 'rollback' : 'apply');
    plan.status = journal.direction === 'apply' ? 'planned' : 'applied';
    await syncInstallations(store, plan);
    store.put('plan', plan);
    store.put('journal', { ...journal, state: 'recovered', completedAt: now() });
    store.event('recovery.completed', `Restored the state before interruption: ${id}`);
    return plan;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
