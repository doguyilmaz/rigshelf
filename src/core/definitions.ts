import { z } from 'zod';
import { guidanceFindings } from './guidance';
import { type Preset, PresetSchema, type Rule, RuleSchema } from './model';
import { presetChain } from './recommend';
import type { Store } from './store';

export class DefinitionConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionConflict';
  }
}

export function savePreset(
  store: Store,
  input: unknown,
  options: { createOnly?: boolean; expected?: Preset } = {},
): Preset {
  const preset = PresetSchema.parse(input);
  return store.db.transaction(() => {
    const previous = store.get<Preset>('preset', preset.id);
    if (options.createOnly && previous)
      throw new DefinitionConflict('That preset ID already exists. Choose another ID.');
    if (options.expected) assertPresetUnchanged(previous, options.expected);
    store.put('preset', preset);
    presetChain(store, preset.id);
    store.event('preset.saved', preset.name);
    return preset;
  })();
}

export function saveRule(
  store: Store,
  input: unknown,
  options: { createOnly?: boolean; expected?: Rule } = {},
): Rule {
  const rule = RuleSchema.parse(input);
  if (guidanceFindings(rule).some((finding) => finding.level === 'block'))
    throw new Error(
      'Keep credential-looking values outside reusable directives. Use environment references.',
    );
  return store.db.transaction(() => {
    const previous = store.get<Rule>('rule', rule.id);
    if (options.createOnly && previous)
      throw new DefinitionConflict('That directive ID already exists. Refresh and try again.');
    if (options.expected) assertRuleUnchanged(previous, options.expected);
    store.put('rule', rule);
    store.event('rule.saved', rule.name);
    return rule;
  })();
}

function assertPresetUnchanged(current: Preset | undefined, expected: Preset): void {
  if (!current || JSON.stringify(PresetSchema.parse(current)) !== JSON.stringify(expected))
    throw new DefinitionConflict(
      'This Preset changed or was removed. Your edits are still here. Reopen it to compare before saving.',
    );
}
function assertRuleUnchanged(current: Rule | undefined, expected: Rule): void {
  if (!current || JSON.stringify(RuleSchema.parse(current)) !== JSON.stringify(expected))
    throw new DefinitionConflict(
      'This Directive changed or was removed. Your edits are still here. Reopen it to compare before saving.',
    );
}
export function updatePreset(store: Store, id: string, input: unknown): Preset {
  const edit = z.object({ value: PresetSchema, expected: PresetSchema }).strict().parse(input);
  if (edit.value.id !== id || edit.expected.id !== id)
    throw new Error('Definition ID does not match its route.');
  return savePreset(store, edit.value, { expected: edit.expected });
}
export function updateRule(store: Store, id: string, input: unknown): Rule {
  const edit = z.object({ value: RuleSchema, expected: RuleSchema }).strict().parse(input);
  if (edit.value.id !== id || edit.expected.id !== id)
    throw new Error('Definition ID does not match its route.');
  return saveRule(store, edit.value, { expected: edit.expected });
}

export function removePreset(store: Store, id: string, input: unknown): { removed: true } {
  const { expected } = z
    .object({ expected: PresetSchema.optional() })
    .strict()
    .parse(input ?? {});
  if (expected && expected.id !== id) throw new Error('Definition ID does not match its route.');
  return store.db.transaction(() => {
    if (expected) assertPresetUnchanged(store.get<Preset>('preset', id), expected);
    if (store.list<Preset>('preset').some((preset) => preset.parentId === id))
      throw new Error('Reassign child presets before removing this parent.');
    store.remove('preset', id);
    return { removed: true as const };
  })();
}
export function removeRule(store: Store, id: string, input: unknown): { removed: true } {
  const { expected } = z
    .object({ expected: RuleSchema.optional() })
    .strict()
    .parse(input ?? {});
  if (expected && expected.id !== id) throw new Error('Definition ID does not match its route.');
  return store.db.transaction(() => {
    if (expected) assertRuleUnchanged(store.get<Rule>('rule', id), expected);
    store.remove('rule', id);
    return { removed: true as const };
  })();
}
