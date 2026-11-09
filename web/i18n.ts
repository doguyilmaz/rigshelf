import { useSyncExternalStore } from 'react';

type Locale = 'en' | 'tr';
export const languages: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Türkçe' },
];
interface LocaleState {
  locale: Locale;
  loading: Locale | null;
  error: string;
}
const storageKey = 'rigshelf:language';
const listeners = new Set<() => void>();
const catalogs: Partial<Record<Locale, Record<string, string>>> = { en: {} };
const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'tr';
function storedLocale(): Locale {
  try {
    const value = globalThis.localStorage?.getItem(storageKey);
    return isLocale(value) ? value : 'en';
  } catch {
    return 'en';
  }
}
let state: LocaleState = { locale: 'en', loading: null, error: '' };
let requestVersion = 0;
const publish = () => {
  for (const listener of listeners) listener();
};
export const getLocale = (): Locale => state.locale;
const getState = (): LocaleState => state;
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value) || (value === state.locale && !state.loading && !state.error)) return;
  const version = ++requestVersion;
  state = { ...state, loading: value, error: '' };
  publish();
  try {
    if (value === 'tr' && !catalogs.tr) catalogs.tr = (await import('./locales/tr.json')).default;
    if (version !== requestVersion) return;
    state = { locale: value, loading: null, error: '' };
    try {
      globalThis.localStorage?.setItem(storageKey, value);
    } catch {
      // Browser storage is optional; the current language still changes.
    }
  } catch {
    if (version !== requestVersion) return;
    state = {
      ...state,
      loading: null,
      error: 'Could not load the language. Reload the page and try again.',
    };
  }
  publish();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useLocaleState(): LocaleState {
  return useSyncExternalStore(subscribe, getState, getState);
}
export function useLocale(): Locale {
  return useLocaleState().locale;
}
export function t(source: string, values: Record<string, string | number> = {}): string {
  const key = source.trim();
  if (!key) return source;
  const catalog = catalogs[state.locale];
  const message = catalog && Object.hasOwn(catalog, key) ? catalog[key]! : key;
  const translated = message.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return value === undefined ? placeholder : String(value);
  });
  return (
    source.slice(0, source.length - source.trimStart().length) +
    translated +
    source.slice(source.trimEnd().length)
  );
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) void setLocale(event.newValue ?? 'en');
  });
}
export const localeReady = setLocale(storedLocale());
