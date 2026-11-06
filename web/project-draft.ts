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
const MAX_STORED_DRAFT_BYTES = 100_000;
const providers = new Set(['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok']);
const strings = (value: unknown, limit: number, length: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= length);

/** A recovery draft carries choices only. A fresh inspection must precede every plan. */
export function parseProjectDraft(raw: string | null): ProjectDraft | undefined {
  if (!raw || raw.length > MAX_STORED_DRAFT_BYTES) return;
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
      !strings(item.selected, MAX_PROJECT_KIT_ENTRIES, 500) ||
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
export function writeProjectDraft(draft?: ProjectDraft): void {
  try {
    if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Recovery is optional when browser storage is unavailable. */
  }
}
