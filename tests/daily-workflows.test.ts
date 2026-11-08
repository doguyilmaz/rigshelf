import { afterEach, expect, test } from 'bun:test';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { userAiRoots } from '../src/core/ai-config-roots';
import { exportLibrary } from '../src/core/backup';
import { projectDocument } from '../src/core/documents';
import { importSkillDirectory } from '../src/core/ingest';
import type { Entry, Provider } from '../src/core/model';
import { createPlan, executePlan } from '../src/core/planner';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import { reviseSkill } from '../src/core/skill-revisions';
import { previewSource } from '../src/core/source-library';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  await Bun.write(join(data.project, 'package.json'), '{}');
  return data;
}
const skillBody =
  '---\nname: daily-guide\ndescription: Use for the daily workflow fixture.\n---\n\nRead references/notes.md when relevant.\n';

test('a six-Harness daily journey preserves authored data through install, revision, remove and rollback', async () => {
  const data = await setup();
  const source = join(data.root, 'source');
  await Bun.write(join(source, 'SKILL.md'), skillBody);
  await Bun.write(join(source, 'references/notes.md'), 'Original supporting notes.');
  const original = await importSkillDirectory(data.store, source, data.home);
  await Bun.write(join(data.project, 'AGENTS.md'), '# Authored conventions\n');
  await Bun.write(
    join(data.project, '.mcp.json'),
    JSON.stringify({ mcpServers: { authored: { command: 'authored-server' } } }),
  );
  await Bun.write(join(data.project, '.gitignore'), '.agents/\n.claude/\n.kiro/\n');
  const mcp = (await route(data.store, 'POST', 'mcp', {
    name: 'daily-server',
    mcp: {
      transport: 'stdio',
      command: 'fixture-server',
      args: ['--read-only'],
      env: { API_KEY: '${FIXTURE_API_KEY}' },
    },
  })) as Entry;
  const providers: Provider[] = ['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok'];
  const request = (ids: string[]) => ({
    projectPath: data.project,
    providers,
    entryIds: ids,
    includeRules: true,
  });
  const initial = await createPlan(data.store, request([original.id, mcp.id]));
  expect(await Bun.file(join(data.project, '.agents/skills/daily-guide/SKILL.md')).exists()).toBe(
    false,
  );
  await executePlan(data.store, initial.id, 'apply');
  const next = reviseSkill(data.store, original.id, {
    body: 'Use the revised notes.',
    file: {
      path: 'references/notes.md',
      content: Buffer.from('Revised supporting notes.').toString('base64'),
      executable: false,
    },
  });
  expect(
    await Bun.file(join(data.project, '.agents/skills/daily-guide/references/notes.md')).text(),
  ).toBe('Original supporting notes.');
  const upgrade = await createPlan(data.store, request([next.id, mcp.id]));
  expect(upgrade.changes.some((change) => change.path.endsWith('references/notes.md'))).toBe(true);
  await executePlan(data.store, upgrade.id, 'apply');
  expect(
    await Bun.file(join(data.project, '.agents/skills/daily-guide/references/notes.md')).text(),
  ).toBe('Revised supporting notes.');
  const removal = await createPlan(data.store, request([]));
  await executePlan(data.store, removal.id, 'apply');
  expect(await Bun.file(join(data.project, '.agents/skills/daily-guide/SKILL.md')).exists()).toBe(
    false,
  );
  expect(JSON.parse(await Bun.file(join(data.project, '.mcp.json')).text()).mcpServers).toEqual({
    authored: { command: 'authored-server' },
  });
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toStartWith(
    '# Authored conventions\n',
  );
  await executePlan(data.store, removal.id, 'rollback');
  await executePlan(data.store, upgrade.id, 'rollback');
  expect(
    await Bun.file(join(data.project, '.agents/skills/daily-guide/references/notes.md')).text(),
  ).toBe('Original supporting notes.');
  expect(data.store.entry(original.id)?.digest).not.toBe(next.digest);
  expect((await stat(source)).isDirectory()).toBe(true);
  expect(await Bun.file(join(data.home, '.claude/settings.json')).exists()).toBe(false);
}, 20000);

test('custom manager roots discover native Skills/MCP and project memory without collecting conversations or credentials', async () => {
  const data = await setup();
  const profile = join(data.home, '.custom-manager/claude-profile');
  const memory = join(
    profile,
    'projects',
    data.project.replace(/[^a-zA-Z0-9]/g, '-'),
    'memory/MEMORY.md',
  );
  await Bun.write(join(profile, 'skills/daily/SKILL.md'), skillBody);
  await Bun.write(
    join(profile, 'settings.json'),
    JSON.stringify({ mcpServers: { custom: { command: 'fixture-server' } } }),
  );
  await Bun.write(memory, 'Custom manager project guidance.');
  await Bun.write(join(profile, 'auth.json'), 'DO NOT READ ACCOUNT DATA');
  await Bun.write(join(profile, 'sessions/MEMORY.md'), 'DO NOT READ CONVERSATIONS');
  data.store.put('settings', {
    id: 'main',
    ...data.store.settings(),
    aiConfigRoots: [{ path: profile, provider: 'claude' }],
  });
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.entries()).toEqual([]);
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(
    data.store
      .entries()
      .map((entry) => entry.kind)
      .sort(),
  ).toEqual(['mcp', 'skill']);
  const project = data.store.projects()[0]!;
  const document = project.documentLocations!.find((item) => item.sourcePath === memory)!;
  expect(document.scope).toBe('user-project');
  expect(document.readOnly).toBe(true);
  expect(
    (await projectDocument(data.store, { projectId: project.id, documentId: document.id })).content,
  ).toBe('Custom manager project guidance.');
  expect(JSON.stringify(project)).not.toContain('sessions');
  expect(JSON.stringify(data.store.entries())).not.toContain('ACCOUNT DATA');
  expect(
    (await userAiRoots(data.home, [], {}, data.store.settings().aiConfigRoots)).find(
      (root) => root.path === profile,
    )?.origin,
  ).toBe('custom');
  expect(JSON.stringify(exportLibrary(data.store))).not.toContain(profile);
});

test('custom roots reject broad/private targets and report unavailable explicit folders', async () => {
  const data = await setup();
  const privateRoot = join(data.home, '.ssh');
  await mkdir(privateRoot);
  const sessions = join(data.home, '.other-manager/sessions');
  await mkdir(sessions, { recursive: true });
  const warnings: string[] = [];
  const roots = await userAiRoots(data.home, warnings, {}, [
    { path: data.home, provider: 'claude' },
    { path: '/', provider: 'custom' },
    { path: privateRoot, provider: 'custom' },
    { path: sessions, provider: 'custom' },
    { path: join(data.home, 'missing'), provider: 'codex' },
  ]);
  expect(roots).toEqual([]);
  expect(warnings).toHaveLength(5);
});

test('source preview parses focused commands without saving, fetching or executing recipes', async () => {
  const data = await setup();
  const count = data.store.sources().length;
  const input = 'bunx skills add example/skills --skill daily-guide';
  const preview = (await route(data.store, 'POST', 'sources/preview', { input })) as ReturnType<
    typeof previewSource
  >;
  expect(preview.url).toBe('https://github.com/example/skills');
  expect(preview.focusSkill).toBe('daily-guide');
  expect(preview.recipe).toBe(input);
  expect(data.store.sources()).toHaveLength(count);
  expect(data.store.entries()).toEqual([]);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.events()).toEqual([]);
  expect(previewSource({ input: 'example/skills' }).url).toBe(preview.url);
  expect(() => previewSource({ input: 'http://localhost/private' })).toThrow();
  expect(() => previewSource({ input: 'https://example.com/?api_key=private' })).toThrow();
});
