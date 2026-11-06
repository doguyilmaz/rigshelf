import { guidanceFindings } from './guidance';
import { type Preset, PresetSchema, type Rule, RuleSchema } from './model';
import { presetChain } from './recommend';
import type { Store } from './store';

/** Saves a validated Preset atomically; create-only calls preserve an existing ID. */
export function savePreset(
  store: Store,
  input: unknown,
  options: { createOnly?: boolean } = {},
): Preset {
  const preset = PresetSchema.parse(input);
  return store.db.transaction(() => {
    if (options.createOnly && store.get('preset', preset.id))
      throw new Error('That preset ID already exists. Choose another ID.');
    store.put('preset', preset);
    presetChain(store, preset.id);
    store.event('preset.saved', preset.name);
    return preset;
  })();
}

/** Saves authored guidance without applying project files or granting automation. */
export function saveRule(
  store: Store,
  input: unknown,
  options: { createOnly?: boolean } = {},
): Rule {
  const rule = RuleSchema.parse(input);
  if (guidanceFindings(rule).some((finding) => finding.level === 'block'))
    throw new Error(
      'Keep credential-looking values outside reusable directives. Use environment references.',
    );
  return store.db.transaction(() => {
    if (options.createOnly && store.get('rule', rule.id))
      throw new Error('That directive ID already exists. Refresh and try again.');
    store.put('rule', rule);
    store.event('rule.saved', rule.name);
    return rule;
  })();
}
