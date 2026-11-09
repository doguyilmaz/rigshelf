import type { Entry, Source } from './model';
import { hash, now, scanText, slug } from './safety';
import type { Store } from './store';

export function recordPluginRecipe(store: Store, source: Source, recipe = source.recipe): void {
  if (!recipe.startsWith('/plugin ')) return;
  const digest = hash(recipe);
  const id = `plugin-${digest.slice(0, 24)}`;
  if (store.entry(id)) return;
  const subject = recipe.split(/\s+/).at(-1) || source.name;
  const entry: Entry = {
    id,
    name: slug(subject),
    description: 'Claude Code plugin recipe. Review and run in the native agent session.',
    kind: 'plugin',
    tags: ['claude', 'plugin'],
    sourceId: source.id,
    digest,
    custom: false,
    body: recipe,
    findings: [
      ...scanText(recipe),
      {
        code: 'native-plugin',
        level: 'info',
        message:
          'This is a native plugin recipe, not a portable skill. Hooks, tools and permissions must be reviewed in the target harness.',
      },
    ],
    updatedAt: now(),
  };
  store.saveEntry(entry);
}
