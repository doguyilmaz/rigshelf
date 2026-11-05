import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Source } from './model';
import { recordPluginRecipe } from './recipes';
import { redact } from './safety';
import { classifyResource } from './seeds';
import type { Store } from './store';
import { checkSource, discoverSourceSkills } from './upstream';

export const AddSourceSchema = z
  .object({
    url: z.string().max(4096).optional(),
    input: z.string().max(5000).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    recipe: z.string().max(4096).default(''),
    research: z.boolean().default(true),
  })
  .refine(
    (value) => Boolean(value.url || value.input),
    'Provide a URL, repository, or installation command.',
  );
export function validateSourceUrl(value: string): void {
  if (!value) return;
  if (value.length > 4096) throw new Error('Source URL exceeds 4096 characters.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key|authorization/i.test(key),
    )
  )
    throw new Error(
      'Use a public HTTPS source URL without credentials or secret query parameters.',
    );
}
export async function addSource(store: Store, raw: unknown): Promise<Source> {
  const value = AddSourceSchema.parse(raw);
  let input = (value.input || value.url || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(input)) input = `https://github.com/${input}`;
  const source = classifyResource(redact(input));
  if (source.recipe.length > 4096) throw new Error('Installation recipe exceeds 4096 characters.');
  validateSourceUrl(source.url);
  if (value.name) source.name = value.name;
  if (value.recipe) {
    source.recipe = redact(value.recipe);
    source.recipeKind = 'explicit';
  }
  const focus = input.match(/^https:\/\/skills\.sh\/[^/]+\/[^/]+\/([^/?#]+)/)?.[1];
  source.focusSkill = focus || input.match(/--skill(?:=|\s+)([\w-]+)/)?.[1];
  const matching = source.url
    ? store
        .sources()
        .find((value) =>
          source.type === 'github' && value.type === 'github'
            ? value.url.toLowerCase() === source.url.toLowerCase()
            : value.url === source.url,
        )
    : undefined;
  if (matching) source.id = matching.id;
  else {
    const baseId = source.id;
    while (
      store.get('source', source.id) &&
      store.get<Source>('source', source.id)?.url !== source.url
    )
      source.id = `${baseId}-${randomUUID()}`;
  }
  const previous = store.get<Source>('source', source.id);
  const notes =
    previous && !previous.notes.includes(input)
      ? `${previous.notes}\n${redact(input)}`
      : previous?.notes || source.notes;
  if (notes.length > 20000)
    throw new Error(
      'Source notes reached their limit. Review the saved notes before adding another reference.',
    );
  store.put(
    'source',
    previous
      ? {
          ...previous,
          ...source,
          name: value.name || previous.name,
          categories: previous.categories || source.categories,
          recipe: value.recipe ? redact(value.recipe) : previous.recipe,
          recipeKind: value.recipe ? 'explicit' : previous.recipeKind,
          status: previous.status,
          checkedAt: previous.checkedAt,
          latestRef: previous.latestRef,
          notes,
        }
      : source,
  );
  const saved = store.get<Source>('source', source.id)!;
  store.event('source.added', saved.name);
  recordPluginRecipe(store, saved);
  if (value.research && source.type === 'github') {
    try {
      await discoverSourceSkills(store, source.id);
    } catch {
      await checkSource(store, source.id);
    }
  } else if (value.research && source.url) await checkSource(store, source.id);
  return store.get<Source>('source', source.id)!;
}
export function editSource(store: Store, id: string, raw: unknown): Source {
  const source = store.get<Source>('source', id);
  if (!source) throw new Error('Source not found');
  const value = z
    .object({
      name: z.string().trim().min(1).max(500),
      url: z.string().max(4096),
      recipe: z.string().max(4096),
      notes: z.string().max(20000),
    })
    .parse(raw);
  validateSourceUrl(value.url);
  const changed = value.url !== source.url;
  if (changed && (source.previousUrls?.length || 0) >= 1000)
    throw new Error(
      'Source URL history reached its limit. Export and reconcile the source before changing it again.',
    );
  const next: Source = {
    ...source,
    ...value,
    recipe: redact(value.recipe),
    recipeKind: 'explicit',
    notes: redact(value.notes),
    ...(changed
      ? {
          previousUrls: [
            ...(source.previousUrls || []),
            ...(source.url
              ? [{ url: source.url, checkedAt: source.checkedAt, ref: source.latestRef }]
              : []),
          ],
          status: 'unchecked',
          checkedAt: undefined,
          latestRef: undefined,
          skillCount: undefined,
          repository: undefined,
          focusSkill: undefined,
          type: /^https:\/\/(?:github\.com|skills\.sh)\//.test(value.url)
            ? 'github'
            : source.type === 'local'
              ? 'local'
              : 'resource',
        }
      : {}),
  };
  store.put('source', next);
  recordPluginRecipe(store, next);
  if (changed) store.remove('source-index', id);
  store.event('source.edited', next.name);
  return next;
}
