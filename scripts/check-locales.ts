import english from '../web/locales/en.json';
import turkish from '../web/locales/tr.json';

/** `t('…')` calls with a quoted first argument; comments are blanked first so commented-out calls are not counted. */
const CALL = /(?<![\w$.])t\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const COMMENT = /\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g;
const unescaped = (value: string) =>
  value.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g,
    (_match, code: string) => {
      if (code[0] === 'u' || code[0] === 'x')
        return String.fromCodePoint(Number.parseInt(code.replace(/[ux{}]/g, ''), 16));
      return { n: '\n', t: '\t', r: '\r' }[code] ?? code;
    },
  );

export function catalogCalls(source: string): string[] {
  return [
    ...source.replace(COMMENT, (comment) => comment.replace(/[^\n]/g, ' ')).matchAll(CALL),
  ].map((match) => unescaped(match[2]!).trim());
}

if (import.meta.main) {
  const failures: string[] = [];
  const keys = new Set(Object.keys(english));
  for (const key of keys)
    if (!Object.hasOwn(turkish, key)) failures.push(`Missing Turkish translation: ${key}`);
  for (const key of Object.keys(turkish))
    if (!keys.has(key)) failures.push(`Unknown Turkish key: ${key}`);
  for (const path of new Bun.Glob('web/**/*.ts{,x}').scanSync('.'))
    for (const message of catalogCalls(await Bun.file(path).text()))
      if (!keys.has(message)) failures.push(`${path}: Missing catalog message: ${message}`);
  if (failures.length) throw new Error(failures.join('\n'));
  process.stdout.write(`${keys.size} messages have matching English/Turkish catalogs.\n`);
}
