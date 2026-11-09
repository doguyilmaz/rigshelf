import { useEffect, useState } from 'react';
import { defaultLibraryFilters, type LibraryFilters } from '../src/core/library';
import type { LibraryGrouping } from '../src/core/library-groups';

const key = 'agent-setup.library.v1';
const MAX_SAVED_VIEWS = 12;
export interface SavedLibraryView {
  id: string;
  name: string;
  filters: LibraryFilters;
}
interface Preferences {
  version: 1;
  filters: LibraryFilters;
  saved: SavedLibraryView[];
  grouping: LibraryGrouping;
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function readLibraryFilters(value: unknown): LibraryFilters {
  const result = defaultLibraryFilters();
  if (!record(value)) return result;
  for (const axis of ['platforms', 'technologies', 'topics', 'tags'] as const) {
    const list = value[axis];
    if (Array.isArray(list))
      result[axis] = [
        ...new Set(
          list.filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && item.length <= 64,
          ),
        ),
      ]
        .slice(0, 20)
        .sort();
  }
  for (const axis of ['query', 'source', 'project', 'agent'] as const)
    if (typeof value[axis] === 'string') result[axis] = value[axis].slice(0, 200);
  const enums = {
    kind: ['all', 'skill', 'mcp', 'plugin', 'resource'],
    scope: ['all', 'project', 'global', 'unused'],
    origin: ['all', 'custom', 'upstream'],
    status: ['active', 'archived', 'all'],
    review: ['all', 'flagged', 'blocked', 'clean', 'approved'],
    evidence: ['all', 'installed', 'configured', 'local', 'cached', 'catalog', 'reference'],
  };
  for (const axis of Object.keys(enums) as (keyof typeof enums)[])
    if (typeof value[axis] === 'string' && enums[axis].includes(value[axis]))
      Object.assign(result, { [axis]: value[axis] });
  return result;
}
function read(): Preferences {
  const fallback: Preferences = {
    version: 1,
    filters: defaultLibraryFilters(),
    saved: [],
    grouping: 'source',
  };
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 50_000) return fallback;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1) return fallback;
    return {
      version: 1,
      filters: readLibraryFilters(value.filters),
      grouping: value.grouping === 'none' ? 'none' : 'source',
      saved: Array.isArray(value.saved)
        ? value.saved
            .filter(record)
            .filter(
              (item) =>
                typeof item.id === 'string' &&
                item.id.length <= 100 &&
                typeof item.name === 'string' &&
                item.name.trim().length > 0 &&
                item.name.length <= 48,
            )
            .slice(0, MAX_SAVED_VIEWS)
            .map((item) => ({
              id: String(item.id),
              name: String(item.name),
              filters: readLibraryFilters(item.filters),
            }))
        : [],
    };
  } catch {
    return fallback;
  }
}
export function useLibraryPreferences() {
  const [preferences, setPreferences] = useState(read);
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
      setPersistent(true);
    } catch {
      setPersistent(false);
    }
  }, [preferences]);
  return {
    filters: preferences.filters,
    grouping: preferences.grouping,
    setGrouping: (grouping: LibraryGrouping) =>
      setPreferences((current) => ({ ...current, grouping })),
    saved: preferences.saved,
    persistent,
    setFilters: (filters: LibraryFilters) =>
      setPreferences((current) => ({ ...current, filters: readLibraryFilters(filters) })),
    saveView: (name: string): boolean => {
      const clean = name.trim().slice(0, 48);
      if (!clean) return false;
      const existing = preferences.saved.find(
        (view) => view.name.toLowerCase() === clean.toLowerCase(),
      );
      if (!existing && preferences.saved.length >= MAX_SAVED_VIEWS) return false;
      const view = {
        id: existing?.id || crypto.randomUUID(),
        name: clean,
        filters: preferences.filters,
      };
      setPreferences((current) => ({
        ...current,
        saved: existing
          ? current.saved.map((item) => (item.id === existing.id ? view : item))
          : [...current.saved, view],
      }));
      return true;
    },
    removeView: (id: string) =>
      setPreferences((current) => ({
        ...current,
        saved: current.saved.filter((view) => view.id !== id),
      })),
    canSave: preferences.saved.length < MAX_SAVED_VIEWS,
  };
}
