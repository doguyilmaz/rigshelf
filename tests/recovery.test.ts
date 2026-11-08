import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createPlan, executePlan } from '../src/core/planner';
import { recoverPlan } from '../src/core/recovery';
import { fixture, sampleSkill } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const entry = sampleSkill(data.store);
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['claude', 'codex'],
    entryIds: [entry.id],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  return { ...data, plan };
}

test('a zero-byte original file is restored, not mistaken for a missing file', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  await Bun.write(join(data.project, 'AGENTS.md'), '');
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex'],
    entryIds: [],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  await executePlan(data.store, plan.id, 'apply');
  await executePlan(data.store, plan.id, 'rollback');
  expect(await Bun.file(join(data.project, 'AGENTS.md')).exists()).toBe(true);
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe('');
});

test('recovery restores the baseline after an interrupted apply and clears only a verified stale lock', async () => {
  const { store, project, plan } = await setup();
  const change = plan.changes[0];
  await Bun.write(join(project, change.path), Buffer.from(change.after!, 'base64'));
  const interrupted = plan.changes[1];
  await Bun.write(
    join(project, `${interrupted.path}.kitfold-0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c`),
    'partial',
  );
  await Bun.write(join(project, `${interrupted.path}.kitfold-notes`), 'not a temporary file');
  store.put('journal', { id: plan.id, direction: 'apply', state: 'writing' });
  await Bun.write(
    join(project, '.kitfold-write.lock'),
    JSON.stringify({ pid: 99999999, planId: plan.id }),
  );
  const recovered = await recoverPlan(store, plan.id);
  expect(recovered.status).toBe('planned');
  expect(await Bun.file(join(project, change.path)).exists()).toBe(false);
  expect(await Bun.file(join(project, '.kitfold-write.lock')).exists()).toBe(false);
  const remaining = await readdir(project, { recursive: true });
  expect(remaining.filter((path) => path.includes('.kitfold-0b6d'))).toEqual([]);
  expect(remaining.some((path) => path.endsWith('.kitfold-notes'))).toBe(true);
  await executePlan(store, plan.id, 'apply');
  expect(store.get<{ state: string }>('journal', plan.id)?.state).toBe('complete');
});

test('recovery does not interrupt a live writer or delete its lock', async () => {
  const { store, project, plan } = await setup();
  store.put('journal', { id: plan.id, direction: 'apply', state: 'writing' });
  const path = join(project, '.kitfold-write.lock');
  await Bun.write(path, JSON.stringify({ pid: process.pid, planId: plan.id }));
  await expect(recoverPlan(store, plan.id)).rejects.toThrow('running process');
  expect(await Bun.file(path).exists()).toBe(true);
});

test('recovery protects edits outside the plan’s two known states before restoring any file', async () => {
  const { store, project, plan } = await setup();
  const first = plan.changes[0];
  const second = plan.changes[1];
  await Bun.write(join(project, first.path), Buffer.from(first.after!, 'base64'));
  await Bun.write(join(project, second.path), 'A human edit after interruption');
  store.put('journal', { id: plan.id, direction: 'apply', state: 'writing' });
  await expect(recoverPlan(store, plan.id)).rejects.toThrow('Recovery conflict');
  expect(await Bun.file(join(project, first.path)).exists()).toBe(true);
  expect(await Bun.file(join(project, second.path)).text()).toBe('A human edit after interruption');
});

test('interrupted rollback recovery returns to the applied state', async () => {
  const { store, project, plan } = await setup();
  await executePlan(store, plan.id, 'apply');
  const change = plan.changes[0];
  await unlink(join(project, change.path));
  store.put('journal', { id: plan.id, direction: 'rollback', state: 'writing' });
  const result = await recoverPlan(store, plan.id);
  expect(result.status).toBe('applied');
  expect(await Bun.file(join(project, change.path)).exists()).toBe(true);
});

test('an I/O failure compensates earlier writes and can be retried after the underlying problem is fixed', async () => {
  const { store, project, plan } = await setup();
  const blocked = join(project, '.agents/skills');
  await mkdir(blocked, { recursive: true });
  await chmod(blocked, 0o500);
  try {
    await expect(executePlan(store, plan.id, 'apply')).rejects.toThrow();
  } finally {
    await chmod(blocked, 0o700);
  }
  expect(await Bun.file(join(project, '.claude/skills/project-guide/SKILL.md')).exists()).toBe(
    false,
  );
  expect(await Bun.file(join(project, 'CLAUDE.md')).exists()).toBe(false);
  expect(store.get<{ state: string }>('journal', plan.id)?.state).toBe('reverted');
  await executePlan(store, plan.id, 'apply');
  expect(await Bun.file(join(project, '.agents/skills/project-guide/SKILL.md')).exists()).toBe(
    true,
  );
});
