import type { LibraryItem } from './library';
import type { Source } from './model';

export type LibraryGrouping = 'source' | 'none';
export const SOURCE_GROUP_PAGE_SIZE = 12;
export interface LibrarySourceGroup {
  key: string;
  source?: Source;
  sourceId: string;
  items: LibraryItem[];
  total: number;
}

/** A display hierarchy only. Source relationships and immutable snapshots stay unchanged. */
export function librarySourceGroups(
  matches: LibraryItem[],
  allItems: LibraryItem[],
): LibrarySourceGroup[] {
  const totals = new Map<string, number>();
  for (const item of allItems)
    totals.set(item.entry.sourceId, (totals.get(item.entry.sourceId) || 0) + 1);
  const groups = new Map<string, LibrarySourceGroup>();
  for (const item of matches) {
    const sourceId = item.entry.sourceId;
    let group = groups.get(sourceId);
    if (!group) {
      group = {
        key: sourceId,
        sourceId,
        source: item.source,
        items: [],
        total: totals.get(sourceId) || 0,
      };
      groups.set(sourceId, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
