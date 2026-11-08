import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Finding } from './model';

export const hash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export { slug } from './names';
export const now = (): string => new Date().toISOString();
export const inside = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

export function safeRelative(path: string): string {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  return path;
}

export async function checkedProject(path: string): Promise<string> {
  const expanded = path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(path);
  if (expanded === '/' || expanded === homedir() || expanded.split(sep).includes('.git'))
    throw new Error('Choose a project directory, not a home, filesystem root, or .git directory.');
  let ancestor = expanded;
  while (!(await Bun.file(ancestor).exists())) {
    try {
      await lstat(ancestor);
      break;
    } catch {
      const next = dirname(ancestor);
      if (next === ancestor) throw new Error('No existing project parent');
      ancestor = next;
    }
  }
  const canonical = await realpath(ancestor);
  if (canonical !== ancestor)
    throw new Error('Project paths must not traverse symbolic links. Use the resolved path.');
  const info = await lstat(ancestor);
  if (!info.isDirectory()) throw new Error('Project parent must be a directory.');
  return expanded;
}

export async function assertWritePath(root: string, path: string): Promise<string> {
  const target = resolve(root, safeRelative(path));
  if (!inside(root, target)) throw new Error('Write escaped project root');
  let candidate = target;
  while (inside(root, candidate)) {
    try {
      const stat = await lstat(candidate);
      if (candidate === target && !stat.isFile() && !stat.isSymbolicLink())
        throw new Error(`Refusing non-file output: ${path}`);
      if (candidate !== target && !stat.isDirectory() && !stat.isSymbolicLink())
        throw new Error(`Output parent is not a directory: ${path}`);
      if (stat.isSymbolicLink() || (stat.nlink > 1 && stat.isFile()))
        throw new Error(`Refusing linked output: ${path}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (candidate === root) break;
    candidate = dirname(candidate);
  }
  return target;
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

const PLACEHOLDER = '${KITFOLD_SECRET}';
/** Names whose value is a secret, matched on the last `_`/`-` separated parts so `STRIPE_SECRET_KEY` and `aws_secret_access_key` count. */
const SECRET_NAME_END =
  /(?:^|[_-])(?:api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|role[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)$/i;
const QUOTED_ONLY_NAMES = /^(?:authorization|cookie|private[_-]?key)$/i;
const isVariable = (value: string) => /^(?:Bearer\s+)?\$/.test(value);

/** Every pattern starts at a token boundary or a literal, so the scan stays linear on long lines. */
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
      PLACEHOLDER,
    )
    .replace(
      /(?<![A-Za-z0-9_-])(?:(?:sk-|sk_live_|sk_test_|rk_live_|rk_test_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[baprs]-|AKIA|AIza)[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9]{36})(?![A-Za-z0-9_-])/g,
      PLACEHOLDER,
    )
    .replace(
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
      PLACEHOLDER,
    )
    .replace(
      /(?<![A-Za-z0-9_-])(["']?)([A-Za-z][A-Za-z0-9_-]{0,80})\1(\s*[:=]\s*)(?:(["'])((?:\\.|(?!\4)[^\r\n])*)\4|([^\s,"'{}[\]#][^\s,"'}#]*))/g,
      (
        match,
        nameQuote: string,
        name: string,
        separator: string,
        quote?: string,
        quoted?: string,
        bare?: string,
      ) => {
        const secretName = SECRET_NAME_END.test(name) || QUOTED_ONLY_NAMES.test(name);
        if (!secretName) return match;
        const head = `${nameQuote}${name}${nameQuote}${separator}`;
        if (quote !== undefined)
          return isVariable(quoted ?? '') ? match : `${head}${quote}${PLACEHOLDER}${quote}`;
        if (nameQuote || QUOTED_ONLY_NAMES.test(name) || isVariable(bare ?? '')) return match;
        return head + PLACEHOLDER;
      },
    )
    .replace(
      /(--(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)(?:=|\s+|\\?["']?\s*,\s*)\\?["']?)(?![-$])([A-Za-z0-9._~+/=-]{12,})/gi,
      `$1${PLACEHOLDER}`,
    )
    .replace(/(Bearer\s+)(?![$])[A-Za-z0-9._-]{12,}/gi, `$1${PLACEHOLDER}`)
    .replace(
      /([?&](?:token|key|api_key|access_token|secret)=)([^&#\s]+)/gi,
      (match, prefix: string, value: string) =>
        value.startsWith('$') ? match : prefix + PLACEHOLDER,
    )
    .replace(
      /(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      `$1${PLACEHOLDER}@`,
    );
}

export function scanText(text: string, file = 'SKILL.md'): Finding[] {
  const findings: Finding[] = [];
  const rules: [RegExp, Finding['level'], string, string][] = [
    [
      /curl[^\n]*\|\s*(?:ba)?sh|wget[^\n]*\|\s*(?:ba)?sh/i,
      'review',
      'remote-shell',
      'Downloads piped into a shell require manual review.',
    ],
    [
      /ignore (?:all |previous |prior )?(?:instructions|rules)|disable (?:all )?(?:safety|security)|exfiltrat/i,
      'review',
      'instruction-risk',
      'Instructions may override safeguards or expose data.',
    ],
    [
      /rm\s+-[a-z]*r[a-z]*f\s+(?:\/|~)|chmod\s+777|sudo\s+/i,
      'review',
      'privileged-command',
      'Privileged or destructive commands require review.',
    ],
    [
      /!`[^`]+`|\b(?:preinstall|postinstall)\b/i,
      'review',
      'execution-feature',
      'Contains dynamic execution or installation lifecycle instructions.',
    ],
    [
      /(?<![A-Za-z0-9_-])(?:sk-|ghp_|gho_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}/,
      'block',
      'secret',
      'Possible embedded credential or private key.',
    ],
  ];
  for (const [pattern, level, code, message] of rules)
    if (pattern.test(text)) findings.push({ code, level, message, file });
  return findings;
}
