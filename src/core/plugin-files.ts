import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';
import { dependencyDirectories, privateRuntimeDirectories } from './inventory-paths';
import { inside } from './safety';

export const MAX_PLUGIN_METADATA_BYTES = 4 * 1024 * 1024;
const privateDirectories = new Set(['.ssh', '.aws', '.gnupg', '.azure']);
export async function pluginBoundaries(paths: string[]): Promise<string[]> {
  return [
    ...new Set(
      (await Promise.all(paths.map((path) => realpath(path).catch(() => undefined)))).filter(
        (path): path is string => Boolean(path),
      ),
    ),
  ];
}
export function pluginPathAllowed(path: string, roots: string[]): boolean {
  if (
    path.split(sep).some((part) => dependencyDirectories.has(part) || privateDirectories.has(part))
  )
    return false;
  return roots.some(
    (root) =>
      inside(root, path) &&
      !relative(root, path)
        .split(sep)
        .some((part) => privateRuntimeDirectories.has(part)),
  );
}

export async function readPluginFile(
  path: string,
  roots: string[],
  warnings: string[],
): Promise<{ path: string; text: string } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const leaf = await lstat(path);
    const canonical = await realpath(path);
    if (
      !leaf.isFile() ||
      leaf.isSymbolicLink() ||
      leaf.nlink !== 1 ||
      leaf.size > MAX_PLUGIN_METADATA_BYTES ||
      basename(canonical) !== basename(path) ||
      !pluginPathAllowed(canonical, roots)
    )
      throw new Error('Excluded Plugin metadata target');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.ino !== leaf.ino ||
      before.dev !== leaf.dev ||
      before.size > MAX_PLUGIN_METADATA_BYTES
    )
      throw new Error('Changed Plugin metadata target');
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    const resolved = await realpath(path);
    const finalLeaf = await lstat(path);
    if (
      resolved !== canonical ||
      finalLeaf.isSymbolicLink() ||
      finalLeaf.ino !== before.ino ||
      finalLeaf.dev !== before.dev ||
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.nlink !== 1
    )
      throw new Error('Changing Plugin metadata');
    return { path: canonical, text: bytes.subarray(0, offset).toString('utf8') };
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ENOTDIR'].includes(String(error.code))
      )
    )
      warnings.push(
        `${path}: Plugin metadata unavailable, invalid or outside the allowed roots; previous inventory retained.`,
      );
    return;
  } finally {
    await handle?.close();
  }
}
