import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_RELEASE_PATH_BYTES = 4096;

export type ReleaseFile = { path: string; bytes: Buffer; mode: number; sha256: string };

export function assertReleasePrivacy(files: ReleaseFile[], privatePaths: string[]): void {
  const prefixes = privatePaths.filter((path) => path.length > 8 && path.split(/[\\/]/).length > 2);
  for (const file of files) {
    if (prefixes.some((path) => file.bytes.includes(Buffer.from(path))))
      throw new Error(`Build-machine path found in release payload: ${file.path}`);
  }
}

export function releasePath(value: string): string {
  if (
    !value ||
    Buffer.byteLength(value) > MAX_RELEASE_PATH_BYTES ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /\p{Cc}/u.test(value) ||
    /[<>:"|?*]/.test(value)
  )
    throw new Error('Invalid release path.');
  if (value.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error('Invalid release path.');
  return value;
}

export async function releaseDirectory(root: string, path: string): Promise<void> {
  const target = resolve(root, path);
  const within = relative(root, target);
  if (within.startsWith(`..${sep}`) || within === '..' || resolve(root) === target)
    throw new Error('Release directory must be inside its root.');
  let current = root;
  for (const part of within.split(sep)) {
    current = join(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await lstat(current)).isDirectory())
      throw new Error('Release directories must not traverse links.');
  }
}

async function checkedBytes(handle: FileHandle): Promise<Buffer> {
  const before = await handle.stat();
  if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES)
    throw new Error('Release input must be a bounded, unlinked regular file.');
  const buffer = Buffer.alloc(before.size + 1);
  let size = 0;
  while (size < buffer.length) {
    const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
    if (!bytesRead) break;
    size += bytesRead;
  }
  const bytes = buffer.subarray(0, size);
  const after = await handle.stat();
  if (
    bytes.length !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    after.nlink !== 1
  )
    throw new Error('Release input changed while reading.');
  return bytes;
}

export async function releaseFile(root: string, path: string): Promise<ReleaseFile> {
  releasePath(path);
  let current = root;
  for (const part of path.split('/').slice(0, -1)) {
    current = join(current, part);
    if (!(await lstat(current)).isDirectory()) throw new Error('Linked release input excluded.');
  }
  const handle = await open(
    join(root, path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const bytes = await checkedBytes(handle);
    return {
      path,
      bytes,
      mode: (await handle.stat()).mode & 0o111 ? 0o755 : 0o644,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

export async function releaseTree(root: string, directory: string): Promise<ReleaseFile[]> {
  const files: ReleaseFile[] = [];
  const pending = [releasePath(directory)];
  let total = 0;
  while (pending.length) {
    const path = pending.pop()!;
    const info = await lstat(join(root, path));
    if (info.isDirectory()) {
      const names = await readdir(join(root, path));
      if (names.length + pending.length + files.length > MAX_FILES)
        throw new Error('Release input has too many files.');
      for (const name of names.sort().reverse()) pending.push(`${path}/${name}`);
    } else {
      const file = await releaseFile(root, path);
      files.push(file);
      total += file.bytes.length;
      if (total > MAX_TOTAL_BYTES) throw new Error('Release input exceeds the total size limit.');
    }
  }
  return files.sort((first, second) => first.path.localeCompare(second.path));
}

export async function stageFile(root: string, file: ReleaseFile): Promise<void> {
  const path = join(root, releasePath(file.path));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, 'wx', file.mode);
  try {
    await handle.writeFile(file.bytes);
  } finally {
    await handle.close();
  }
}
