import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
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
