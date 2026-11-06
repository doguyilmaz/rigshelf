import type {
  Entry,
  Installation,
  Plan,
  Preset,
  Project,
  Rule,
  Settings,
  Source,
} from '../src/core/model';
import type { Adapter } from '../src/core/providers';
import type { ScanProgress, ScanResult } from '../src/core/scanner';
import { getLocale, t } from './i18n';

export interface AppState {
  globalAiFiles?: import('../src/core/model').DocumentLocation[];
  globalAiWarnings?: string[];
  entries: Omit<Entry, 'body'>[];
  sources: Source[];
  projects: Project[];
  installations: Installation[];
  presets: Preset[];
  rules: Rule[];
  ruleFindings?: { id: string; findings: import('../src/core/model').Finding[] }[];
  settings: Settings;
  adapters: Adapter[];
  events: { id: number; createdAt: string; action: string; detail: string }[];
  discoveries?: import('../src/core/discovery').Discovery[];
  dataDirectory: string;
  scan: ScanProgress;
  lastScan?: ScanResult;
  plans: (Omit<Plan, 'changes'> & { fileCount: number })[];
  approvals?: { id: string; enabled: boolean }[];
  trust?: { id: string; digest: string }[];
  recoveries?: { id: string; state: string }[];
  suggestions?: import('../src/core/watch').ProjectSuggestion[];
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const segments = path.split('/').map((segment) => decodeURIComponent(segment));
  if (
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._%-]+)*$/.test(path) ||
    segments.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
  )
    throw new Error('Invalid API path.');
  const token = accessToken();
  const response = await fetch(`/api/${path}`, {
    method,
    signal,
    headers: {
      'x-kitfold-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `Request failed (${response.status})`,
    );
  return data as T;
}
export function apiId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('Invalid record identifier.');
  return encodeURIComponent(value);
}

export function accessToken(): string {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const incoming = parameters.get('access');
  if (incoming && /^[a-f0-9]{64}$/.test(incoming)) {
    sessionStorage.setItem('kitfold-access', incoming);
    history.replaceState(null, '', `${location.pathname}#setup`);
  }
  return sessionStorage.getItem('kitfold-access') || '';
}
export function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const formatDate = (date: string | undefined): string =>
  date
    ? new Date(date).toLocaleString(getLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : t('Not checked');
export const shortPath = (path: string): string =>
  path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');
