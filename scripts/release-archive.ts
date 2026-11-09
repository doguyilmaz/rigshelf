import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, rename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { pack } from 'tar-stream';
import { VERSION } from '../src/version';
import { type ReleaseFile, releasePath } from './release-files';

export type Delivery = 'portable' | `bun-${string}`;

function releaseManifest(files: ReleaseFile[], delivery: Delivery): string {
  return `${JSON.stringify(
    {
      formatVersion: 1,
      product: 'Rigshelf',
      version: VERSION,
      delivery,
      bunVersion: Bun.version,
      files: files.map(({ path, bytes, mode, sha256 }) => ({
        path,
        bytes: bytes.length,
        mode,
        sha256,
      })),
    },
    null,
    2,
  )}\n`;
}

async function availableDestination(path: string, replace: boolean): Promise<void> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (info && (!replace || !info.isFile() || info.nlink !== 1))
    throw new Error(
      'Release output exists or is unsafe. Use --replace for regular local artifacts.',
    );
}

export async function writeReleaseArchive(
  destination: string,
  files: ReleaseFile[],
  delivery: Delivery,
  replace: boolean,
): Promise<void> {
  const paths = new Set<string>();
  for (const file of files) {
    releasePath(file.path);
    if (paths.has(file.path) || file.path === 'manifest.json')
      throw new Error('Release paths must be unique; manifest.json is reserved.');
    if (createHash('sha256').update(file.bytes).digest('hex') !== file.sha256)
      throw new Error('Release bytes changed after inventory.');
    paths.add(file.path);
  }
  await availableDestination(destination, replace);
  await availableDestination(`${destination}.sha256`, replace);
  const temporary = `${destination}.${crypto.randomUUID()}.partial`;
  const checksumTemporary = `${temporary}.sha256`;
  const tar = pack();
  const digest = createHash('sha256');
  const compressed = createGzip({ level: 6 });
  compressed.on('data', (chunk: Buffer) => digest.update(chunk));
  const writing = pipeline(
    tar,
    compressed,
    createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
  );
  void writing.catch(() => undefined);
  const entries = [
    ...files,
    { path: 'manifest.json', bytes: Buffer.from(releaseManifest(files, delivery)), mode: 0o644 },
  ];
  try {
    for (const file of entries) {
      await new Promise<void>((accept, reject) => {
        tar.entry(
          { name: file.path, mode: file.mode, mtime: new Date(0), uid: 0, gid: 0, type: 'file' },
          file.bytes,
          (error) => (error ? reject(error) : accept()),
        );
      });
    }
    tar.finalize();
    await writing;
    await writeFile(
      checksumTemporary,
      `${digest.digest('hex')}  ${destination.split('/').pop()}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, destination);
    await rename(checksumTemporary, `${destination}.sha256`);
  } catch (error) {
    tar.destroy();
    await writing.catch(() => undefined);
    await rm(temporary, { force: true });
    await rm(checksumTemporary, { force: true });
    throw error;
  }
}
