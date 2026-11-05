import type { Entry } from '../src/core/model';
import { slug } from '../src/core/names';

/** Keep deliberate choices and exact snapshot versions ahead of refreshed suggestions. */
export function setupSelection(
  recommended: string[],
  edits: ReadonlyMap<string, boolean>,
  entries: Omit<Entry, 'body'>[],
): string[] {
  const available = new Map(entries.map((entry) => [entry.id, entry]));
  const selected: string[] = [];
  const names = new Set<string>();
  const explicit = [...edits].filter(([, enabled]) => enabled).map(([id]) => id);
  const excludedNames = new Set(
    [...edits]
      .filter(([, enabled]) => !enabled)
      .flatMap(([id]) => {
        const entry = available.get(id);
        return entry ? [`${entry.kind}:${slug(entry.name)}`] : [];
      }),
  );
  for (const id of [...explicit, ...recommended]) {
    const entry = available.get(id);
    if (!entry || !['skill', 'mcp'].includes(entry.kind) || edits.get(id) === false) continue;
    const name = `${entry.kind}:${slug(entry.name)}`;
    if (edits.get(id) !== true && excludedNames.has(name)) continue;
    if (names.has(name)) continue;
    names.add(name);
    selected.push(id);
  }
  return selected;
}
