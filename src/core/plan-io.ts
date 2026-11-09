import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { detectProject } from './detect';
import { parseKit, readKit } from './kit';
import { checkedMcpDefinition } from './mcp-definition';
import type { Change, Plan } from './model';
import { rootIdentity, syncOwnership } from './ownership';
import { planFile } from './plan-limits';
import { projectMcpFile } from './project-config';
import { preserveProjectInventory } from './project-inventory';
import { adapter } from './providers';
import { assertWritePath, checkedProject, hash, now, safeRelative, slug } from './safety';
import type { Store } from './store';

async function verifyChanges(plan: Plan, direction: 'apply' | 'rollback'): Promise<void> {
  await checkedProject(plan.projectPath);
  if (
    plan.rootIdentity !== undefined &&
    plan.rootIdentity !== (await rootIdentity(plan.projectPath))
  )
    throw new Error('Project root changed during the operation. Create a new plan.');
  for (const change of plan.changes) {
    const path = await assertWritePath(plan.projectPath, change.path);
    const bytes = await planFile(path);
    const actual = bytes ? hash(bytes) : null;
    const expected =
      direction === 'apply'
        ? change.beforeHash
        : change.after === null
          ? null
          : hash(Buffer.from(change.after, 'base64'));
    if (actual !== expected)
      throw new Error(
        `File changed since ${direction === 'apply' ? 'planning' : 'setup'}: ${change.path}. Create a new plan or resolve it manually.`,
      );
  }
}

export async function writeChange(
  plan: Plan,
  change: Change,
  direction: 'apply' | 'rollback',
  guard?: () => Promise<void>,
): Promise<void> {
  const target = await assertWritePath(plan.projectPath, change.path);
  await verifyChanges({ ...plan, changes: [change] }, direction);
  const content = direction === 'apply' ? change.after : change.before;
  if (content === null) {
    await guard?.();
    await verifyChanges({ ...plan, changes: [change] }, direction);
    await unlink(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertWritePath(plan.projectPath, change.path);
  const temporary = `${target}.rigshelf-${randomUUID()}`;
  try {
    const handle = await open(
      temporary,
      'wx',
      direction === 'apply' ? change.afterMode || 0o600 : change.beforeMode || 0o600,
    );
    try {
      await handle.writeFile(Buffer.from(content, 'base64'));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await guard?.();
    await verifyChanges({ ...plan, changes: [change] }, direction);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function stillMissing(plan: Plan): Promise<string[]> {
  const missing: string[] = [];
  for (const path of plan.createdDirectories || [])
    if (!(await lstat(join(plan.projectPath, safeRelative(path))).catch(() => null)))
      missing.push(path);
  return missing;
}

export async function removeCreatedDirectories(plan: Plan): Promise<void> {
  for (const path of plan.createdDirectories || []) {
    const target = join(plan.projectPath, safeRelative(path));
    const stats = await lstat(target).catch(() => null);
    if (stats?.isDirectory()) await rmdir(target).catch(() => undefined);
  }
}

interface Journal {
  id: string;
  direction: 'apply' | 'rollback';
  state: 'writing' | 'complete' | 'reverted' | 'needs-recovery' | 'recovered';
  changes: string[];
  startedAt: string;
  completedAt?: string;
  errors?: string[];
}

async function applyChanges(
  store: Store,
  plan: Plan,
  journal: Journal,
  guard?: () => Promise<void>,
): Promise<void> {
  const written: Change[] = [];
  try {
    for (const change of plan.changes) {
      await guard?.();
      await writeChange(plan, change, journal.direction, guard);
      written.push(change);
    }
    await guard?.();
  } catch (error) {
    const failures: string[] = [];
    for (const change of written.reverse()) {
      try {
        await writeChange(plan, change, journal.direction === 'apply' ? 'rollback' : 'apply');
      } catch {
        failures.push(change.path);
      }
    }
    if (journal.direction === 'apply' && !failures.length) await removeCreatedDirectories(plan);
    store.put('journal', {
      ...journal,
      state: failures.length ? 'needs-recovery' : 'reverted',
      errors: failures,
    });
    store.event(
      'setup.failed',
      failures.length
        ? `Interrupted changes need recovery: ${plan.id}`
        : `Failed changes reverted: ${plan.id}`,
    );
    if (failures.length)
      throw new Error(
        `Operation failed; ${failures.length} files need recovery. Inspect plan ${plan.id}.`,
      );
    throw error;
  }
}

export async function executePlan(
  store: Store,
  id: string,
  direction: 'apply' | 'rollback',
  guard?: () => Promise<void>,
): Promise<Plan> {
  const plan = store.get<Plan>('plan', id);
  if (!plan) throw new Error('Plan not found');
  if (plan.status !== (direction === 'apply' ? 'planned' : 'applied'))
    throw new Error(`Cannot ${direction} a ${plan.status} plan.`);
  if (plan.purpose === 'setup' && (!plan.ownershipAfter || !plan.manifestHash))
    throw new Error('This legacy plan has no reviewed ownership record. Create a new plan.');
  if (direction === 'apply' && plan.purpose === 'setup')
    for (const entryId of plan.entries) {
      const entry = store.entry(entryId);
      if (entry?.kind === 'mcp') checkedMcpDefinition(entry.body);
    }
  await checkedProject(plan.projectPath);
  if (
    plan.rootIdentity !== undefined &&
    plan.rootIdentity !== (await rootIdentity(plan.projectPath))
  )
    throw new Error('Project root changed since planning. Create a new plan.');
  await mkdir(plan.projectPath, { recursive: true });
  plan.rootIdentity = await rootIdentity(plan.projectPath);
  const lockPath = join(plan.projectPath, '.rigshelf-write.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    throw new Error(
      error.code === 'EEXIST'
        ? 'A project write is already in progress. Use recover after inspecting an interrupted operation.'
        : `The project folder is not writable (${error.code}). Check its permissions and try again.`,
    );
  });
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, planId: plan.id, direction }));
    await guard?.();
    await verifyChanges(plan, direction);
    if (direction === 'apply') plan.createdDirectories = await stillMissing(plan);
    store.put('plan', plan);
    const journal: Journal = {
      id: plan.id,
      direction,
      state: 'writing',
      changes: plan.changes.map((change) => change.path),
      startedAt: now(),
    };
    store.put('journal', journal);
    await applyChanges(store, plan, journal, guard);
    if (direction === 'rollback') await removeCreatedDirectories(plan);
    await syncOwnership(store, plan, direction);
    await syncInstallations(store, plan);
    plan.status = direction === 'apply' ? 'applied' : 'rolled-back';
    store.db.transaction(() => {
      store.put('plan', plan);
      store.put('journal', { ...journal, state: 'complete', completedAt: now() });
      store.event(
        `${plan.purpose === 'document' ? 'document' : 'setup'}.${direction === 'apply' ? 'applied' : 'rolled-back'}`,
        `${plan.changes.length} files · ${plan.projectPath.split('/').at(-1)}`,
      );
    })();
    return plan;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function syncInstallations(store: Store, plan: Plan): Promise<void> {
  const project = await detectProject(plan.projectPath, plan.requirements || '');
  const manifestChange = plan.changes.find((change) => change.path === '.rigshelf/kit.json');
  const affectedIds = new Set(plan.entries);
  if (manifestChange?.before)
    for (const entry of parseKit(Buffer.from(manifestChange.before, 'base64').toString()).entries)
      affectedIds.add(entry.id);
  for (const location of store.installations())
    if (location.projectId === project.id && affectedIds.has(location.entryId))
      store.removeInstallation(location.path);
  const kit = await readKit(plan.projectPath);
  project.requirements = kit?.requirements || '';
  project.providers = kit?.providers || [];
  store.put('project', {
    ...preserveProjectInventory(store, project),
    ...store.get<object>('project-override', project.id),
  });
  for (const record of kit?.entries || [])
    for (const provider of kit?.providers || []) {
      const entry = store.entry(record.id);
      if (!entry) continue;
      const spec = adapter(provider);
      const path =
        entry.kind === 'skill'
          ? join(plan.projectPath, spec.skills!, slug(entry.name))
          : join(plan.projectPath, (await projectMcpFile(plan.projectPath, provider))!) +
            '#' +
            slug(entry.name);
      store.installation({
        entryId: entry.id,
        projectId: project.id,
        provider,
        path,
        scope: 'project',
        lastSeen: now(),
      });
    }
}
