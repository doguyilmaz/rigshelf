import { afterEach, expect, test } from 'bun:test';
import { mkdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readImport, setupProject, writeExport } from '../src/cli-operations';
import { detectProject } from '../src/core/detect';
import { documentPlan, projectDocument } from '../src/core/documents';
import { parseKit } from '../src/core/kit';
import { approveProject } from '../src/core/ownership';
import { createPlan, executePlan } from '../src/core/planner';
import { recommend } from '../src/core/recommend';
import { checkProject } from '../src/core/watch';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  return value;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('quick setup uses preset recommendations, supports explicit empty kits and private backups', async () => {
  const { store, project, root } = await setup();
  sampleSkill(store, 'react-native-best-practices');
  const preview = await setupProject(store, project, { providers: ['codex'], presetId: 'expo' });
  expect(preview.entries).toHaveLength(1);
  expect(await Bun.file(join(project, '.kitfold/kit.json')).exists()).toBe(false);
  const empty = await setupProject(store, join(root, 'greenfield'), {
    providers: ['claude'],
    presetId: 'expo',
    entries: '',
    apply: true,
  });
  expect(empty.entries).toHaveLength(0);
  expect(await Bun.file(join(root, 'greenfield/CLAUDE.md')).exists()).toBe(true);
  const output = join(root, 'library.json.gz');
  await writeExport(store, output);
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  await expect(writeExport(store, output)).rejects.toThrow();
  const other = await setup();
  expect((await readImport(other.store, output, true)).entries).toBe(1);
});

test('explicit replacement is reviewable and rollback restores an unmanaged skill exactly', async () => {
  const { store, project } = await setup();
  const entry = sampleSkill(store);
  const target = join(project, '.agents/skills/project-guide/SKILL.md');
  await mkdir(join(project, '.agents/skills/project-guide'), { recursive: true });
  const original = 'Unmanaged original, including its unusual formatting.\n';
  await Bun.write(target, original);
  const kept = await createPlan(store, {
    projectPath: project,
    providers: ['codex'],
    entryIds: [entry.id],
  });
  expect(kept.entries).toEqual([]);
  expect(kept.warnings.some((value) => value.includes('Kept existing'))).toBe(true);
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['codex'],
    entryIds: [entry.id],
    replaceExisting: true,
  });
  expect(plan.warnings.some((value) => value.includes('Explicit replacement'))).toBe(true);
  expect(await Bun.file(target).text()).toBe(original);
  await executePlan(store, plan.id, 'apply');
  await executePlan(store, plan.id, 'rollback');
  expect(await Bun.file(target).text()).toBe(original);
});

test('project-local aliases share one canonical skill without changing the alias itself', async () => {
  const { store, project } = await setup();
  const entry = sampleSkill(store);
  await mkdir(join(project, '.agents/skills/project-guide'), { recursive: true });
  await mkdir(join(project, '.claude/skills'), { recursive: true });
  await symlink(
    '../../.agents/skills/project-guide',
    join(project, '.claude/skills/project-guide'),
  );
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['claude', 'codex'],
    entryIds: [entry.id],
  });
  expect(plan.changes.filter((change) => change.path.endsWith('/SKILL.md'))).toHaveLength(1);
  await executePlan(store, plan.id, 'apply');
  expect(await Bun.file(join(project, '.claude/skills/project-guide/SKILL.md')).text()).toBe(
    entry.body,
  );
  expect(
    (
      await createPlan(store, {
        projectPath: project,
        providers: ['claude', 'codex'],
        entryIds: [entry.id],
      })
    ).changes,
  ).toHaveLength(0);
  await executePlan(store, plan.id, 'rollback');
  expect(await Bun.file(join(project, '.agents/skills/project-guide/SKILL.md')).exists()).toBe(
    false,
  );
});

test('OpenCode JSONC is updated in place while comments and unrelated settings survive', async () => {
  const { store, project } = await setup();
  const body =
    '{\n  // Keep the selected model and its explanation.\n  "model": "vendor/model",\n  "mcp": {\n    // Keep this team server.\n    "team": {"type":"local","command":["team-server"],"enabled":true},\n  },\n}\n';
  await Bun.write(join(project, 'opencode.jsonc'), body);
  const definition = (await import('../src/core/service').then(({ route }) =>
    route(store, 'POST', 'mcp', {
      name: 'extra',
      mcp: { transport: 'stdio', command: 'extra-server', args: [], env: {}, headers: {} },
    }),
  )) as { id: string };
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['opencode'],
    entryIds: [definition.id],
  });
  await executePlan(store, plan.id, 'apply');
  const updated = await Bun.file(join(project, 'opencode.jsonc')).text();
  expect(updated).toContain('// Keep the selected model');
  expect(updated).toContain('// Keep this team server.');
  expect(updated).toContain('extra-server');
  expect(await Bun.file(join(project, 'opencode.json')).exists()).toBe(false);
  await executePlan(store, plan.id, 'rollback');
  expect(await Bun.file(join(project, 'opencode.jsonc')).text()).toBe(body);
});

test('automatic additions preserve requirements and pause on managed file drift', async () => {
  const { store, project } = await setup();
  const guide = sampleSkill(store);
  const auth = sampleSkill(store, 'better-auth');
  store.put('trust', { id: auth.id, digest: auth.digest });
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['codex'],
    entryIds: [guide.id],
    requirements: 'A small Go API',
    presetId: 'go',
  });
  await executePlan(store, plan.id, 'apply');
  await Bun.write(
    join(project, '.agents/skills/project-guide/SKILL.md'),
    'Local changes must survive.',
  );
  await Bun.write(
    join(project, 'package.json'),
    JSON.stringify({ dependencies: { 'better-auth': '1' } }),
  );
  await approveProject(store, project, true);
  await expect(checkProject(store, project, true)).rejects.toThrow('Automatic additions paused');
  expect(await Bun.file(join(project, '.agents/skills/better-auth/SKILL.md')).exists()).toBe(false);
  await Bun.write(join(project, '.agents/skills/project-guide/SKILL.md'), guide.body);
  await checkProject(store, project, true);
  const kit = parseKit(await Bun.file(join(project, '.kitfold/kit.json')).text());
  expect(kit.requirements).toBe('A small Go API');
  expect(kit.presetId).toBe('go');
  expect(await Bun.file(join(project, '.agents/skills/better-auth/SKILL.md')).exists()).toBe(true);
});

test('existing kit recommendations retain more than ten pinned entries without choosing alternate versions', async () => {
  const { store, project } = await setup();
  const entries = Array.from({ length: 15 }, (_, index) =>
    sampleSkill(store, `capability-${index}`),
  );
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['codex'],
    entryIds: entries.map((entry) => entry.id),
  });
  await executePlan(store, plan.id, 'apply');
  const result = recommend(store, await detectProject(project));
  expect(result.recommendations.filter((value) => value.selected)).toHaveLength(15);
});
test('recommendations prefer exact technologies and avoid selecting overlapping alternatives or connector words', async () => {
  const { store, project } = await setup();
  sampleSkill(store, 'hono');
  sampleSkill(store, 'Bun Build an HTTP server using Hono and Bun');
  sampleSkill(store, 'better-auth');
  sampleSkill(store, 'better-auth-best-practices');
  const result = recommend(
    store,
    await detectProject(project, 'An application with Better-Auth and Hono'),
    'base',
  );
  expect(
    result.recommendations
      .filter((value) => value.selected)
      .map((value) => value.entry.name)
      .toSorted(),
  ).toEqual(['better-auth', 'hono']);
  expect(
    result.recommendations.some((value) =>
      value.reasons.some((reason) => reason === 'Matches requirement: and'),
    ),
  ).toBe(false);
});
test('explicit preset pins are honored beyond the small automatic recommendation limit', async () => {
  const { store, project } = await setup();
  const entries = Array.from({ length: 24 }, (_, index) => sampleSkill(store, `selected-${index}`));
  const preset = store.get<import('../src/core/model').Preset>('preset', 'base')!;
  store.put('preset', { ...preset, id: 'chosen', entryIds: entries.map((entry) => entry.id) });
  const recommended = recommend(store, await detectProject(project), 'chosen');
  expect(recommended.recommendations.filter((value) => value.selected)).toHaveLength(24);
});

test('document changes use the same plan engine, reject stale edits and mask private tokens', async () => {
  const { store, project } = await setup();
  await Bun.write(join(project, 'MEMORY.md'), 'A reusable lesson, without conversation history.\n');
  const detected = await detectProject(project);
  store.put('project', detected);
  const document = await projectDocument(store, { projectId: detected.id, path: 'MEMORY.md' });
  const plan = await documentPlan(store, {
    projectId: detected.id,
    path: document.path,
    digest: document.digest,
    content: 'A clearer reusable lesson.\n',
  });
  expect(plan.purpose).toBe('document');
  await executePlan(store, plan.id, 'apply');
  expect(await Bun.file(join(project, 'MEMORY.md')).text()).toBe('A clearer reusable lesson.\n');
  await expect(
    documentPlan(store, {
      projectId: detected.id,
      path: document.path,
      digest: document.digest,
      content: 'Stale replacement',
    }),
  ).rejects.toThrow('changed since');
  await executePlan(store, plan.id, 'rollback');
  expect(await Bun.file(join(project, 'MEMORY.md')).text()).toBe(document.content);
  await Bun.write(join(project, 'MEMORY.md'), 'token="private-test-token"');
  const masked = await projectDocument(store, { projectId: detected.id, path: 'MEMORY.md' });
  expect(masked.redacted).toBe(true);
  expect(masked.content).not.toContain('private-test-token');
  await expect(
    documentPlan(store, {
      projectId: detected.id,
      path: masked.path,
      digest: masked.digest,
      content: masked.content,
    }),
  ).rejects.toThrow('masked document');
});
