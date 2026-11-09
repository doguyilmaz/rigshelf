import { slug } from '../src/core/names';

/** Generates a readable ID without treating a matching display name as ownership. */
export function definitionId(name: string, existing: { id: string }[]): string {
  const base = slug(name).slice(0, 56);
  return existing.some((item) => item.id === base)
    ? `${base}-${crypto.randomUUID().slice(0, 8)}`
    : base;
}
