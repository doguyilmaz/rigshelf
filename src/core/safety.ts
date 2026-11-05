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

export function redact(text: string): string {
  const placeholder = '${KITFOLD_SECRET}';
  const dynamic = (value: string) => /^(?:Bearer )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
  return text
    .replace(
      /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
      placeholder,
    )
    .replace(
      /(?<![A-Za-z0-9_-])(?:sk-|ghp_|gho_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}/g,
      placeholder,
    )
    .replace(
      /((?:["']?)(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|token|authorization|cookie|private[_-]?key)(?:["']?)\s*[:=]\s*)(["'])((?:\\.|(?!\2)[^\r\n])*)\2/gi,
      (_match, prefix: string, quote: string, value: string) =>
        `${prefix}${quote}${dynamic(value) ? value : placeholder}${quote}`,
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*)([^\s,"'}#]+)/gi,
      (match, prefix: string, value: string) =>
        value.startsWith('${') ? match : prefix + placeholder,
    )
    .replace(/(Bearer\s+)(?!\$\{)[A-Za-z0-9._-]{12,}/gi, '$1${KITFOLD_SECRET}')
    .replace(
      /([?&](?:token|key|api_key|access_token|secret)=)([^&#\s]+)/gi,
      (match, prefix: string, value: string) =>
        value.startsWith('${') ? match : prefix + placeholder,
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1${KITFOLD_SECRET}@');
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
