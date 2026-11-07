import { createHash, type Hash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import { z } from 'zod';
import { readLocalBytes } from '../src/core/local-files';
import { releasePath } from './release-files';

const MAX_PACKAGE_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_PACKAGE_FILES = 500;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CHECKSUM_BYTES = 1024;

const ManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    product: z.literal('Rigshelf'),
    version: z.string(),
    delivery: z.string(),
    bunVersion: z.string(),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            bytes: z.number().int().nonnegative(),
            mode: z.number().int(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(MAX_PACKAGE_FILES),
  })
  .strict();

function byteLimit(maximum: number, hasher?: Hash): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maximum) return callback(new Error('Package byte limit exceeded.'));
      hasher?.update(chunk);
      callback(null, chunk);
    },
  });
}

async function extractPayload(handle: FileHandle, destination: string, expected: string) {
  const hasher = createHash('sha256');
  const reader = extract();
  const paths = new Set<string>();
  let total = 0;
  reader.on('entry', (header, stream, next) => {
    const write = async () => {
      releasePath(header.name);
      if (!Number.isSafeInteger(header.size) || (header.size || 0) < 0)
        throw new Error('Invalid package file size.');
      total += header.size || 0;
      if (
        header.type !== 'file' ||
        paths.has(header.name) ||
        paths.size >= MAX_PACKAGE_FILES + 1 ||
        (header.size || 0) > MAX_PACKAGE_FILE_BYTES ||
        total > MAX_PACKAGE_TOTAL_BYTES ||
        (header.name === 'manifest.json' && (header.size || 0) > MAX_MANIFEST_BYTES)
      )
        throw new Error('Unexpected package inventory.');
      paths.add(header.name);
      const path = join(destination, header.name);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      await chmod(path, (header.mode || 0) & 0o111 ? 0o755 : 0o644);
      next();
    };
    void write().catch((error: unknown) =>
      reader.destroy(error instanceof Error ? error : new Error('Extraction failed.')),
    );
  });
  await pipeline(
    handle.createReadStream({ autoClose: false }),
    byteLimit(MAX_PACKAGE_ARCHIVE_BYTES, hasher),
    createGunzip(),
    byteLimit(MAX_PACKAGE_EXPANDED_BYTES),
    reader,
  );
  if (hasher.digest('hex') !== expected) throw new Error('Archive checksum mismatch.');
  return paths;
}

async function verifyManifest(destination: string, paths: Set<string>) {
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')),
  );
  if (paths.size !== manifest.files.length + 1)
    throw new Error('Manifest does not cover the archive.');
  const verified = new Set<string>();
  for (const file of manifest.files) {
    releasePath(file.path);
    if (!paths.has(file.path) || verified.has(file.path) || file.path === 'manifest.json')
      throw new Error('Invalid manifest entry.');
    verified.add(file.path);
    const path = join(destination, file.path);
    const digest = createHash('sha256');
    for await (const part of createReadStream(path)) digest.update(part);
    const info = await stat(path);
    if (
      info.size !== file.bytes ||
      digest.digest('hex') !== file.sha256 ||
      (info.mode & 0o777) !== file.mode
    )
      throw new Error('Extracted payload differs from its manifest.');
  }
  return manifest;
}

export async function extractPackage(archive: string, destination: string) {
  if (!(await lstat(destination)).isDirectory() || (await readdir(destination)).length)
    throw new Error('Package extraction requires an empty real directory.');
  const checksum = (await readLocalBytes(`${archive}.sha256`, MAX_CHECKSUM_BYTES)).toString('utf8');
  const expected = checksum.match(/^([a-f0-9]{64}) {2}[^\r\n]+\r?\n?$/)?.[1];
  if (!expected) throw new Error('Invalid package checksum sidecar.');
  const handle = await open(
    archive,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_PACKAGE_ARCHIVE_BYTES)
      throw new Error('Package input must be a bounded regular file.');
    const paths = await extractPayload(handle, destination, expected);
    return await verifyManifest(destination, paths);
  } finally {
    await handle.close();
  }
}
