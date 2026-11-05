import { gunzipSync, gzipSync } from 'node:zlib';
import { exportLibrary, importLibrary } from './backup';
import type { Store } from './store';

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_JSON_BYTES = 512 * 1024 * 1024;
export function exportArchive(store: Store): { bytes: Uint8Array; excluded: number } {
  const bundle = exportLibrary(store);
  return {
    bytes: gzipSync(JSON.stringify(bundle), { level: 6 }),
    excluded: bundle.excluded.length,
  };
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
