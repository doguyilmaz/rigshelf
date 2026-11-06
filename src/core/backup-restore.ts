import { z } from 'zod';
import { type BackupSchema, exportLibrary, importLibrary } from './backup';
import { BackupDigest, verifiedBackupBundle } from './backup-artifacts';
import { backupDestination, destinationFingerprint } from './backup-destinations';
import { defaultBackupTransport } from './backup-manager';
import { backupFingerprint, backupRecords, compareBackupRecords } from './backup-review';
import type { BackupTransportFactory } from './backup-transport';
import { now, redact } from './safety';
import type { Store } from './store';

export const RestoreMode = z.enum(['missing', 'definitions']);
interface RestoreReview {
  id: string;
  destinationId: string;
  configuration: string;
  manifestDigest: string;
  fingerprint: string;
  localFingerprint: string;
  createdAt: string;
  expiresAt: string;
  mode: z.infer<typeof RestoreMode>;
  counts: ReturnType<typeof compareBackupRecords>['counts'];
  changes: ReturnType<typeof compareBackupRecords>['changes'];
  kept: number;
  excluded: ReturnType<typeof compareBackupRecords>['excluded'];
  import: ReturnType<typeof importLibrary>;
}
async function remoteBundle(
  store: Store,
  destinationId: string,
  digest: string,
  factory: BackupTransportFactory,
  signal?: AbortSignal,
) {
  const destination = backupDestination(store, destinationId);
  const configuration = destinationFingerprint(destination);
  const transport = factory(destination);
  await transport.readCurrent(signal);
  const manifest = await transport.readManifest(BackupDigest.parse(digest), signal);
  const bundle = verifiedBackupBundle(
    store,
    await transport.readArchive(manifest.archiveDigest, signal),
    manifest,
  );
  if (destinationFingerprint(backupDestination(store, destinationId)) !== configuration)
    throw new Error('The destination changed while reading this backup. Review it again.');
  return { manifest, bundle, configuration };
}
export async function backupHistory(
  store: Store,
  id: string,
  options: { cursor?: string; limit?: number } = {},
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
) {
  const destination = backupDestination(store, id);
  const transport = factory(destination);
  const remote = await transport.readCurrent(signal);
  let cursor = options.cursor
    ? BackupDigest.parse(options.cursor)
    : remote.pointer?.manifestDigest || null;
  const limit = z
    .number()
    .int()
    .min(1)
    .max(20)
    .parse(options.limit || 10);
  const seen = new Set<string>();
  const snapshots: {
    digest: string;
    createdAt: string;
    fingerprint: string;
    archiveBytes: number;
    records: number;
    excluded: number;
    operationId: string;
  }[] = [];
  while (cursor && snapshots.length < limit) {
    if (seen.has(cursor)) throw new Error('The remote backup history contains a cycle.');
    seen.add(cursor);
    const manifest = await transport.readManifest(cursor, signal);
    snapshots.push({
      digest: cursor,
      createdAt: manifest.createdAt,
      fingerprint: manifest.fingerprint,
      archiveBytes: manifest.archiveBytes,
      records: manifest.records.length,
      excluded: manifest.excluded.length,
      operationId: manifest.operationId,
    });
    cursor = manifest.previous;
  }
  return { snapshots, nextCursor: cursor, current: remote.pointer?.manifestDigest || null };
}
function selectedRestore(
  store: Store,
  bundle: z.infer<typeof BackupSchema>,
  mode: z.infer<typeof RestoreMode>,
) {
  return {
    ...bundle,
    presets:
      mode === 'definitions'
        ? bundle.presets
        : bundle.presets.filter((value) => !store.get('preset', value.id)),
    rules:
      mode === 'definitions'
        ? bundle.rules
        : bundle.rules.filter((value) => !store.get('rule', value.id)),
  };
}
function definitionPreview(
  store: Store,
  bundle: z.infer<typeof BackupSchema>,
  mode: z.infer<typeof RestoreMode>,
) {
  const selected = selectedRestore(store, bundle, mode);
  if (mode === 'missing') return importLibrary(store, selected, false);
  const preview = importLibrary(store, selected, false);
  const definitionConflicts = new Set([
    ...selected.presets.map((value) => `Preset: ${value.name}`),
    ...selected.rules.map((value) => `Rule: ${value.name}`),
  ]);
  const immutableConflicts = new Set(
    selected.entries
      .filter((value) => {
        const existing = store.entry(value.entry.id);
        return (
          existing && (existing.digest !== value.entry.digest || existing.body !== value.entry.body)
        );
      })
      .map((value) => value.entry.name),
  );
  return {
    ...preview,
    conflicts: preview.conflicts.filter(
      (conflict) => !definitionConflicts.has(conflict) || immutableConflicts.has(conflict),
    ),
  };
}
export async function prepareBackupRestore(
  store: Store,
  id: string,
  digest: string,
  mode: z.infer<typeof RestoreMode> = 'missing',
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
): Promise<RestoreReview> {
  RestoreMode.parse(mode);
  const remote = await remoteBundle(store, id, digest, factory, signal);
  return store.db
    .transaction(() => {
      const local = exportLibrary(store);
      const incoming = { ...remote.bundle, excluded: remote.manifest.excluded };
      const comparison = compareBackupRecords(
        backupRecords(incoming),
        backupRecords(local),
        remote.manifest.excluded,
      );
      const changes = comparison.changes.filter(
        (change) =>
          change.action !== 'removed' &&
          (change.action === 'added' ||
            (mode === 'definitions' && (change.kind === 'preset' || change.kind === 'directive'))),
      );
      const counts = {
        added: changes.filter((value) => value.action === 'added').length,
        changed: changes.filter((value) => value.action === 'changed').length,
        removed: 0,
        unchanged: comparison.counts.unchanged,
      };
      const review: RestoreReview = {
        id: crypto.randomUUID(),
        destinationId: id,
        configuration: remote.configuration,
        manifestDigest: digest,
        fingerprint: remote.manifest.fingerprint,
        localFingerprint: backupFingerprint(local),
        createdAt: now(),
        expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
        mode,
        counts,
        changes,
        kept: backupRecords(local).length - counts.changed,
        excluded: remote.manifest.excluded,
        import: definitionPreview(store, remote.bundle, mode),
      };
      store.put('backup-restore-review', review);
      return review;
    })
    .immediate();
}
export function backupRestoreReview(store: Store, id: string): RestoreReview {
  const review = store.get<RestoreReview>('backup-restore-review', z.string().uuid().parse(id));
  if (!review) throw new Error('Restore review not found. Prepare a new review.');
  return review;
}
export async function restoreBackup(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
) {
  const review = store.get<RestoreReview>('backup-restore-review', z.string().uuid().parse(id));
  if (!review || Date.parse(review.expiresAt) < Date.now())
    throw new Error('This restore review expired. Prepare a new review.');
  if (
    destinationFingerprint(backupDestination(store, review.destinationId)) !== review.configuration
  )
    throw new Error('The backup destination changed after restore review.');
  const remote = await remoteBundle(
    store,
    review.destinationId,
    review.manifestDigest,
    factory,
    signal,
  );
  if (remote.manifest.fingerprint !== review.fingerprint)
    throw new Error('The selected backup changed after review.');
  return store.db
    .transaction(() => {
      if (
        destinationFingerprint(backupDestination(store, review.destinationId)) !==
        review.configuration
      )
        throw new Error('The backup destination changed after restore review.');
      if (backupFingerprint(exportLibrary(store)) !== review.localFingerprint)
        throw new Error('The local library changed after restore review. Review it again.');
      const selected = selectedRestore(store, remote.bundle, review.mode);
      if (review.mode === 'definitions') {
        const preview = definitionPreview(store, remote.bundle, review.mode);
        if (preview.conflicts.length)
          throw new Error(
            'This backup has conflicting immutable records. Reconcile them before restoring.',
          );
        for (const preset of selected.presets) store.remove('preset', preset.id);
        for (const rule of selected.rules) store.remove('rule', rule.id);
      }
      const result = importLibrary(store, selected, true);
      store.remove('backup-restore-review', id);
      store.event('backup.restored', `${review.mode}: ${review.manifestDigest.slice(0, 12)}`);
      return result;
    })
    .immediate();
}
function recordText(
  bundle: ReturnType<typeof exportLibrary> | z.infer<typeof BackupSchema>,
  id: string,
): string {
  const entry = bundle.entries.find((value) => `${value.entry.kind}:${value.entry.id}` === id);
  if (entry) {
    const { body, ...metadata } = entry.entry;
    return `${JSON.stringify(metadata, null, 2)}\n\n${body}\n\n${JSON.stringify(
      entry.files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.content, 'base64'),
        executable: file.executable,
      })),
      null,
      2,
    )}`;
  }
  const collections = [
    ['source', bundle.sources],
    ['preset', bundle.presets],
    ['directive', bundle.rules],
  ] as const;
  for (const [kind, records] of collections) {
    const record = records.find((value) => `${kind}:${value.id}` === id);
    if (record) return JSON.stringify(record, null, 2);
  }
  return '';
}
export async function inspectBackupChange(
  store: Store,
  input: {
    destinationId: string;
    manifestDigest?: string;
    recordId: string;
    localFingerprint: string;
  },
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
) {
  z.string().min(1).max(220).parse(input.recordId);
  const local = exportLibrary(store);
  if (backupFingerprint(local) !== input.localFingerprint)
    throw new Error(
      'The library changed after review. Refresh the review before inspecting changes.',
    );
  const remote = input.manifestDigest
    ? await remoteBundle(store, input.destinationId, input.manifestDigest, factory, signal)
    : undefined;
  if (backupFingerprint(exportLibrary(store)) !== input.localFingerprint)
    throw new Error('The library changed while reading this comparison. Review it again.');
  const before = redact(remote ? recordText(remote.bundle, input.recordId) : '');
  const after = redact(recordText(local, input.recordId));
  return {
    before: before.slice(0, 25000),
    after: after.slice(0, 25000),
    truncated: before.length > 25000 || after.length > 25000,
  };
}
