import { afterEach, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { globalAiFiles, pluginRoots } from '../src/core/ai-files';
import { projectAiContexts } from '../src/core/guidance-inventory';
import { readInventoryMcpConfig } from '../src/core/mcp-inventory-config';
import { scanDiagnostics } from '../src/core/scan-diagnostics';
import { scan } from '../src/core/scanner';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  await write(join(value.project, 'package.json'), '{}');
  return value;
}
async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

test('known cache layouts and marketplace local sources find manifest-less packages without traversing arbitrary package internals', async () => {
  const data = await setup();
  const root = join(data.home, '.claude');
  const cache = join(root, 'plugins/cache/acme/example/1');
  const catalog = join(root, 'plugins/marketplaces/acme');
  const local = join(catalog, 'packages/tool');
  await write(
    join(cache, 'skills/example/SKILL.md'),
    '---\nname: example\ndescription: Cache fixture.\n---\nUse reviewed changes.',
  );
  await mkdir(join(cache, ...Array(16).fill('source')), { recursive: true });
  await mkdir(join(catalog, ...Array(16).fill('unrelated')), { recursive: true });
  await write(join(local, 'agents/review.md'), 'Review actual changes.');
  await write(
    join(catalog, '.claude-plugin/marketplace.json'),
    JSON.stringify({
      name: 'acme',
      plugins: [
        { name: 'tool', source: './packages/tool' },
        { name: 'remote', source: { source: 'github', repo: 'fictional/remote' } },
      ],
    }),
  );
  const warnings: string[] = [];
  expect(await pluginRoots(join(root, 'plugins/cache'), [root], warnings, 'cache')).toEqual([
    cache,
  ]);
  expect(await pluginRoots(join(root, 'plugins/marketplaces'), [root], warnings)).toEqual([local]);
  expect(warnings).toEqual([]);
  await scan(data.store, {
    roots: [data.project],
    globals: true,
    home: data.home,
    environment: {},
  });
  expect(data.store.entries(true).some((entry) => entry.plugin?.nativeId === 'example@acme')).toBe(
    true,
  );
  expect(data.store.entries(true).some((entry) => entry.plugin?.nativeId === 'tool@acme')).toBe(
    true,
  );
  const native = await globalAiFiles([{ path: root, provider: 'claude', origin: 'default' }]);
  expect(native.files.some((file) => file.canonicalPath === join(local, 'agents/review.md'))).toBe(
    true,
  );
});

test('catalog traversal rejects external sources and reports missing declared package paths instead of claiming full coverage', async () => {
  const data = await setup();
  const root = join(data.home, '.claude/plugins/marketplaces/acme');
  await write(
    join(root, '.claude-plugin/marketplace.json'),
    JSON.stringify({
      name: 'acme',
      plugins: [
        { name: 'escape', source: './../../../../outside' },
        { name: 'missing', source: './absent' },
      ],
    }),
  );
  const warnings: string[] = [];
  const other = join(data.home, 'other-checkout');
  await write(join(other, '.claude-plugin/plugin.json'), '{"name":"must-not-follow"}');
  await symlink(other, join(root, 'linked'));
  await write(
    join(root, '.claude-plugin/marketplace.json'),
    JSON.stringify({
      name: 'acme',
      plugins: [
        { name: 'escape', source: './../../../../outside' },
        { name: 'missing', source: './absent' },
        { name: 'linked', source: './linked' },
      ],
    }),
  );
  expect(await pluginRoots(root, [data.home], warnings)).toEqual([]);
  expect(warnings.join(' ')).toContain('External marketplace package source excluded');
  expect(warnings.join(' ')).toContain('Declared Plugin package unavailable');
  expect(warnings.join(' ')).toContain('External marketplace package link excluded');
  await scan(data.store, {
    roots: [data.project],
    globals: true,
    home: data.home,
    environment: {},
  });
  expect(
    data.store
      .entries(true)
      .some((entry) => entry.name.includes('must-not-follow') || entry.name === 'linked@acme'),
  ).toBe(false);
});

test('Unity generated directories do not exhaust project discovery, while authored Library folders in other projects remain eligible', async () => {
  const data = await setup();
  await mkdir(join(data.project, 'Assets'), { recursive: true });
  await write(join(data.project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: fixture');
  await write(join(data.project, 'Library/cache/.claude/rules/generated.md'), 'Generated cache.');
  await write(join(data.project, 'Assets/Feature/.claude/rules/authored.md'), 'Authored guidance.');
  await mkdir(join(data.project, 'Library', ...Array(15).fill('cache')), { recursive: true });
  const contexts = await projectAiContexts(data.project);
  expect(contexts.paths).toContain(join(data.project, 'Assets/Feature'));
  expect(contexts.paths.some((path) => path.includes('/Library/'))).toBe(false);
  expect(contexts.warnings).toEqual([]);
  const ordinary = await setup();
  await write(join(ordinary.project, 'Library/Feature/AGENTS.md'), 'A real source folder.');
  expect((await projectAiContexts(ordinary.project)).paths).toContain(
    join(ordinary.project, 'Library/Feature'),
  );
});

test('an empty or malformed MCP config retains earlier installation relationships without rewriting source files or exposing parser context', async () => {
  const data = await setup();
  const path = join(data.project, '.mcp.json');
  const scanProject = () =>
    scan(data.store, { roots: [data.project], globals: false, home: data.home });
  await write(path, '{"mcpServers":{"fixture":{"command":"fixture-server"}}}');
  await scanProject();
  const before = data.store.installations();
  await write(path, '');
  const empty = await scanProject();
  expect(scanDiagnostics(empty.skipped).map((item) => item.category)).toEqual(['empty']);
  expect(data.store.installations()).toEqual(before);
  expect(await Bun.file(path).text()).toBe('');
  await write(path, '{\n "API_TOKEN": "dummy-sensitive-token",\n broken\n}');
  const invalid = await scanProject();
  expect(invalid.skipped.join(' ')).not.toContain('dummy-sensitive-token');
  const diagnostic = scanDiagnostics(invalid.skipped)[0]!;
  expect(diagnostic.code).toBe('mcp-syntax');
  expect(diagnostic.line).toBe(3);
  expect(data.store.installations()).toEqual(before);
  expect(readInventoryMcpConfig('', 'toml')).toEqual({});
  expect(() => readInventoryMcpConfig('null', 'jsonc')).toThrow('must be an object');
  expect(readInventoryMcpConfig('{/* comment */ "mcp": {},}', 'jsonc')).toEqual({ mcp: {} });
});

test('scan notes distinguish deliberate exclusions and empty files from actionable incomplete/unreadable coverage, including legacy receipts', () => {
  const warning = '/fixture/cache: Plugin discovery limit reached; inventory is partial.';
  const notes = scanDiagnostics([
    warning,
    warning,
    '/fixture/token.ts: Non-guidance or private runtime target excluded.',
    '/fixture/mcp.json: Empty MCP configuration; no definitions read and previous observations retained.',
    '/fixture/old.json: MCP configuration could not be indexed. Check its format, size and permissions.',
  ]);
  expect(notes.map((item) => item.category)).toEqual([
    'incomplete',
    'excluded',
    'empty',
    'unreadable',
  ]);
  expect(
    notes.filter((item) => item.category === 'incomplete' || item.category === 'unreadable'),
  ).toHaveLength(2);
  expect(notes[0]!.path).toBe('/fixture/cache');
});
