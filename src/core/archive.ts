import { gunzipSync, gzipSync } from 'node:zlib';
import { BackupSchema, exportLibrary, importLibrary } from './backup';
import { type BackupReview, backupFingerprint, compareBackup } from './backup-review';
import type { Store } from './store';

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_JSON_BYTES = 512 * 1024 * 1024;
export function exportArchive(
  store: Store,
  expected?: string,
): { bytes: Uint8Array; excluded: number } {
  const bundle = exportLibrary(store);
  if (expected && backupFingerprint(bundle) !== expected)
    throw new Error(
      'The library changed after backup review. Review the changes again before downloading.',
    );
  return {
    bytes: gzipSync(JSON.stringify(bundle), { level: 6 }),
    excluded: bundle.excluded.length,
  };
}
export function compareArchive(store: Store, bytes: Uint8Array): BackupReview {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Compressed library exceeds 128 MiB.');
  const raw: unknown = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_JSON_BYTES }).toString('utf8'),
  );
  // The same complete validation as import, with no catalog writes or authority adoption.
  importLibrary(store, raw, false);
  return compareBackup(exportLibrary(store), BackupSchema.parse(raw));
}
export function importArchive(
  store: Store,
  bytes: Uint8Array,
  apply = false,
): ReturnType<typeof importLibrary> {
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error(
      'Compressed library exceeds 128 MiB. Use versioned JSON with the CLI for larger libraries.',
    );
  const decoded = gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_JSON_BYTES });
  return importLibrary(store, JSON.parse(decoded.toString('utf8')), apply);
}
