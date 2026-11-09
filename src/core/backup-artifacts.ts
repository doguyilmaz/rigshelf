import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_JSON_BYTES } from './archive';
import { BackupSchema, exportLibrary, importLibrary } from './backup';
import { backupFingerprint, backupRecords, canonicalBackup } from './backup-review';
import { hash } from './safety';
import type { Store } from './store';

export const MAX_BACKUP_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_POINTER_BYTES = 8192;
export const MAX_GITHUB_BACKUP_BYTES = 32 * 1024 * 1024;
export const BackupDigest = z.string().regex(/^[a-f0-9]{64}$/);
const BackupIndexRecord = z
  .object({
    id: z.string().min(1).max(220),
    kind: z.enum(['skill', 'mcp', 'plugin', 'resource', 'source', 'preset', 'directive']),
    name: z.string().max(500),
    digest: BackupDigest,
  })
  .strict();
export const BackupManifestSchema = z
  .object({
    format: z.literal('rigshelf-backup'),
    version: z.literal(1),
    operationId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    fingerprint: BackupDigest,
    archiveDigest: BackupDigest,
    archiveBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES),
    previous: BackupDigest.nullable(),
    records: z.array(BackupIndexRecord).max(22000),
    excluded: z
      .array(
        z
          .object({
            id: z.string().max(220),
            name: z.string().max(500),
            reason: z.string().max(2000),
          })
          .strict(),
      )
      .max(12000),
  })
  .strict();
export const BackupPointerSchema = BackupManifestSchema.pick({
  format: true,
  version: true,
  operationId: true,
  createdAt: true,
  fingerprint: true,
  archiveDigest: true,
})
  .extend({ manifestDigest: BackupDigest })
  .strict();
export type BackupManifest = z.infer<typeof BackupManifestSchema>;
export type BackupPointer = z.infer<typeof BackupPointerSchema>;
export function readBackupPointer(bytes: Uint8Array): BackupPointer {
  try {
    return BackupPointerSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('Backup pointer has an invalid or unsupported format. It was not used.');
  }
}
export interface BackupArtifact {
  archive: Uint8Array;
  manifest: BackupManifest;
  manifestBytes: Uint8Array;
  pointer: BackupPointer;
  pointerBytes: Uint8Array;
}
export function archiveKey(prefix: string, digest: string): string {
  return `${prefix}/snapshots/${BackupDigest.parse(digest)}.json.gz`;
}
export function manifestKey(prefix: string, digest: string): string {
  return `${prefix}/manifests/${BackupDigest.parse(digest)}.json`;
}
function indexFingerprint(manifest: BackupManifest): string {
  const records = [...manifest.records].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new Error('Backup manifest contains duplicate records.');
  return hash(canonicalBackup({ records, excluded: manifest.excluded }));
}
export function readBackupManifest(bytes: Uint8Array, expectedDigest: string): BackupManifest {
  if (
    bytes.length > MAX_BACKUP_MANIFEST_BYTES ||
    hash(bytes) !== BackupDigest.parse(expectedDigest)
  )
    throw new Error('Backup manifest integrity check failed.');
  let manifest: BackupManifest;
  try {
    manifest = BackupManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('Backup manifest has an invalid or unsupported format. It was not used.');
  }
  if (indexFingerprint(manifest) !== manifest.fingerprint)
    throw new Error('Backup index fingerprint does not match its records.');
  return manifest;
}
export function createBackupArtifact(
  store: Store,
  input: { id: string; createdAt: string; fingerprint: string; previous: string | null },
  captured = exportLibrary(store),
): BackupArtifact {
  const bundle = { ...captured, exportedAt: input.createdAt };
  if (backupFingerprint(bundle) !== input.fingerprint)
    throw new Error('The library changed after review. Prepare a new backup review.');
  importLibrary(store, bundle, false);
  const json = canonicalBackup(bundle);
  if (Buffer.byteLength(json) > MAX_ARCHIVE_JSON_BYTES)
    throw new Error('Backup JSON exceeds 512 MiB.');
  const archive = gzipSync(json, { level: 6 });
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Compressed backup exceeds 128 MiB.');
  const manifest = BackupManifestSchema.parse({
    format: 'rigshelf-backup',
    version: 1,
    operationId: input.id,
    createdAt: input.createdAt,
    fingerprint: input.fingerprint,
    archiveDigest: hash(archive),
    archiveBytes: archive.length,
    previous: input.previous,
    records: backupRecords(bundle),
    excluded: bundle.excluded,
  });
  const manifestBytes = Buffer.from(canonicalBackup(manifest));
  if (manifestBytes.length > MAX_BACKUP_MANIFEST_BYTES)
    throw new Error('Backup manifest exceeds 8 MiB.');
  const pointer = BackupPointerSchema.parse({
    format: manifest.format,
    version: manifest.version,
    operationId: manifest.operationId,
    createdAt: manifest.createdAt,
    fingerprint: manifest.fingerprint,
    archiveDigest: manifest.archiveDigest,
    manifestDigest: hash(manifestBytes),
  });
  return {
    archive,
    manifest,
    manifestBytes,
    pointer,
    pointerBytes: Buffer.from(canonicalBackup(pointer)),
  };
}
export function verifiedBackupBundle(
  store: Store,
  bytes: Uint8Array,
  manifest: BackupManifest,
): z.infer<typeof BackupSchema> {
  if (
    bytes.length !== manifest.archiveBytes ||
    bytes.length > MAX_ARCHIVE_BYTES ||
    hash(bytes) !== manifest.archiveDigest
  )
    throw new Error('Backup archive integrity check failed.');
  let raw: unknown;
  let bundle: z.infer<typeof BackupSchema>;
  let excluded: BackupManifest['excluded'];
  try {
    raw = JSON.parse(
      gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_JSON_BYTES }).toString('utf8'),
    ) as unknown;
    importLibrary(store, raw, false);
    bundle = BackupSchema.parse(raw);
    excluded = z.object({ excluded: BackupManifestSchema.shape.excluded }).parse(raw).excluded;
  } catch {
    throw new Error(
      'Backup archive failed portable format validation. No records or permissions were restored.',
    );
  }
  // Exclusions are audit metadata, intentionally outside the portable import schema.
  // Validate the exact archived records. Schema defaults must not rewrite their historical hashes.
  if (
    backupFingerprint({ ...(raw as z.input<typeof BackupSchema>), excluded }) !==
    manifest.fingerprint
  )
    throw new Error('Backup content does not match the reviewed manifest.');
  return bundle;
}
