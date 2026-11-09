import { lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { MAX_ARCHIVE_BYTES } from './archive';
import {
  type BackupArtifact,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_POINTER_BYTES,
  readBackupManifest,
  readBackupPointer,
} from './backup-artifacts';
import { canonicalBackup } from './backup-review';
import { readLocalBytes } from './local-files';
import { hash } from './safety';
import type { Store } from './store';

function stagePath(store: Store, id: string): string {
  return join(store.directory, 'backup-staging', z.string().uuid().parse(id));
}
async function directory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Backup staging must use a private regular directory.');
}
export async function stageBackup(
  store: Store,
  id: string,
  artifact: BackupArtifact,
): Promise<void> {
  await directory(join(store.directory, 'backup-staging'));
  const path = stagePath(store, id);
  await directory(path);
  for (const [name, bytes] of [
    ['archive.gz', artifact.archive],
    ['manifest.json', artifact.manifestBytes],
    ['pointer.json', artifact.pointerBytes],
  ] as const) {
    const target = join(path, name);
    try {
      const file = await open(target, 'wx', 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (failure) {
      if (!(failure instanceof Error) || !('code' in failure) || failure.code !== 'EEXIST')
        throw failure;
      if (hash(await readLocalBytes(target, bytes.length)) !== hash(bytes))
        throw new Error('The staged backup changed. It was not overwritten.');
    }
  }
}
export async function readStagedBackup(
  store: Store,
  id: string,
  manifestDigest: string,
  archiveDigest: string,
): Promise<BackupArtifact> {
  const path = stagePath(store, id);
  const directoryInfo = await lstat(path);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    throw new Error('Invalid backup staging directory.');
  const [archive, manifestBytes, pointerBytes] = await Promise.all([
    readLocalBytes(join(path, 'archive.gz'), MAX_ARCHIVE_BYTES),
    readLocalBytes(join(path, 'manifest.json'), MAX_BACKUP_MANIFEST_BYTES),
    readLocalBytes(join(path, 'pointer.json'), MAX_BACKUP_POINTER_BYTES),
  ]);
  const manifest = readBackupManifest(manifestBytes, manifestDigest);
  const pointer = readBackupPointer(pointerBytes);
  if (
    pointer.operationId !== id ||
    manifest.operationId !== id ||
    pointer.manifestDigest !== manifestDigest ||
    pointer.archiveDigest !== archiveDigest ||
    manifest.archiveDigest !== archiveDigest ||
    pointer.fingerprint !== manifest.fingerprint ||
    pointer.createdAt !== manifest.createdAt ||
    hash(pointerBytes) !== hash(canonicalBackup(pointer)) ||
    hash(archive) !== archiveDigest ||
    archive.length !== manifest.archiveBytes
  )
    throw new Error('The staged backup failed its integrity check.');
  return { archive, manifest, manifestBytes, pointer, pointerBytes };
}
export async function removeStagedBackup(store: Store, id: string): Promise<string | undefined> {
  const path = stagePath(store, id);
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      return 'A changed staging directory was retained for local review.';
    for (const name of ['archive.gz', 'manifest.json', 'pointer.json']) {
      const target = join(path, name);
      const leaf = await lstat(target).catch(() => undefined);
      if (!leaf) continue;
      if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1)
        return 'Changed staging files were retained for local review.';
      await unlink(target);
    }
    await rmdir(path);
    return undefined;
  } catch (failure) {
    if (failure instanceof Error && 'code' in failure && failure.code === 'ENOENT')
      return undefined;
    return 'The private staged copy could not be removed. Remote backup state is unchanged.';
  }
}
