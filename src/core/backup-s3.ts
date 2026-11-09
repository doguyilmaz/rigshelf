import { S3Client } from 'bun';
import { MAX_ARCHIVE_BYTES } from './archive';
import {
  archiveKey,
  type BackupArtifact,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_POINTER_BYTES,
  manifestKey,
  readBackupManifest,
  readBackupPointer,
} from './backup-artifacts';
import { backupCredential, type S3BackupDestination } from './backup-destinations';
import { type BackupFetch, BackupRemoteError, backupResponse } from './backup-network';
import type { BackupPublishContext, BackupTransport, RemoteBackupState } from './backup-transport';
import { hash } from './safety';

type S3Response = Awaited<ReturnType<typeof backupResponse>>;
const PROBE_CLEANUP_TIMEOUT_MS = 5000;
export function s3BackupTransport(
  destination: S3BackupDestination,
  environment: Record<string, string | undefined> = process.env,
  fetcher: BackupFetch = fetch,
): BackupTransport {
  const credentials = {
    accessKeyId: backupCredential(destination.accessKeyEnv, environment),
    secretAccessKey: backupCredential(destination.secretKeyEnv, environment),
    sessionToken: destination.sessionTokenEnv
      ? backupCredential(destination.sessionTokenEnv, environment)
      : '',
  };
  function sign(key: string, method: 'GET' | 'PUT' | 'DELETE'): string {
    try {
      return S3Client.presign(key, {
        ...credentials,
        endpoint: destination.endpoint,
        bucket: destination.bucket,
        region: destination.region,
        virtualHostedStyle: false,
        method,
        expiresIn: 300,
      });
    } catch {
      throw new BackupRemoteError(
        'Could not sign the S3 request. Check the selected credential references and endpoint.',
      );
    }
  }
  async function request(
    key: string,
    method: 'GET' | 'PUT' | 'DELETE',
    signal?: AbortSignal,
    body?: Uint8Array,
    headers: Record<string, string> = {},
    limit = MAX_BACKUP_MANIFEST_BYTES,
  ): Promise<S3Response> {
    const url = sign(key, method);
    const expected = new URL(destination.endpoint);
    const signed = new URL(url);
    if (signed.origin !== expected.origin || !signed.pathname.startsWith(`/${destination.bucket}/`))
      throw new BackupRemoteError('The S3 signer changed the selected destination.');
    return backupResponse(
      url,
      { method, headers, ...(body ? { body: new Uint8Array(body).buffer } : {}) },
      limit,
      signal,
      fetcher,
    );
  }
  function requireSuccess(response: S3Response): void {
    if (response.status < 200 || response.status >= 300)
      throw new BackupRemoteError(
        `S3 returned HTTP ${response.status}. Check bucket access, endpoint and region.`,
        response.status,
      );
  }
  async function read(key: string, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await request(key, 'GET', signal, undefined, {}, limit);
    requireSuccess(response);
    return response.bytes;
  }
  async function readCurrent(signal?: AbortSignal): Promise<RemoteBackupState> {
    const response = await request(
      `${destination.prefix}/current.json`,
      'GET',
      signal,
      undefined,
      {},
      MAX_BACKUP_POINTER_BYTES,
    );
    if (
      response.status === 404 &&
      /<Code>\s*NoSuchKey\s*<\/Code>/.test(new TextDecoder().decode(response.bytes))
    )
      return { revision: null, pointer: null, manifest: null };
    requireSuccess(response);
    const revision = response.headers.get('etag');
    if (!revision || revision.length > 200 || /[\r\n\0]/.test(revision))
      throw new BackupRemoteError(
        'S3 did not return a usable ETag. Conditional publication is unavailable.',
      );
    const pointer = readBackupPointer(response.bytes);
    const manifest = await readManifest(pointer.manifestDigest, signal);
    if (
      pointer.archiveDigest !== manifest.archiveDigest ||
      pointer.fingerprint !== manifest.fingerprint ||
      pointer.operationId !== manifest.operationId ||
      pointer.createdAt !== manifest.createdAt
    )
      throw new BackupRemoteError('The remote backup pointer does not match its manifest.');
    return { revision, pointer, manifest };
  }
  async function readManifest(digest: string, signal?: AbortSignal) {
    return readBackupManifest(
      await read(manifestKey(destination.prefix, digest), MAX_BACKUP_MANIFEST_BYTES, signal),
      digest,
    );
  }
  async function immutable(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const response = await request(key, 'PUT', signal, bytes, {
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    });
    if (response.status === 412) {
      const existing = await read(key, Math.max(bytes.length, 1), signal);
      if (hash(existing) !== hash(bytes))
        throw new BackupRemoteError(
          'An immutable backup key already contains different content. Nothing was overwritten.',
          412,
        );
    } else requireSuccess(response);
  }
  async function probe(signal?: AbortSignal): Promise<void> {
    const key = `${destination.prefix}/.probe/${crypto.randomUUID()}`;
    const before = new TextEncoder().encode('rigshelf-conditional-probe');
    let created = false;
    let failure: Error | undefined;
    try {
      const initial = await request(key, 'PUT', signal, before, { 'If-None-Match': '*' });
      requireSuccess(initial);
      created = true;
      const duplicate = await request(key, 'PUT', signal, new Uint8Array([1]), {
        'If-None-Match': '*',
      });
      if (duplicate.status !== 412)
        throw new BackupRemoteError(
          'This S3 service did not enforce conditional creation. Sync is blocked.',
        );
      const mismatch = await request(key, 'PUT', signal, new Uint8Array([2]), {
        'If-Match': '"rigshelf-deliberately-wrong-etag"',
      });
      if (mismatch.status !== 412)
        throw new BackupRemoteError(
          'This S3 service did not enforce conditional replacement. Sync is blocked.',
        );
      const current = await request(key, 'GET', signal);
      requireSuccess(current);
      if (hash(current.bytes) !== hash(before))
        throw new BackupRemoteError(
          'The S3 conditional probe changed unexpectedly. Sync is blocked.',
        );
      const etag = current.headers.get('etag');
      if (!etag) throw new BackupRemoteError('The S3 conditional probe has no ETag.');
      const update = await request(key, 'PUT', signal, new Uint8Array([3]), { 'If-Match': etag });
      requireSuccess(update);
    } catch (error) {
      failure =
        error instanceof Error ? error : new BackupRemoteError('The connection test failed.');
    }
    if (created)
      try {
        requireSuccess(await request(key, 'DELETE', AbortSignal.timeout(PROBE_CLEANUP_TIMEOUT_MS)));
      } catch {
        throw new BackupRemoteError(
          `${failure ? `${failure.message} ` : ''}The temporary connection test object could not be removed. Check object delete access for ${key}, then test again. No library was published.`,
        );
      }
    if (failure) throw failure;
  }
  async function publish(
    artifact: BackupArtifact,
    expected: RemoteBackupState,
    context: BackupPublishContext,
  ) {
    context.checkpoint({ phase: 'checking-conditions' });
    await probe(context.signal);
    context.assertCurrent();
    const before = await readCurrent(context.signal);
    if (before.revision !== expected.revision)
      throw new BackupRemoteError(
        'The remote backup changed after review. Prepare a new review.',
        412,
      );
    context.checkpoint({ phase: 'uploading-archive' });
    await immutable(
      archiveKey(destination.prefix, artifact.manifest.archiveDigest),
      artifact.archive,
      context.signal,
    );
    context.checkpoint({ phase: 'uploading-manifest' });
    await immutable(
      manifestKey(destination.prefix, artifact.pointer.manifestDigest),
      artifact.manifestBytes,
      context.signal,
    );
    context.assertCurrent();
    context.checkpoint({ phase: 'publishing-current' });
    const response = await request(
      `${destination.prefix}/current.json`,
      'PUT',
      context.signal,
      artifact.pointerBytes,
      {
        ...(expected.revision ? { 'If-Match': expected.revision } : { 'If-None-Match': '*' }),
        'Content-Type': 'application/json',
      },
    );
    if (response.status === 412 || response.status === 409) {
      const winner = await readCurrent(context.signal);
      if (winner.pointer?.manifestDigest === artifact.pointer.manifestDigest)
        return { state: 'published' as const, revision: winner.revision! };
      throw new BackupRemoteError(
        'Another backup won publication. Uploaded immutable objects were retained; prepare a new review.',
        response.status,
      );
    }
    requireSuccess(response);
    const confirmed = await readCurrent(context.signal);
    if (confirmed.pointer?.manifestDigest !== artifact.pointer.manifestDigest)
      throw new BackupRemoteError(
        'S3 publication could not be confirmed. Reconcile the operation.',
        undefined,
        true,
      );
    return { state: 'published' as const, revision: confirmed.revision! };
  }
  return {
    readCurrent,
    readManifest,
    readArchive: (digest, signal) =>
      read(archiveKey(destination.prefix, digest), MAX_ARCHIVE_BYTES, signal),
    probe,
    publish,
  };
}
