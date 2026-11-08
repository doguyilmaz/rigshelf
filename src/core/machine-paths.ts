const PATH_CHARACTER = '[A-Za-z0-9_.-]';
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimmed = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);
const wholePath = (paths: string[]) =>
  new RegExp(
    `(?<!${PATH_CHARACTER})(?:${paths.map(literal).join('|')})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`,
    'g',
  );

/** True when `path` appears as a whole path, not inside a longer name such as `app/root.tsx`. */
export function mentionsPath(text: string, path: string): boolean {
  return Boolean(path) && wholePath([trimmed(path)]).test(text);
}

/** Replaces whole paths in one pass, longest first, so replaced text is never replaced again. */
export function replacePaths(text: string, pairs: [string, string][]): string {
  const targets = new Map<string, string>();
  for (const [from, to] of pairs)
    if (from && !targets.has(trimmed(from))) targets.set(trimmed(from), trimmed(to));
  if (!targets.size) return text;
  const order = [...targets.keys()].sort((left, right) => right.length - left.length);
  return text.replace(wholePath(order), (match) => targets.get(match) ?? match);
}
