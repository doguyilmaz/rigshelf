import { afterEach, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { setupProject } from '../src/cli-operations';
import type { Preset, Rule } from '../src/core/model';
import { route } from '../src/core/service';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  return data;
}
const preset: Preset = {
  id: 'focused-work',
  name: 'Focused work',
  description: 'A reusable starting point.',
  parentId: 'base',
  stacks: ['typescript'],
  selectors: [],
  entryIds: [],
  excludedIds: [],
  providers: ['opencode'],
};
const rule: Rule = {
  id: 'focused-guidance',
  name: 'Focused guidance',
  scope: 'typescript',
  content: 'Keep functions focused.',
  enabled: true,
  priority: 50,
  provenance: 'Custom',
};

test('create-only Preset and Directive routes reject ID collisions without replacing definitions or recording success', async () => {
  const { store } = await setup();
  await route(store, 'POST', 'presets', preset);
  await route(store, 'POST', 'rules', rule);
  const events = store.events();
  await expect(
    route(store, 'POST', 'presets', { ...preset, name: 'Unintended replacement' }),
  ).rejects.toThrow('already exists');
  await expect(
    route(store, 'POST', 'rules', { ...rule, content: 'Unintended replacement' }),
  ).rejects.toThrow('already exists');
  expect(store.get('preset', preset.id)).toEqual(preset);
  expect(store.get('rule', rule.id)).toEqual(rule);
  expect(store.events()).toEqual(events);
  await route(store, 'PUT', 'presets', { ...preset, description: 'An explicit update.' });
  expect(store.get<Preset>('preset', preset.id)?.description).toBe('An explicit update.');
});

test('invalid Preset graphs roll back creation and updates atomically', async () => {
  const { store } = await setup();
  await route(store, 'POST', 'presets', preset);
  const events = store.events();
  await expect(
    route(store, 'POST', 'presets', { ...preset, id: 'missing-parent', parentId: 'missing' }),
  ).rejects.toThrow('does not exist');
  expect(store.get('preset', 'missing-parent')).toBeUndefined();
  await expect(route(store, 'PUT', 'presets', { ...preset, parentId: preset.id })).rejects.toThrow(
    'cycle',
  );
  expect(store.get('preset', preset.id)).toEqual(preset);
  expect(store.events()).toEqual(events);
});

test('CLI plans use explicit Agent choices, otherwise explicit Preset defaults, otherwise application defaults', async () => {
  const { store, project } = await setup();
  await Bun.write(join(project, 'package.json'), '{}');
  store.put('settings', { id: 'main', ...store.settings(), defaultProviders: ['codex'] });
  await route(store, 'POST', 'presets', preset);
  const automatic = await setupProject(store, project, { entries: '' });
  const fromPreset = await setupProject(store, project, { entries: '', presetId: preset.id });
  const explicit = await setupProject(store, project, {
    entries: '',
    presetId: preset.id,
    providers: ['claude'],
  });
  expect(automatic.providers).toEqual(['codex']);
  expect(fromPreset.providers).toEqual(['opencode']);
  expect(explicit.providers).toEqual(['claude']);
  expect(await Bun.file(join(project, '.kitfold/kit.json')).exists()).toBe(false);
  expect(store.list('approval')).toEqual([]);
});

test('checked Preset edits and deletes preserve a newer definition and never resurrect a removed record', async () => {
  const { store } = await setup();
  await route(store, 'POST', 'presets', preset);
  const revised = { ...preset, description: 'Saved in another window.' };
  await route(store, 'PATCH', `presets/${preset.id}`, { value: revised, expected: preset });
  const events = store.events();
  await expect(
    route(store, 'PATCH', `presets/${preset.id}`, {
      value: { ...preset, name: 'Stale edit' },
      expected: preset,
    }),
  ).rejects.toThrow('changed or was removed');
  await expect(
    route(store, 'DELETE', `presets/${preset.id}`, { expected: preset }),
  ).rejects.toThrow('changed or was removed');
  expect(store.get('preset', preset.id)).toEqual(revised);
  expect(store.events()).toEqual(events);
  await expect(route(store, 'PATCH', `presets/${preset.id}`, { value: revised })).rejects.toThrow();
  await expect(
    route(store, 'PATCH', 'presets/another-id', { value: revised, expected: revised }),
  ).rejects.toThrow('does not match');
  await route(store, 'DELETE', `presets/${preset.id}`, { expected: revised });
  await expect(
    route(store, 'PATCH', `presets/${preset.id}`, { value: revised, expected: revised }),
  ).rejects.toThrow('changed or was removed');
  expect(store.get('preset', preset.id)).toBeUndefined();
});

test('checked Directive edits and deletes compare normalized authored fields atomically without applying project files', async () => {
  const { store } = await setup();
  await route(store, 'POST', 'rules', rule);
  const revised = { ...rule, content: 'A newer authored instruction.', enabled: false };
  await route(store, 'PATCH', `rules/${rule.id}`, { value: revised, expected: rule });
  const events = store.events();
  await expect(
    route(store, 'PATCH', `rules/${rule.id}`, {
      value: { ...rule, content: 'Stale overwrite.' },
      expected: rule,
    }),
  ).rejects.toThrow('changed or was removed');
  await expect(route(store, 'DELETE', `rules/${rule.id}`, { expected: rule })).rejects.toThrow(
    'changed or was removed',
  );
  expect(store.get('rule', rule.id)).toEqual(revised);
  expect(store.events()).toEqual(events);
  await expect(
    route(store, 'PATCH', 'rules/another-id', { value: revised, expected: revised }),
  ).rejects.toThrow('does not match');
  // Object key order is not an authored change: schema normalization precedes comparison.
  const reversed = Object.fromEntries(Object.entries(revised).reverse());
  await route(store, 'DELETE', `rules/${rule.id}`, { expected: reversed });
  expect(store.get('rule', rule.id)).toBeUndefined();
  expect(store.planSummaries()).toEqual([]);
  expect(store.list('approval')).toEqual([]);
});

test('CLI create-only and checked updates use bounded definition files while preserving a newer saved version', async () => {
  const { root, store } = await setup();
  const input = join(root, 'definition.json');
  const expected = join(root, 'expected.json');
  await Bun.write(input, JSON.stringify(preset));
  await Bun.write(expected, JSON.stringify(preset));
  async function save(args: string[]) {
    const child = Bun.spawn(
      [process.execPath, resolve('src/cli.ts'), 'save-preset', input, ...args],
      { env: { KITFOLD_DATA_DIR: store.directory }, stdout: 'pipe', stderr: 'pipe' },
    );
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    return { code, stderr };
  }
  expect((await save(['--create-only'])).code).toBe(0);
  const revised = { ...preset, description: 'An explicit checked CLI update.' };
  await Bun.write(input, JSON.stringify(revised));
  expect((await save(['--expect', expected])).code).toBe(0);
  const stale = await save(['--expect', expected]);
  expect(stale.code).toBe(1);
  expect(stale.stderr).toContain('changed or was removed');
  expect((await save(['--create-only'])).code).toBe(1);
  expect((await save(['--create-only', '--expect', expected])).code).toBe(1);
  await Bun.write(expected, 'null');
  await Bun.write(input, JSON.stringify({ ...preset, description: 'Must not bypass the check.' }));
  expect((await save(['--expect', expected])).code).toBe(1);
  expect(store.get('preset', preset.id)).toEqual(revised);
  expect(store.planSummaries()).toEqual([]);
  expect(store.list('approval')).toEqual([]);
});
