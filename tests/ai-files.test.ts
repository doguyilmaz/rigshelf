import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdir, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AiFileInventory } from '../src/core/ai-files';
import { exportLibrary } from '../src/core/backup';
import { documentChoices } from '../src/core/document-index';
import { documentPlan, projectDocument } from '../src/core/documents';
import { inventoryHistory, readInventoryBaseline } from '../src/core/inventory-baselines';
import { createPlan, executePlan } from '../src/core/planner';
import { scan } from '../src/core/scanner';
import { checkProject } from '../src/core/watch';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  await Bun.write(join(value.project, 'package.json'), '{}');
  return value;
}
async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}
const skill =
  '---\nname: private-guide\ndescription: Use for a focused project.\n---\nKeep changes focused.\n';

test('gitignored native Agents, config, hooks, Plugins and local agent memory are inventoried without execution', async () => {
  const data = await setup();
  await write(join(data.project, '.gitignore'), '*');
  await write(join(data.project, '.clinerules'), 'Review existing project conventions.');
  await write(join(data.project, '.claude/agents/reviewer.md'), 'Use reviewed evidence.');
  await write(join(data.project, '.claude/commands/check.md'), 'Check project conventions.');
  await write(
    join(data.project, '.claude/settings.local.json'),
    '{"env":{"API_TOKEN":"dummy-private-token"}}',
  );
  const marker = join(data.root, 'must-not-execute');
  await write(join(data.project, '.claude/hooks/review.sh'), `touch '${marker}'`);
  await write(
    join(data.project, '.claude/agent-memory-local/reviewer/MEMORY.md'),
    'Local agent lesson.',
  );
  const plugin = join(data.project, '.claude/plugins/custom');
  await write(join(plugin, '.claude-plugin/plugin.json'), '{"name":"custom"}');
  await write(join(plugin, 'agents/helper.md'), 'A native plugin Agent.');
  await write(join(plugin, 'skills/private/SKILL.md'), skill);
  const result = await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const project = data.store.projects()[0]!;
  expect(result.skipped).toEqual([]);
  expect(project.documentLocations!.find((file) => file.path === '.clinerules')?.kind).toBe('rule');
  expect(project.documents).toContain('.claude/agent-memory-local/reviewer/MEMORY.md');
  expect(new Set(project.aiFileLocations!.map((file) => file.kind))).toEqual(
    new Set(['agent', 'command', 'config', 'hook', 'plugin']),
  );
  expect(project.aiFileLocations!.every((file) => file.readOnly)).toBe(true);
  expect(await Bun.file(marker).exists()).toBe(false);
  expect(data.store.entries().map((entry) => entry.name)).toEqual(['private-guide']);
  const config = project.aiFileLocations!.find((file) => file.kind === 'config')!;
  expect(JSON.stringify(project)).not.toContain('dummy-private-token');
  const opened = await projectDocument(data.store, {
    projectId: project.id,
    documentId: config.id,
  });
  expect(opened.redacted).toBe(true);
  expect(opened.content).not.toContain('dummy-private-token');
  await expect(
    documentPlan(data.store, {
      projectId: project.id,
      documentId: config.id,
      digest: opened.digest,
      content: '{}',
    }),
  ).rejects.toThrow('read-only');
});

test('global native files are shared once, Aims aliases are deduplicated and account-store targets stay excluded', async () => {
  const data = await setup();
  await write(join(data.home, '.claude/agents/reviewer.md'), 'Global Agent.');
  await write(join(data.home, '.claude/agent-memory/reviewer/MEMORY.md'), 'Global Agent memory.');
  await write(join(data.home, '.claude/settings.json'), '{}');
  await write(join(data.home, '.codex/auth.json'), 'DO NOT PARSE ACCOUNT DATA');
  await symlink(join(data.home, '.codex/auth.json'), join(data.home, '.codex/config.json'));
  const profile = join(data.home, '.aims/profiles/claude/personal');
  await mkdir(profile, { recursive: true });
  await symlink(join(data.home, '.claude/agents'), join(profile, 'agents'));
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const global = data.store.get<AiFileInventory>('global-ai-inventory', 'main')!;
  expect(global.files.filter((file) => file.kind === 'agent')).toHaveLength(1);
  expect(global.files.every((file) => file.readOnly && file.scope === 'global')).toBe(true);
  const project = data.store.projects()[0]!;
  expect(project.aiFileLocations).toHaveLength(0);
  expect(
    project.documentLocations!.some((file) => file.path === 'agent-memory/reviewer/MEMORY.md'),
  ).toBe(true);
  const choices = documentChoices(project, global.files);
  expect(choices.some((file) => file.kind === 'config')).toBe(true);
  expect(JSON.stringify(global)).not.toContain('auth.json');
});

test('each scan retains a verified private inventory checkpoint while immutable library snapshots survive pruning', async () => {
  const data = await setup();
  await write(join(data.project, 'MEMORY.md'), 'An index receipt does not copy this body.');
  await write(join(data.project, '.agents/skills/custom/SKILL.md'), skill);
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const before = { projects: data.store.projects(), installations: data.store.installations() };
  const entry = data.store.entries()[0]!;
  const body = data.store.entry(entry.id)!.body;
  await rm(join(data.project, '.agents'), { recursive: true });
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const history = inventoryHistory(data.store) as { id: string }[];
  const checkpoints = history.map(
    (item) => readInventoryBaseline(data.store, item.id) as { inventory: typeof before },
  );
  expect(
    checkpoints.some(
      (item) =>
        JSON.stringify(item.inventory.projects) === JSON.stringify(before.projects) &&
        JSON.stringify(item.inventory.installations) === JSON.stringify(before.installations),
    ),
  ).toBe(true);
  expect(JSON.stringify(checkpoints)).not.toContain('An index receipt does not copy this body.');
  expect(data.store.entry(entry.id)!.body).toBe(body);
  expect(data.store.installations()).toHaveLength(0);
  expect(JSON.stringify(exportLibrary(data.store))).not.toContain('scan-baseline');
});

test('partial discovery retains previous file metadata and a project missing its manifest is never silently removed', async () => {
  const data = await setup();
  await write(join(data.project, 'MEMORY.md'), 'Keep this indexed location.');
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  await rm(join(data.project, 'MEMORY.md'));
  let deep = data.project;
  for (let index = 0; index < 14; index++) deep = join(deep, 'nested');
  await mkdir(deep, { recursive: true });
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.projects()[0]!.documents).toContain('MEMORY.md');
  expect(
    data.store.projects()[0]!.inventoryWarnings!.some((warning) => warning.includes('limit')),
  ).toBe(true);
  await rm(join(data.project, 'package.json'));
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.projects()).toHaveLength(1);
  expect(
    data.store
      .projects()[0]!
      .inventoryWarnings!.some((warning) => warning.includes('Previous inventory retained')),
  ).toBe(true);
});

test('a failed checkpoint write aborts discovery before changing the previous inventory', async () => {
  const data = await setup();
  const before = JSON.stringify({
    projects: data.store.projects(),
    entries: data.store.entries(),
    locations: data.store.installations(),
  });
  const original = data.store.put.bind(data.store);
  const patch = spyOn(data.store, 'put').mockImplementation((type, value) => {
    if (type === 'scan-baseline') throw new Error('Simulated private checkpoint write failure');
    original(type, value);
  });
  try {
    await expect(
      scan(data.store, { roots: [data.project], globals: false, home: data.home }),
    ).rejects.toThrow('checkpoint write failure');
    expect(
      JSON.stringify({
        projects: data.store.projects(),
        entries: data.store.entries(),
        locations: data.store.installations(),
      }),
    ).toBe(before);
  } finally {
    patch.mockRestore();
  }
});

test('dependency checks and setup apply/rollback preserve the richer scanned AI inventory', async () => {
  const data = await setup();
  await write(
    join(data.project, '.claude/agent-memory-local/reviewer/MEMORY.md'),
    'Project lesson.',
  );
  await write(join(data.project, '.claude/settings.local.json'), '{}');
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const before = data.store.projects()[0]!;
  await checkProject(data.store, data.project);
  expect(data.store.projects()[0]!.documentLocations).toEqual(before.documentLocations);
  expect(data.store.projects()[0]!.aiFileLocations).toEqual(before.aiFileLocations);
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex'],
    entryIds: [],
  });
  await executePlan(data.store, plan.id, 'apply');
  expect(data.store.projects()[0]!.documentLocations).toEqual(before.documentLocations);
  expect(data.store.projects()[0]!.aiFileLocations).toEqual(before.aiFileLocations);
  await executePlan(data.store, plan.id, 'rollback');
  expect(data.store.projects()[0]!.documentLocations).toEqual(before.documentLocations);
});

test('AI-only directories and bare custom Skill collections are discovered without application manifests', async () => {
  const data = await setup();
  await rm(join(data.project, 'package.json'));
  await write(join(data.project, '.gitignore'), '*');
  await write(join(data.project, '.claude/agent-memory-local/reviewer/MEMORY.md'), 'Local memory.');
  await write(join(data.project, 'custom-guides/focused/SKILL.md'), skill);
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.projects()).toHaveLength(1);
  expect(data.store.projects()[0]!.documents).toContain(
    '.claude/agent-memory-local/reviewer/MEMORY.md',
  );
  expect(data.store.entries().map((entry) => entry.name)).toEqual(['private-guide']);
});

test('an inventoried external memory file remains readable when its original project folder is moved', async () => {
  const data = await setup();
  const key = data.project.replace(/[^a-zA-Z0-9]/g, '-');
  await write(
    join(data.home, '.claude/projects', key, 'memory/MEMORY.md'),
    'Retained external memory.',
  );
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects()[0]!;
  const file = project.documentLocations!.find((file) => file.scope === 'user-project')!;
  await rename(data.project, `${data.project}-moved`);
  const opened = await projectDocument(data.store, { projectId: project.id, documentId: file.id });
  expect(opened.content).toBe('Retained external memory.');
  expect(opened.readOnly).toBe(true);
});

test('temporarily unavailable global roots preserve previous native files, memory and installation relationships', async () => {
  const data = await setup();
  const config = join(data.home, '.claude');
  await write(join(config, 'settings.json'), '{}');
  await write(join(data.home, '.codex/config.toml'), '');
  await write(join(config, 'agent-memory/reviewer/MEMORY.md'), 'Retained shared lesson.');
  await write(join(config, 'skills/private/SKILL.md'), skill);
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects()[0]!;
  const before = data.store.get<AiFileInventory>('global-ai-inventory', 'main')!.files;
  await rename(config, `${config}-offline`);
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(data.store.get<AiFileInventory>('global-ai-inventory', 'main')!.files).toEqual(before);
  expect(data.store.projects()[0]!.documentLocations).toEqual(project.documentLocations);
  expect(data.store.installations()).toHaveLength(1);
  expect(
    data.store.get<AiFileInventory>('global-ai-inventory', 'main')!.warnings.join(' '),
  ).toContain('previous inventory retained');
});
