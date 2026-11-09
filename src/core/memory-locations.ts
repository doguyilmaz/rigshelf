import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { dependencyDirectories, privateRuntimeDirectories } from './inventory-paths';
import { readLocalBytes } from './local-files';
import { inside } from './safety';

const MAX_GIT_METADATA_BYTES = 8192;
const MAX_ANCESTORS = 32;
const MAX_SETTINGS_BYTES = 1024 * 1024;

async function worktreeRepository(project: string, marker: string): Promise<string | undefined> {
  try {
    const pointer = (await readLocalBytes(marker, MAX_GIT_METADATA_BYTES)).toString('utf8').trim();
    if (!pointer.startsWith('gitdir: ')) return;
    const gitdir = await realpath(resolve(project, pointer.slice(8)));
    const common = dirname(dirname(gitdir));
    if (basename(dirname(gitdir)) !== 'worktrees' || basename(common) !== '.git') return;
    const backReference = (await readLocalBytes(join(gitdir, 'gitdir'), MAX_GIT_METADATA_BYTES))
      .toString('utf8')
      .trim();
    if (resolve(gitdir, backReference) !== (await realpath(marker))) return;
    if (!(await lstat(common)).isDirectory()) return;
    return dirname(common);
  } catch {
    return;
  }
}

export const claudeMemoryKey = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-');

/** A matching Git metadata back-reference is required before associating a worktree's main root. */
export async function memoryProjectPaths(project: string): Promise<string[]> {
  const canonical = await realpath(project).catch(() => resolve(project));
  const paths = new Set([resolve(project), canonical]);
  let current = canonical;
  for (let attempt = 0; attempt < MAX_ANCESTORS; attempt++) {
    const marker = join(current, '.git');
    const info = await lstat(marker).catch(() => undefined);
    if (info?.isDirectory()) {
      paths.add(current);
      break;
    }
    if (info?.isFile()) {
      paths.add(current);
      const main = await worktreeRepository(current, marker);
      if (main) paths.add(main);
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [...paths];
}

export async function configuredMemoryDirectory(
  file: string,
  home: string,
  roots: string[],
  warnings: string[],
): Promise<string | undefined> {
  const canonical = await realpath(file).catch(() => undefined);
  if (!canonical) return;
  if (!['settings.json', 'settings.local.json'].includes(basename(canonical))) {
    warnings.push(`${file}: Non-settings link target excluded.`);
    return;
  }
  const allowed = await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)));
  const boundary = allowed.find((root) => root && inside(root, canonical));
  if (
    !boundary ||
    canonical.split(sep).some((part) => dependencyDirectories.has(part)) ||
    relative(boundary, canonical)
      .split(sep)
      .some((part) => privateRuntimeDirectories.has(part))
  ) {
    warnings.push(`${file}: External settings link excluded.`);
    return;
  }
  try {
    const settings: unknown = JSON.parse(
      (await readLocalBytes(canonical, MAX_SETTINGS_BYTES)).toString('utf8'),
    );
    const value =
      settings && typeof settings === 'object' && 'autoMemoryDirectory' in settings
        ? settings.autoMemoryDirectory
        : undefined;
    if (value === undefined) return;
    if (
      typeof value !== 'string' ||
      value.length > 8192 ||
      /[\0\r\n]/.test(value) ||
      (!isAbsolute(value) && !value.startsWith('~/'))
    ) {
      warnings.push(`${file}: Invalid auto-memory directory setting.`);
      return;
    }
    return resolve(value.startsWith('~/') ? join(home, value.slice(2)) : value);
  } catch {
    warnings.push(`${file}: Memory-location setting could not be read.`);
    return;
  }
}
