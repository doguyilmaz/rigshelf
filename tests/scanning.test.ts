import { afterEach, expect, test } from 'bun:test';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { importSkillDirectory } from '../src/core/ingest';
import { createPlan, executePlan } from '../src/core/planner';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  return value;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
test('global discovery confines linked skills to inventoried roots while retaining shared global aliases', async () => {
  const { store, root, home } = await setup();
  const external = join(root, 'outside-inventory');
  const shared = join(home, '.agents/skills/shared-guide');
  const aliases = join(home, '.codex/skills');
  await mkdir(external);
  await mkdir(shared, { recursive: true });
  await mkdir(aliases, { recursive: true });
  await Bun.write(
    join(external, 'SKILL.md'),
    '---\nname: external-guide\ndescription: An unrelated directory.\n---\nExternal bytes.',
  );
  await Bun.write(
    join(shared, 'SKILL.md'),
    '---\nname: shared-guide\ndescription: Use this known global guide.\n---\nShared bytes.',
  );
  await symlink(external, join(aliases, 'external'));
  await symlink(shared, join(aliases, 'shared'));
  const result = await scan(store, { roots: [], globals: true, home });
  expect(result.skipped.some((message) => message.includes('External global skill link'))).toBe(
    true,
  );
  expect(store.entries().map((entry) => entry.name)).toEqual(['shared-guide']);
  expect(store.installations()).toHaveLength(2);
});
test('project scans refuse unrelated external skill aliases and recognize explicitly scanned global roots', async () => {
  const { store, project, root, home } = await setup();
  await mkdir(join(project, '.git'));
  await mkdir(join(project, '.agents/skills'), { recursive: true });
  const external = join(root, 'unrelated');
  await mkdir(external);
  const body =
    '---\nname: linked-guide\ndescription: Use this guide for a selected workflow.\n---\nInstructions.';
  await Bun.write(join(external, 'SKILL.md'), body);
  await symlink(external, join(project, '.agents/skills/linked-guide'));
  const skipped = await scan(store, { roots: [project], globals: false, home });
  expect(skipped.skills).toBe(0);
  expect(skipped.skipped.some((message) => message.includes('External project skill link'))).toBe(
    true,
  );
  await rm(join(project, '.agents/skills/linked-guide'));
  const shared = join(home, '.agents/skills/linked-guide');
  await mkdir(shared, { recursive: true });
  await Bun.write(join(shared, 'SKILL.md'), body);
  await symlink(shared, join(project, '.agents/skills/linked-guide'));
  await scan(store, { roots: [project], globals: true, home });
  expect(store.entries().filter((entry) => entry.kind === 'skill')).toHaveLength(1);
  expect(
    store.installations().filter((location) => location.entryId === store.entries()[0].id).length,
  ).toBeGreaterThanOrEqual(2);
});

test('rescanning six adapters retains canonical pins instead of importing converted skill and bridge variants', async () => {
  const { store, project, root, home } = await setup();
  const source = join(root, 'upstream');
  await mkdir(source);
  await Bun.write(
    join(source, 'SKILL.md'),
    '---\nname: portable-guide\ndescription: Use for focused project work.\nmodel: inherit\n---\n\nKeep the supporting context focused.\n',
  );
  const skill = await importSkillDirectory(store, source, home);
  const mcp = (await route(store, 'POST', 'mcp', {
    name: 'filtered-service',
    mcp: {
      transport: 'stdio',
      command: 'service',
      args: [],
      env: {},
      headers: {},
      allowedTools: ['echo'],
    },
  })) as { id: string };
  const plan = await createPlan(store, {
    projectPath: project,
    providers: ['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok'],
    entryIds: [skill.id, mcp.id],
  });
  await executePlan(store, plan.id, 'apply');
  const before = store.entries(true).length;
  const result = await scan(store, { roots: [project], globals: false, home });
  expect(result.skipped).toHaveLength(0);
  expect(store.entries(true)).toHaveLength(before);
  expect(new Set(store.installations().map((location) => location.entryId))).toEqual(
    new Set([skill.id, mcp.id]),
  );
});

test('missing locations are pruned while snapshots survive and unavailable roots retain inventory', async () => {
  const { store, project, home } = await setup();
  const directory = join(project, '.agents/skills/temporary-guide');
  await mkdir(directory, { recursive: true });
  await Bun.write(join(project, 'package.json'), '{}');
  await Bun.write(
    join(directory, 'SKILL.md'),
    '---\nname: temporary-guide\ndescription: Use for temporary test work.\n---\n\nKeep this snapshot.\n',
  );
  await Bun.write(
    join(project, '.mcp.json'),
    '{"mcpServers":{"temporary":{"command":"server","args":[]}}}',
  );
  await scan(store, { roots: [project], globals: false, home });
  const entries = store.entries().length;
  expect(store.installations()).toHaveLength(2);
  await scan(store, { roots: [join(project, 'unavailable')], globals: false, home });
  expect(store.installations()).toHaveLength(2);
  expect(store.projects()).toHaveLength(1);
  await rm(directory, { recursive: true });
  await Bun.write(join(project, '.mcp.json'), '{"mcpServers":{}}');
  await scan(store, { roots: [project], globals: false, home });
  expect(store.installations()).toHaveLength(0);
  expect(store.entries()).toHaveLength(entries);
});

test('rescans preserve archive visibility, custom tags and edited source relationships', async () => {
  const { store, project, home } = await setup();
  await Bun.write(join(project, 'package.json'), '{}');
  await Bun.write(
    join(project, '.mcp.json'),
    '{"mcpServers":{"example":{"command":"example-server","args":[]}}}',
  );
  await scan(store, { roots: [project], globals: false, home });
  const entry = store.entries()[0];
  await route(store, 'PATCH', `entries/${entry.id}`, {
    tags: ['manually-reviewed'],
    archived: true,
  });
  await route(store, 'PATCH', 'sources/local-mcp', {
    name: 'My server definitions',
    url: '',
    recipe: '',
    notes: 'Keep this manual source label.',
  });
  await scan(store, { roots: [project], globals: false, home });
  expect(store.entries()).toHaveLength(0);
  expect(store.entry(entry.id)?.tags).toEqual(['manually-reviewed']);
  expect(store.sources().find((source) => source.id === 'local-mcp')?.name).toBe(
    'My server definitions',
  );
});

test('Claude user-level project MCP sections retain their project scope without collecting unrelated account data', async () => {
  const { store, project, home } = await setup();
  await Bun.write(join(project, 'package.json'), '{}');
  await Bun.write(
    join(home, '.claude.json'),
    JSON.stringify({
      account: { email: 'private@example.invalid', token: 'do-not-collect-this-dummy-token' },
      projects: {
        [project]: {
          mcpServers: {
            scoped: { command: 'scoped-server', env: { API_TOKEN: 'dummy-sensitive-value' } },
          },
          history: ['Never collect this dummy history.'],
        },
      },
    }),
  );
  await scan(store, { roots: [project], globals: true, home });
  const location = store.installations().find((value) => value.path.includes('#project:'));
  expect(location?.scope).toBe('project');
  expect(location?.storage).toBe('user-project-config');
  expect(location?.projectId).toBe(store.projects()[0].id);
  const serialized = JSON.stringify(store.entries(true).map((entry) => store.entry(entry.id)));
  expect(serialized).not.toContain('do-not-collect');
  expect(serialized).not.toContain('dummy-sensitive-value');
  expect(serialized).not.toContain('dummy history');
  expect(serialized).not.toContain('private@example.invalid');
  await Bun.write(join(home, '.claude.json'), '{"projects":{}}');
  await scan(store, { roots: [project], globals: true, home });
  expect(store.installations()).toHaveLength(0);
  expect(store.entries()).toHaveLength(1);
});
