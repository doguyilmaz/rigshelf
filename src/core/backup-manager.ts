import { z } from 'zod';
import { exportLibrary } from './backup';
import { createBackupArtifact, MAX_GITHUB_BACKUP_BYTES } from './backup-artifacts';
import {
  type BackupDestination,
  BackupDestinationSchema,
  backupDestination,
  credentialReferences,
  destinationFingerprint,
  destinationIdentity,
  destinationLabel,
} from './backup-destinations';
import { githubBackupTransport } from './backup-github';
import { backupRecords, canonicalBackup, compareBackupRecords } from './backup-review';
import { s3BackupTransport } from './backup-s3';
import {
  BACKUP_REVIEW_LIFETIME_MS,
  type BackupOperation,
  pendingBackup,
  type SavedBackupReview,
} from './backup-state';
import type { BackupTransportFactory } from './backup-transport';
import { DefinitionConflict } from './definitions';
import { now } from './safety';
import type { Store } from './store';

export const defaultBackupTransport: BackupTransportFactory = (destination) =>
  destination.kind === 'github'
    ? githubBackupTransport(destination)
    : s3BackupTransport(destination);
export function listBackupDestinations(store: Store) {
  return store.list<BackupDestination>('backup-destination').map((raw) => {
    const destination = BackupDestinationSchema.parse(raw);
    const operations = store
      .list<BackupOperation>('backup-operation')
      .filter((operation) => operation.destinationId === destination.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      destination,
      label: destinationLabel(destination),
      missingCredentials: credentialReferences(destination).filter(
        (name) => !process.env[name]?.trim(),
      ),
      pending: pendingBackup(store, destinationIdentity(destination)),
      latest: operations[0],
    };
  });
}
export function saveBackupDestination(
  store: Store,
  raw: unknown,
  expected?: unknown,
): BackupDestination {
  const value = BackupDestinationSchema.parse(raw);
  const previous = expected === undefined ? undefined : BackupDestinationSchema.parse(expected);
  return store.db
    .transaction(() => {
      const current = store.get<BackupDestination>('backup-destination', value.id);
      if (
        previous
          ? !current ||
            canonicalBackup(current) !== canonicalBackup(previous) ||
            previous.id !== value.id
          : !!current
      )
        throw new DefinitionConflict(
          'This backup destination changed or already exists. Reload it before saving.',
        );
      if (!current && store.list('backup-destination').length >= 12)
        throw new Error('Keep at most twelve backup destinations.');
      if (
        current &&
        destinationFingerprint(current) !== destinationFingerprint(value) &&
        pendingBackup(store, destinationIdentity(current))
      )
        throw new DefinitionConflict(
          'Finish, close or reconcile the pending backup before changing this destination.',
        );
      store.put('backup-destination', value);
      store.event('backup.destination-saved', value.name);
      return value;
    })
    .immediate();
}
export function removeBackupDestination(store: Store, id: string, expected: unknown): void {
  const previous = BackupDestinationSchema.parse(expected);
  store.db
    .transaction(() => {
      const current = backupDestination(store, id);
      if (previous.id !== id || canonicalBackup(current) !== canonicalBackup(previous))
        throw new DefinitionConflict('This destination changed. Reload it before removing it.');
      if (pendingBackup(store, destinationIdentity(current)))
        throw new DefinitionConflict(
          'Finish, close or reconcile the pending backup before removing this destination.',
        );
      store.remove('backup-destination', id);
      store.event('backup.destination-removed', current.name);
    })
    .immediate();
}
export async function prepareRemoteBackup(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
): Promise<SavedBackupReview> {
  const destination = backupDestination(store, id);
  const configuration = destinationFingerprint(destination);
  const remote = await factory(destination).readCurrent(signal);
  if (signal?.aborted) throw new Error('Backup review cancelled.');
  return store.db
    .transaction(() => {
      if (destinationFingerprint(backupDestination(store, id)) !== configuration)
        throw new Error('The destination changed while reading its backup. Prepare a new review.');
      const current = exportLibrary(store);
      const comparison = compareBackupRecords(
        backupRecords(current),
        remote.manifest?.records,
        current.excluded,
      );
      const createdAt = now();
      const reviewId = crypto.randomUUID();
      const artifact = createBackupArtifact(
        store,
        {
          id: reviewId,
          createdAt,
          fingerprint: comparison.fingerprint,
          previous: remote.pointer?.manifestDigest || null,
        },
        current,
      );
      const review: SavedBackupReview = {
        ...comparison,
        id: reviewId,
        destinationId: id,
        destinationFingerprint: configuration,
        destinationIdentity: destinationIdentity(destination),
        destinationLabel: destinationLabel(destination),
        createdAt,
        expiresAt: new Date(Date.now() + BACKUP_REVIEW_LIFETIME_MS).toISOString(),
        remote: {
          revision: remote.revision,
          pointer: remote.pointer,
          tree: remote.tree,
          repositoryId: remote.repositoryId,
        },
        manifestDigest: artifact.pointer.manifestDigest,
        archiveDigest: artifact.manifest.archiveDigest,
        archiveBytes: artifact.archive.length,
        manifestBytes: artifact.manifestBytes.length,
      };
      if (destination.kind === 'github' && artifact.archive.length > MAX_GITHUB_BACKUP_BYTES)
        throw new Error(
          'GitHub backup archives are limited to 32 MiB. Choose an S3-compatible destination for this library.',
        );
      const reviews = store
        .list<SavedBackupReview>('backup-review')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      for (const previous of reviews.slice(11))
        if (!store.get('backup-operation', previous.id)) store.remove('backup-review', previous.id);
      store.put('backup-review', review);
      return review;
    })
    .immediate();
}
export async function testBackupDestination(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
) {
  const destination = backupDestination(store, id);
  const configuration = destinationFingerprint(destination);
  await factory(destination).probe(signal);
  if (destinationFingerprint(backupDestination(store, id)) !== configuration)
    throw new Error('The destination changed during its connection test. Test it again.');
  const result = {
    id,
    configuration,
    checkedAt: now(),
    conditionalWrites: destination.kind === 's3',
  };
  store.put('backup-connection-test', result);
  return result;
}
export const BackupSaveRequest = z
  .object({ value: BackupDestinationSchema, expected: BackupDestinationSchema.optional() })
  .strict();
