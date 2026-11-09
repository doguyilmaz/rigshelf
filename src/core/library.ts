import type { Entry, Installation, Kind, Source } from './model';
import { type PluginStatus, usageLocations } from './plugin-evidence';
import {
  type Classification,
  classifyEntry,
  foldSearch,
  platforms,
  technologies,
  topics,
} from './taxonomy';

export interface LibraryFilters {
  kind: Kind | 'all';
  query: string;
  platforms: string[];
  technologies: string[];
  topics: string[];
  tags: string[];
  source: string;
  project: string;
  agent: string;
  scope: 'all' | 'project' | 'global' | 'unused';
  origin: 'all' | 'custom' | 'upstream';
  status: 'active' | 'archived' | 'all';
  review: 'all' | 'flagged' | 'blocked' | 'clean' | 'approved';
  evidence: 'all' | PluginStatus;
}
export const defaultLibraryFilters = (): LibraryFilters => ({
  kind: 'skill',
  query: '',
  platforms: [],
  technologies: [],
  topics: [],
  tags: [],
  source: 'all',
  project: 'all',
  agent: 'all',
  scope: 'all',
  origin: 'all',
  status: 'active',
  review: 'all',
  evidence: 'all',
});
type Metadata = Omit<Entry, 'body'>;
export interface LibraryItem {
  key: string;
  entry: Metadata;
  versions: Metadata[];
  source?: Source;
  locations: Installation[];
  classification: Classification;
  search: string;
  approved: boolean;
}
interface LibraryInput {
  entries: Metadata[];
  sources: Source[];
  installations: Installation[];
  trust?: { id: string; digest: string }[];
}
const labels = new Map(
  [...platforms, ...technologies, ...topics].map((item) => [
    item.id,
    `${item.label} ${item.aliases.join(' ')}`,
  ]),
);
export function libraryItems(state: LibraryInput, status: LibraryFilters['status']): LibraryItem[] {
  const families = new Map<string, Metadata[]>();
  const sources = new Map(state.sources.map((source) => [source.id, source]));
  const installations = new Map<string, Installation[]>();
  const approved = new Set(state.trust?.map((value) => `${value.id}:${value.digest}`));
  for (const location of state.installations) {
    const values = installations.get(location.entryId) ?? [];
    values.push(location);
    installations.set(location.entryId, values);
  }
  for (const entry of state.entries) {
    const key = JSON.stringify([entry.kind, entry.sourceId, entry.name]);
    const versions = families.get(key) ?? [];
    versions.push(entry);
    families.set(key, versions);
  }
  const result: LibraryItem[] = [];
  for (const [key, versions] of families) {
    versions.sort(
      (left, right) =>
        (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
        left.id.localeCompare(right.id),
    );
    const entry = versions.find(
      (value) => status === 'all' || (status === 'archived' ? value.archived : !value.archived),
    );
    if (!entry) continue;
    const source = sources.get(entry.sourceId);
    const classification = classifyEntry(entry);
    const semanticLabels = Object.values(classification)
      .flat()
      .map((value) => labels.get(value) ?? value);
    result.push({
      key,
      entry,
      versions,
      source,
      classification,
      locations: versions.flatMap((version) => installations.get(version.id) ?? []),
      approved: approved.has(`${entry.id}:${entry.digest}`),
      search: foldSearch(
        [
          entry.name,
          entry.description,
          ...entry.tags,
          source?.name,
          source?.url,
          ...semanticLabels,
        ].join(' '),
      ),
    });
  }
  return result.sort((left, right) => compareLibraryItems(left, right, 'name'));
}
export function compareLibraryItems(left: LibraryItem, right: LibraryItem, sort: string): number {
  const usage = (item: LibraryItem) =>
    new Set(item.locations.map((location) => location.projectId).filter(Boolean)).size;
  const primary =
    sort === 'updated'
      ? (Date.parse(right.entry.updatedAt) || 0) - (Date.parse(left.entry.updatedAt) || 0)
      : sort === 'usage'
        ? usage(right) - usage(left)
        : 0;
  return (
    primary || left.entry.name.localeCompare(right.entry.name) || left.key.localeCompare(right.key)
  );
}
const any = (selected: string[], actual: string[]) =>
  !selected.length ||
  selected.some((value) => (value === 'unclassified' ? !actual.length : actual.includes(value)));
export function matchesLibraryItem(
  item: LibraryItem,
  filters: LibraryFilters,
  omit?: keyof LibraryFilters,
): boolean {
  const { entry, classification, locations } = item;
  if (omit !== 'evidence' && filters.evidence && filters.evidence !== 'all') {
    if (entry.kind !== 'plugin') return false;
    if (
      filters.evidence === 'reference'
        ? locations.some((location) => location.plugin)
        : !locations.some((location) => location.plugin?.evidence === filters.evidence)
    )
      return false;
  }
  if (omit !== 'kind' && filters.kind !== 'all' && entry.kind !== filters.kind) return false;
  if (omit !== 'source' && filters.source !== 'all' && entry.sourceId !== filters.source)
    return false;
  if (filters.origin !== 'all' && entry.custom !== (filters.origin === 'custom')) return false;
  if (
    !(['platforms', 'technologies', 'topics'] as const).every(
      (axis) => omit === axis || any(filters[axis], classification[axis]),
    )
  )
    return false;
  if (omit !== 'tags' && !any(filters.tags, entry.tags)) return false;
  const needsLocation =
    filters.project !== 'all' || filters.agent !== 'all' || filters.scope !== 'all';
  if (needsLocation) {
    if (filters.scope === 'unused') {
      if (usageLocations(locations).length || filters.project !== 'all' || filters.agent !== 'all')
        return false;
    } else if (
      !(filters.scope === 'all' ? locations : usageLocations(locations)).some(
        (location) =>
          (filters.evidence === 'all' ||
            !filters.evidence ||
            location.plugin?.evidence === filters.evidence) &&
          (filters.project === 'all' || location.projectId === filters.project) &&
          (filters.agent === 'all' || location.provider === filters.agent) &&
          (filters.scope === 'all' || location.scope === filters.scope),
      )
    )
      return false;
  }
  const flagged = entry.findings.some((value) => value.level !== 'info');
  if (filters.review === 'flagged' && !flagged) return false;
  if (filters.review === 'blocked' && !entry.findings.some((value) => value.level === 'block'))
    return false;
  if (filters.review === 'clean' && flagged) return false;
  if (filters.review === 'approved' && !item.approved) return false;
  return foldSearch(filters.query)
    .trim()
    .split(/\s+/)
    .every((word) => item.search.includes(word));
}
export function filterLibrary(items: LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  return items.filter((item) => matchesLibraryItem(item, filters));
}
export function facetCounts(
  items: LibraryItem[],
  filters: LibraryFilters,
  axis: 'kind' | 'platforms' | 'technologies' | 'topics' | 'tags',
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!matchesLibraryItem(item, filters, axis)) continue;
    const values =
      axis === 'kind'
        ? [item.entry.kind]
        : axis === 'tags'
          ? item.entry.tags
          : item.classification[axis];
    for (const value of new Set(values.length ? values : ['unclassified']))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
