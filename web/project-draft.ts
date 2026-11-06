import { MAX_PROJECT_KIT_ENTRIES } from '../src/core/kit-limits';
import type { Provider } from '../src/core/model';

export interface ProjectDraft {
  version: 1;
  path: string;
  requirements: string;
  preset: string;
  providers: Provider[];
  selected: string[];
  updatedAt: string;
}
const STORAGE_KEY = 'rigshelf:project-draft:v1';
const MAX_STORED_DRAFT_CHARACTERS = 1024 * 1024;
// Oversized kits remain recoverable while the user trims them to the 100-item plan limit.
const MAX_RECOVERY_SELECTIONS = MAX_PROJECT_KIT_ENTRIES * 10;
const providers = new Set(['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok']);
const strings = (value: unknown, limit: number, length: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= length);

/** A recovery draft carries choices only. A fresh inspection must precede every plan. */
export function parseProjectDraft(raw: string | null): ProjectDraft | undefined {
  if (!raw || raw.length > MAX_STORED_DRAFT_CHARACTERS) return;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    if (
      item.version !== 1 ||
      typeof item.path !== 'string' ||
      !item.path.trim() ||
      item.path.length > 4096 ||
      /[\0\r\n]/.test(item.path)
    )
      return;
    if (
      typeof item.requirements !== 'string' ||
      item.requirements.length > 10_000 ||
      typeof item.preset !== 'string' ||
      item.preset.length > 200
    )
      return;
    if (
      !strings(item.selected, MAX_RECOVERY_SELECTIONS, 500) ||
      !strings(item.providers, providers.size, 30) ||
      !item.providers.every((provider) => providers.has(provider))
    )
      return;
    if (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) return;
    return {
      version: 1,
      path: item.path,
      requirements: item.requirements,
      preset: item.preset,
      providers: [...new Set(item.providers)] as Provider[],
      selected: [...new Set(item.selected)],
      updatedAt: item.updatedAt,
    };
  } catch {
    return;
  }
}

export function readProjectDraft(): ProjectDraft | undefined {
  try {
    return parseProjectDraft(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return;
  }
}
export function writeProjectDraft(draft?: ProjectDraft): boolean {
  try {
    if (draft) {
      const serialized = JSON.stringify(draft);
      if (
        serialized.length > MAX_STORED_DRAFT_CHARACTERS ||
        draft.selected.length > MAX_RECOVERY_SELECTIONS
      )
        return false;
      sessionStorage.setItem(STORAGE_KEY, serialized);
    } else sessionStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
