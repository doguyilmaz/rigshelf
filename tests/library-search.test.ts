import { expect, test } from 'bun:test';
import {
  defaultLibraryFilters,
  facetCounts,
  filterLibrary,
  libraryItems,
} from '../src/core/library';
import { librarySourceGroups } from '../src/core/library-groups';
import type { Entry, Installation, Source } from '../src/core/model';
import { classifyEntry } from '../src/core/taxonomy';
import { readLibraryFilters } from '../web/library-preferences';

const source: Source = {
  id: 'collection',
  name: 'Mobile Workshop',
  url: 'https://example.com/mobile',
  type: 'github',
  recipe: '',
  status: 'unchecked',
  notes: '',
};
const entry = (id: string, name: string, tags: string[], extra: Partial<Entry> = {}): Entry => ({
  id,
  name,
  tags,
  sourceId: source.id,
  description: 'Focused project guidance.',
  kind: 'skill',
  digest: id,
  custom: false,
  body: 'Original content',
  findings: [],
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});
const location = (
  entryId: string,
  projectId: string | null,
  provider: string,
  scope: 'global' | 'project',
): Installation => ({
  entryId,
  projectId,
  provider,
  scope,
  path: '/fictional/location',
  lastSeen: '2026-01-01T00:00:00Z',
});
const sample = [
  entry('expo', 'expo-auth', ['expo', 'better-auth']),
  entry('swift', 'ios-layout', ['ios', 'swiftui']),
  entry('hono', 'hono-auth', ['hono', 'better-auth']),
  entry('notes', 'team-notes', []),
];
const items = () =>
  libraryItems({ entries: sample, sources: [source], installations: [] }, 'active');

test('classification matches token boundaries and respects independent manual overrides', () => {
  expect(classifyEntry({ name: 'capital-review', tags: [] }).platforms).not.toContain('backend');
  expect(classifyEntry({ name: 'react-native-layout', tags: [] }).platforms).not.toContain('web');
  const custom = classifyEntry({
    name: 'expo-auth',
    tags: ['expo', 'platform:backend', 'technology:hono', 'topic:unclassified'],
  });
  expect(custom.platforms).toEqual(['backend']);
  expect(custom.technologies).toEqual(['hono']);
  expect(custom.topics).toEqual([]);
  expect(classifyEntry({ name: 'apple-ui', tags: ['platform:macos'] }).platforms).toEqual([
    'macos',
    'desktop',
  ]);
});
test('platform, technology and task combine across dimensions while selections within one dimension are alternatives', () => {
  const filters = {
    ...defaultLibraryFilters(),
    platforms: ['mobile'],
    technologies: ['expo', 'swiftui'],
    topics: ['auth'],
  };
  expect(filterLibrary(items(), filters).map((item) => item.entry.id)).toEqual(['expo']);
  expect(filterLibrary(items(), { ...filters, topics: [] }).map((item) => item.entry.id)).toEqual([
    'expo',
    'swift',
  ]);
  expect(
    filterLibrary(items(), { ...defaultLibraryFilters(), platforms: ['unclassified'] }).map(
      (item) => item.entry.id,
    ),
  ).toEqual(['notes']);
});
test('search finds separate words across names, source metadata, descriptions and semantic labels', () => {
  const rows = items();
  expect(
    filterLibrary(rows, { ...defaultLibraryFilters(), query: 'EXPO authentication workshop' }).map(
      (item) => item.entry.id,
    ),
  ).toEqual(['expo']);
  expect(
    filterLibrary(rows, { ...defaultLibraryFilters(), query: 'expo authentication missing' }),
  ).toHaveLength(0);
  const turkish = libraryItems(
    { entries: [entry('tr', 'Kimlik doğrulama', [])], sources: [source], installations: [] },
    'active',
  );
  expect(
    filterLibrary(turkish, { ...defaultLibraryFilters(), query: 'kimlik dogrulama' }),
  ).toHaveLength(1);
});
test('versions count once and installation filters must match the same location across old and current pins', () => {
  const original = entry('old', 'expo-auth', ['expo']);
  const latest = entry('latest', 'expo-auth', ['expo'], { updatedAt: '2026-11-01T00:00:00Z' });
  const rows = libraryItems(
    {
      entries: [original, latest],
      sources: [source],
      installations: [
        location('old', null, 'codex', 'global'),
        location('old', 'project-one', 'claude', 'project'),
      ],
    },
    'active',
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.entry.id).toBe('latest');
  expect(facetCounts(rows, defaultLibraryFilters(), 'technologies').get('expo')).toBe(1);
  expect(
    filterLibrary(rows, { ...defaultLibraryFilters(), scope: 'project', agent: 'codex' }),
  ).toHaveLength(0);
  expect(
    filterLibrary(rows, {
      ...defaultLibraryFilters(),
      scope: 'project',
      agent: 'claude',
      project: 'project-one',
    }),
  ).toHaveLength(1);
  expect(filterLibrary(rows, { ...defaultLibraryFilters(), scope: 'unused' })).toHaveLength(0);
});
test('facet counts ignore their own selection but retain other constraints and expose unclassified entries', () => {
  const filters = { ...defaultLibraryFilters(), platforms: ['mobile'], technologies: ['expo'] };
  const counts = facetCounts(items(), filters, 'technologies');
  expect(counts.get('expo')).toBe(1);
  expect(counts.get('swiftui')).toBe(1);
  expect(counts.has('hono')).toBe(false);
  expect(facetCounts(items(), defaultLibraryFilters(), 'platforms').get('unclassified')).toBe(1);
});
test('archival, origin and content review remain independent and approval matches the exact representative digest', () => {
  const archived = entry('old', 'expo-auth', ['expo'], { archived: true, custom: true });
  const blocked = entry('new', 'expo-auth', ['expo'], {
    updatedAt: '2026-10-01T00:00:00Z',
    findings: [{ level: 'block', code: 'fixture', message: 'Fictional finding' }],
  });
  const input = {
    entries: [archived, blocked],
    sources: [source],
    installations: [],
    trust: [{ id: 'new', digest: 'old-digest' }],
  };
  expect(
    filterLibrary(libraryItems(input, 'active'), {
      ...defaultLibraryFilters(),
      review: 'approved',
    }),
  ).toHaveLength(0);
  expect(
    filterLibrary(libraryItems(input, 'active'), { ...defaultLibraryFilters(), review: 'blocked' }),
  ).toHaveLength(1);
  expect(
    filterLibrary(libraryItems(input, 'archived'), {
      ...defaultLibraryFilters(),
      status: 'archived',
      origin: 'custom',
    }).map((item) => item.entry.id),
  ).toEqual(['old']);
});
test('browser filter preferences tolerate corrupt data, constrain values and preserve no executable behavior', () => {
  expect(readLibraryFilters(null)).toEqual(defaultLibraryFilters());
  const value = readLibraryFilters(
    JSON.parse(
      '{"kind":"constructor","platforms":["ios",null,3,"ios"],"scope":"unexpected","query":"hello","__proto__":{"polluted":true}}',
    ),
  );
  expect(value.kind).toBe('skill');
  expect(value.scope).toBe('all');
  expect(value.platforms).toEqual(['ios']);
  expect(value.query).toBe('hello');
  expect(Object.hasOwn({}, 'polluted')).toBe(false);
});

test('source groups preserve distinct relationships, custom content and orphaned source records', () => {
  const another = { ...source, id: 'another-collection' };
  const custom = { ...source, id: 'custom', name: 'Custom skills', type: 'local' as const };
  const rows = libraryItems(
    {
      entries: [
        ...sample,
        entry('other', 'another-guide', [], { sourceId: another.id }),
        entry('authored', 'custom-guide', [], { sourceId: custom.id, custom: true }),
        entry('orphan-a', 'retained-a', [], { sourceId: 'missing-a' }),
        entry('orphan-b', 'retained-b', [], { sourceId: 'missing-b' }),
      ],
      sources: [source, another, custom],
      installations: [],
    },
    'active',
  );
  const groups = librarySourceGroups(rows, rows);
  expect(groups).toHaveLength(5);
  expect(groups.find((group) => group.sourceId === source.id)?.items).toHaveLength(4);
  expect(groups.find((group) => group.sourceId === another.id)?.source?.name).toBe(source.name);
  expect(groups.find((group) => group.sourceId === custom.id)?.items[0]?.entry.custom).toBe(true);
  expect(groups.filter((group) => !group.source).map((group) => group.sourceId)).toEqual([
    'missing-a',
    'missing-b',
  ]);
  expect(groups.flatMap((group) => group.items)).toHaveLength(rows.length);
});

test('filtering searches the whole collection before grouping, keeps exact revisions and reports matching totals', () => {
  const entries = Array.from({ length: 47 }, (_, index) =>
    entry(`guide-${index}`, `guide-${index}`, []),
  );
  entries.push(entry('new-revision', 'guide-46', ['expo'], { updatedAt: '2026-11-01T00:00:00Z' }));
  const rows = libraryItems(
    {
      entries,
      sources: [source],
      installations: [location('guide-46', 'one-project', 'codex', 'project')],
    },
    'active',
  );
  const matches = filterLibrary(rows, { ...defaultLibraryFilters(), query: 'guide-46' });
  const groups = librarySourceGroups(matches, rows);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.total).toBe(47);
  expect(groups[0]?.items).toHaveLength(1);
  expect(groups[0]?.items[0]?.entry.id).toBe('new-revision');
  expect(groups[0]?.items[0]?.versions.map((version) => version.id)).toEqual([
    'new-revision',
    'guide-46',
  ]);
  expect(groups[0]?.items[0]?.locations[0]?.entryId).toBe('guide-46');
  expect(librarySourceGroups([], rows)).toEqual([]);
});
