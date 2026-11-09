import { afterEach, expect, test } from 'bun:test';
import { link, mkdir, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportLibrary, importLibrary } from '../src/core/backup';
import { defaultLibraryFilters, filterLibrary, libraryItems } from '../src/core/library';
import { pluginStatus, usageLocations } from '../src/core/plugin-evidence';
import { MAX_PLUGIN_METADATA_BYTES, readPluginFile } from '../src/core/plugin-files';
import { readPluginRegistry } from '../src/core/plugin-manifests';
import { scan } from '../src/core/scanner';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  await write(join(data.project, 'package.json'), '{}');
  return data;
}
async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}
const json = (path: string, value: unknown) => write(path, JSON.stringify(value));
const rescan = (data: Awaited<ReturnType<typeof setup>>) =>
  scan(data.store, { roots: [data.project], globals: true, home: data.home, environment: {} });
const portable = (name: string) => ({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name,
  version: '1.2.0',
});

test('Claude native registry preserves user/project/local relationships, versions, disabled declarations and alias deduplication', async () => {
  const data = await setup();
  const cache = join(data.home, '.claude/plugins/cache/acme/reviewer/1');
  await json(join(cache, '.claude-plugin/plugin.json'), {
    name: 'reviewer',
    version: '1.0.0',
    hooks: './hooks.json',
  });
  const child = join(data.project, 'apps/mobile');
  await json(join(child, 'package.json'), {});
  const registry = join(data.home, '.claude/plugins/installed_plugins.json');
  await json(registry, {
    version: 2,
    plugins: {
      'reviewer@acme': [
        { scope: 'user', installPath: cache, version: '1.0.0' },
        { scope: 'project', installPath: cache, version: '1.0.0', projectPath: child },
        { scope: 'local', installPath: cache, version: '0.9.0', projectPath: data.project },
      ],
    },
  });
  await write(join(data.project, '.gitignore'), '.claude\napps\n');
  await json(join(data.project, '.claude/settings.local.json'), {
    enabledPlugins: { 'reviewer@acme': false },
  });
  await json(join(child, '.claude/settings.json'), { enabledPlugins: { 'reviewer@acme': true } });
  const profile = join(data.home, '.aims/profiles/claude/work');
  await mkdir(profile, { recursive: true });
  await symlink(join(data.home, '.claude/plugins'), join(profile, 'plugins'));
  const result = await rescan(data);
  expect(result.skipped).toEqual([]);
  const locations = data.store.installations().filter((location) => location.plugin);
  expect(locations.filter((location) => location.plugin?.evidence === 'installed')).toHaveLength(3);
  expect(locations.filter((location) => location.plugin?.evidence === 'configured')).toHaveLength(
    2,
  );
  expect(locations.filter((location) => location.plugin?.evidence === 'cached')).toHaveLength(1);
  const nested = data.store.projects().find((project) => project.path === child)!;
  expect(nested.discovery).not.toBe('configuration');
  expect(locations.find((location) => location.plugin?.enabled === true)?.projectId).toBe(
    nested.id,
  );
  expect(
    locations.find((location) => location.plugin?.enabled === false)?.plugin?.declaredScope,
  ).toBe('local');
  const items = libraryItems(
    { entries: data.store.entries(true), sources: data.store.sources(), installations: locations },
    'active',
  );
  expect(items).toHaveLength(1);
  expect(items[0]!.versions).toHaveLength(3);
  expect(pluginStatus(items[0]!.locations)).toBe('installed');
  expect(usageLocations(items[0]!.locations)).toHaveLength(5);
  expect(
    filterLibrary(items, {
      ...defaultLibraryFilters(),
      kind: 'plugin',
      evidence: 'installed',
      project: nested.id,
    }),
  ).toHaveLength(1);
  const snapshot = data.store.entry(items[0]!.entry.id)!;
  snapshot.tags.push('my-label');
  snapshot.archived = true;
  data.store.saveEntry(snapshot);
  const bodies = new Map(
    data.store.entries().map((entry) => [entry.id, data.store.entry(entry.id)!.body]),
  );
  await rescan(data);
  expect(data.store.entry(snapshot.id)?.tags).toContain('my-label');
  expect(data.store.entry(snapshot.id)?.archived).toBe(true);
  for (const [id, body] of bodies) expect(data.store.entry(id)?.body).toBe(body);
});

test('Codex portable and legacy packages, catalog-only packages and ignored project declarations stay distinct', async () => {
  const data = await setup();
  const cache = join(data.home, '.codex/plugins/cache/openai/example/hash');
  await json(join(cache, 'plugin.json'), portable('example'));
  await write(
    join(data.home, '.codex/config.toml'),
    '[plugins."example@openai"]\nenabled = true\n',
  );
  const catalog = join(data.home, '.claude/plugins/marketplaces/acme');
  await json(join(catalog, '.claude-plugin/marketplace.json'), {
    name: 'acme',
    plugins: [{ name: 'catalog-tool', source: './packages/catalog-tool' }],
  });
  await json(join(catalog, 'packages/catalog-tool/.claude-plugin/plugin.json'), {
    name: 'catalog-tool',
  });
  const local = join(data.project, 'packages/local');
  await json(join(local, '.codex-plugin/plugin.json'), { name: 'local-guide', skills: './guides' });
  await write(
    join(local, 'guides/guide/SKILL.md'),
    '---\nname: nested-guide\ndescription: A bundled guide.\n---\nFollow project rules.',
  );
  await write(join(data.project, '.gitignore'), '*');
  await write(
    join(data.project, '.codex/config.toml'),
    '[plugins."example@openai"]\nenabled = false\n',
  );
  const result = await rescan(data);
  expect(result.skipped).toEqual([]);
  const entries = data.store.entries(true);
  expect(entries.some((entry) => entry.name === 'nested-guide' && entry.kind === 'skill')).toBe(
    true,
  );
  expect(entries.some((entry) => entry.plugin?.manifest === 'portable')).toBe(true);
  const items = libraryItems(
    { entries, sources: data.store.sources(), installations: data.store.installations() },
    'active',
  );
  const onlyCatalog = filterLibrary(items, {
    ...defaultLibraryFilters(),
    kind: 'plugin',
    evidence: 'catalog',
  });
  expect(onlyCatalog.map((item) => item.entry.name)).toEqual(['catalog-tool@acme']);
  expect(usageLocations(onlyCatalog[0]!.locations)).toEqual([]);
  expect(
    filterLibrary(items, { ...defaultLibraryFilters(), kind: 'plugin', evidence: 'installed' }),
  ).toEqual([]);
  const exported = exportLibrary(data.store);
  expect(JSON.stringify(exported)).not.toContain(data.root);
  expect(JSON.stringify(exported)).not.toContain('declaredScope');
  const other = await setup();
  const tampered = structuredClone(exported);
  const reference = tampered.entries.find((value) => value.entry.plugin)!;
  reference.entry.plugin!.nativeId = 'different-plugin';
  expect(() => importLibrary(other.store, tampered, true)).toThrow('differs from its snapshot');
  expect(other.store.entries(true)).toHaveLength(0);
  importLibrary(other.store, exported, true);
  expect(other.store.entries(true).filter((entry) => entry.plugin)).toHaveLength(
    entries.filter((entry) => entry.plugin).length,
  );
  expect(other.store.installations()).toHaveLength(0);
});

test('OpenCode npm declarations and local modules are read without executing code or visiting dependency/runtime folders', async () => {
  const data = await setup();
  const marker = join(data.root, 'execution-marker');
  const module = join(data.project, '.opencode/plugins/with space.ts');
  await write(module, `await Bun.write(${JSON.stringify(marker)}, 'must not run');`);
  await json(join(data.project, 'opencode.jsonc'), {
    plugin: ['@acme/review@1.0.0', pathToFileURL(module).href, 'file:%invalid'],
  });
  await write(
    join(data.home, '.config/opencode/plugin/global.ts'),
    'throw new Error("must not execute");',
  );
  await json(join(data.project, 'node_modules/dependency/.claude-plugin/plugin.json'), {
    name: 'not-inventory',
  });
  await json(
    join(data.home, '.codex/plugins/.remote-plugin-install-staging/untrusted/plugin.json'),
    portable('not-inventory'),
  );
  const result = await rescan(data);
  expect(result.skipped.join(' ')).toContain('previous inventory retained');
  expect(await Bun.file(marker).exists()).toBe(false);
  const entries = data.store.entries(true).filter((entry) => entry.kind === 'plugin');
  expect(entries.map((entry) => entry.name).sort()).toEqual([
    '@acme/review@1.0.0',
    'global.ts',
    'with space.ts',
  ]);
  expect(
    data.store.installations().filter((location) => location.plugin?.evidence === 'configured'),
  ).toHaveLength(2);
});

test('clean declaration/registry removal prunes only current relationships; malformed and unavailable scans preserve prior data', async () => {
  const data = await setup();
  const config = join(data.home, '.claude/settings.json');
  const registry = join(data.home, '.claude/plugins/installed_plugins.json');
  await json(config, { enabledPlugins: { 'reviewer@acme': true } });
  await json(registry, { version: 1, plugins: { 'legacy@acme': { version: '1.0.0' } } });
  expect((await rescan(data)).skipped).toEqual([]);
  const before = data.store.entries(true);
  expect(data.store.installations()).toHaveLength(2);
  await write(registry, '{"version":');
  await write(config, '{');
  expect((await rescan(data)).skipped.length).toBeGreaterThan(0);
  expect(data.store.installations()).toHaveLength(2);
  await rename(join(data.home, '.claude'), join(data.home, '.claude-offline'));
  await rescan(data);
  expect(data.store.installations()).toHaveLength(2);
  await rename(join(data.home, '.claude-offline'), join(data.home, '.claude'));
  await json(registry, { version: 2, plugins: {} });
  await json(config, {});
  await rescan(data);
  expect(data.store.installations()).toHaveLength(0);
  expect(data.store.entries(true)).toEqual(before);
});

test('metadata bounds and canonical containment reject linked leaves and private/external targets while invalid siblings do not erase valid records', async () => {
  const data = await setup();
  const allowed = join(data.project, '.claude');
  await mkdir(allowed, { recursive: true });
  const external = join(data.root, 'external.json');
  await json(external, { name: 'external' });
  await symlink(external, join(allowed, 'linked.json'));
  await link(external, join(allowed, 'hard.json'));
  await write(join(allowed, 'large.json'), ' '.repeat(MAX_PLUGIN_METADATA_BYTES + 1));
  const warnings: string[] = [];
  for (const name of ['linked.json', 'hard.json', 'large.json'])
    expect(await readPluginFile(join(allowed, name), [data.project], warnings)).toBeUndefined();
  const registry = join(allowed, 'installed_plugins.json');
  await json(registry, {
    version: 2,
    plugins: { 'valid@acme': [{ scope: 'user' }], 'invalid@acme': [{ scope: 'project' }] },
  });
  const parsed = await readPluginRegistry(registry, [data.project], warnings);
  expect(parsed?.records.map((record) => record.nativeId)).toEqual(['valid@acme']);
  expect(parsed?.complete).toBe(false);
  expect(warnings).toHaveLength(4);
  await rm(join(allowed, 'hard.json'));
});

test('metadata project references do not grant traversal outside selected roots or load external packages and custom Skill paths', async () => {
  const data = await setup();
  const external = join(data.root, 'unselected');
  await json(join(external, '.claude-plugin/plugin.json'), {
    name: 'private-outside',
    version: '1.0.0',
  });
  await json(join(external, '.claude/settings.json'), {
    enabledPlugins: { 'must-not-read@outside': true },
  });
  await write(
    join(external, 'SKILL.md'),
    '---\nname: outside-guide\ndescription: Must remain outside discovery.\n---\nPrivate.',
  );
  await json(join(data.home, '.claude/plugins/installed_plugins.json'), {
    version: 2,
    plugins: {
      'declared@acme': [
        { scope: 'project', projectPath: external, installPath: external, version: '1.0.0' },
      ],
    },
  });
  await json(join(data.project, '.claude-plugin/plugin.json'), { name: 'local', skills: external });
  const result = await rescan(data);
  expect(result.skipped.join(' ')).toContain('external Plugin Skill directory excluded');
  const entries = data.store.entries(true);
  expect(entries.map((entry) => entry.name).sort()).toEqual(['declared@acme', 'local']);
  expect(
    entries.find((entry) => entry.name === 'declared@acme')?.plugin?.contentDigest,
  ).toBeUndefined();
  const reference = data.store.projects().find((project) => project.path === external)!;
  expect(reference.discovery).toBe('configuration');
  expect(reference.aiFileLocations).toBeUndefined();
  expect(
    data.store.installations().filter((location) => location.plugin?.evidence === 'installed'),
  ).toHaveLength(1);
});

test('package version changes replace current cache evidence without deleting historical Snapshot content', async () => {
  const data = await setup();
  const manifest = join(
    data.home,
    '.claude/plugins/cache/acme/reviewer/current/.claude-plugin/plugin.json',
  );
  await json(manifest, { name: 'reviewer', version: '1.0.0' });
  await rescan(data);
  const before = data.store.entries(true)[0]!;
  const body = data.store.entry(before.id)!.body;
  await json(manifest, { name: 'reviewer', version: '2.0.0' });
  await rescan(data);
  expect(data.store.entries(true)).toHaveLength(2);
  expect(data.store.entry(before.id)?.body).toBe(body);
  expect(data.store.installations()).toHaveLength(1);
  expect(data.store.installations()[0]!.plugin?.version).toBe('2.0.0');
  expect(
    filterLibrary(
      libraryItems(
        {
          entries: data.store.entries(true),
          sources: data.store.sources(),
          installations: data.store.installations(),
        },
        'active',
      ),
      { ...defaultLibraryFilters(), kind: 'plugin', scope: 'global' },
    ),
  ).toHaveLength(0);
});

test('project and evidence filters bind to the same observation, and project-only refreshes retain global Plugin data', async () => {
  const data = await setup();
  await json(join(data.home, '.claude/plugins/installed_plugins.json'), {
    version: 2,
    plugins: { 'reviewer@acme': [{ scope: 'user' }] },
  });
  await json(join(data.project, '.claude/settings.json'), {
    enabledPlugins: { 'reviewer@acme': false },
  });
  await rescan(data);
  const project = data.store.projects()[0]!;
  const items = libraryItems(
    {
      entries: data.store.entries(true),
      sources: data.store.sources(),
      installations: data.store.installations(),
    },
    'active',
  );
  const filters = { ...defaultLibraryFilters(), kind: 'plugin' as const, project: project.id };
  expect(filterLibrary(items, { ...filters, evidence: 'installed' })).toHaveLength(0);
  expect(filterLibrary(items, { ...filters, evidence: 'configured' })).toHaveLength(1);
  await scan(data.store, {
    roots: [data.project],
    globals: false,
    home: data.home,
    environment: {},
  });
  expect(data.store.installations()).toHaveLength(2);
});
