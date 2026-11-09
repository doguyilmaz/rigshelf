import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readLocalBytes(source: string, maximum: number): Promise<Buffer> {
  const path = resolve(source);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1)
    throw new Error('Choose a regular file without symbolic or hard links.');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  try {
    const initial = await handle.stat();
    if (
      !initial.isFile() ||
      initial.nlink !== 1 ||
      initial.dev !== before.dev ||
      initial.ino !== before.ino
    )
      throw new Error('Input file identity changed.');
    if (initial.size > maximum) throw new Error(`Input exceeds the ${maximum} byte limit.`);
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum - size + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw new Error(`Input exceeds the ${maximum} byte limit.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (
      after.size !== initial.size ||
      size !== initial.size ||
      after.nlink !== 1 ||
      after.mtimeMs !== initial.mtimeMs ||
      after.ctimeMs !== initial.ctimeMs
    )
      throw new Error('Input file changed while reading.');
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

export async function readRecord(source: string): Promise<unknown> {
  return JSON.parse((await readLocalBytes(source, 4 * 1024 * 1024)).toString('utf8'));
}
