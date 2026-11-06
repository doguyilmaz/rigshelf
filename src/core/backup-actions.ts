import { z } from 'zod';
import { exportLibrary } from './backup';
import { verifiedBackupBundle } from './backup-artifacts';
import { backupDestination, destinationFingerprint } from './backup-destinations';
import { backupJobs } from './backup-jobs';
import { defaultBackupTransport } from './backup-manager';
import { BackupRemoteError } from './backup-network';
import { backupFingerprint } from './backup-review';
import { removeStagedBackup } from './backup-staging';
import { type BackupOperation, backupOperation, savedBackupReview } from './backup-state';
import type {
  BackupPullRequest,
  BackupTransport,
  BackupTransportFactory,
  RemoteBackupState,
} from './backup-transport';
import { now } from './safety';
import type { Store } from './store';

interface MergeReview {
  id: string;
  operationId: string;
  destinationFingerprint: string;
  request: BackupPullRequest;
  manifestDigest: string;
  createdAt: string;
  expiresAt: string;
  localChanged: boolean;
}
function assertRepository(
  store: Store,
  operation: BackupOperation,
  remote: RemoteBackupState,
): void {
  const expected = savedBackupReview(store, operation.reviewId).remote.repositoryId;
  if (expected !== undefined && remote.repositoryId !== expected)
    throw new BackupRemoteError(
      'The GitHub repository identity changed. This operation was retained without a remote mutation.',
      409,
    );
}
function transportFor(
  store: Store,
  operation: BackupOperation,
  factory: BackupTransportFactory,
): BackupTransport {
  const destination = backupDestination(store, operation.destinationId);
  if (destinationFingerprint(destination) !== operation.destinationFingerprint)
    throw new Error(
      'This receipt belongs to an earlier destination configuration. It was kept, but no request was sent.',
    );
  return factory(destination);
}
async function verifyStored(
  store: Store,
  operation: BackupOperation,
  transport: BackupTransport,
  signal?: AbortSignal,
): Promise<void> {
  const manifest = await transport.readManifest(operation.manifestDigest, signal);
  if (
    manifest.archiveDigest !== operation.archiveDigest ||
    manifest.fingerprint !== operation.fingerprint
  )
    throw new BackupRemoteError('The remote Snapshot differs from this operation receipt.');
  verifiedBackupBundle(
    store,
    await transport.readArchive(operation.archiveDigest, signal),
    manifest,
  );
}
function recordStatus(
  store: Store,
  original: BackupOperation,
  patch: Partial<BackupOperation>,
): BackupOperation {
  return store.db
    .transaction(() => {
      const current = backupOperation(store, original.id);
      if (current.sequence !== original.sequence) return current;
      const next = { ...current, ...patch, sequence: current.sequence + 1, updatedAt: now() };
      store.put('backup-operation', next);
      return next;
    })
    .immediate();
}
export async function refreshBackupOperation(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
): Promise<BackupOperation> {
  const operation = backupJobs(store, factory).get(id);
  if (['queued', 'running', 'cancelling'].includes(operation.state)) return operation;
  const transport = transportFor(store, operation, factory);
  const remote = await transport.readCurrent(signal);
  assertRepository(store, operation, remote);
  let patch: Partial<BackupOperation> | undefined;
  if (remote.pointer?.manifestDigest === operation.manifestDigest) {
    await verifyStored(store, operation, transport, signal);
    patch = {
      state: operation.state === 'noop' ? 'noop' : 'published',
      phase: 'verified',
      revision: remote.revision!,
      error: undefined,
    };
  } else if (['published', 'noop'].includes(operation.state)) {
    await verifyStored(store, operation, transport, signal);
    patch = { phase: 'historical-verified', error: undefined };
  } else if (transport.pullRequest) {
    const request = operation.pullRequest
      ? await transport.pullRequest(operation.pullRequest.number, signal)
      : await transport.operationPullRequest?.(operation.id, signal);
    if (request) {
      if (request.head !== operation.commit)
        patch = {
          state: request.state === 'closed' ? 'conflict' : 'awaiting-merge',
          phase: request.state === 'closed' ? 'externally-changed-pr' : 'awaiting-merge',
          pullRequest: request,
          error:
            request.state === 'closed'
              ? 'This PR was edited and closed or merged outside Rigshelf. The reviewed backup was not confirmed. Review the current destination before a new Sync.'
              : 'This PR was edited outside Rigshelf. Close or merge it on GitHub, then check remote status. App merge and closure are blocked.',
        };
      else if (request.merged) {
        await verifyStored(store, operation, transport, signal);
        patch = {
          state: 'published',
          phase: 'published',
          pullRequest: request,
          revision: remote.revision!,
          error: undefined,
        };
      } else
        patch = {
          state: request.state === 'closed' ? 'cancelled' : 'awaiting-merge',
          phase: request.state === 'closed' ? 'closed-pr' : 'awaiting-merge',
          pullRequest: request,
          error: undefined,
        };
    }
  }
  const updated = patch ? recordStatus(store, operation, patch) : operation;
  if (['published', 'noop', 'cancelled'].includes(updated.state)) {
    const warning = await removeStagedBackup(store, id);
    if (warning) return recordStatus(store, updated, { warnings: [warning] });
  }
  return updated;
}
export async function prepareBackupMerge(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
  signal?: AbortSignal,
): Promise<MergeReview> {
  const operation = await refreshBackupOperation(store, id, factory, signal);
  if (
    operation.state !== 'awaiting-merge' ||
    !operation.pullRequest ||
    operation.pullRequest.head !== operation.commit
  )
    throw new Error('This backup has no unchanged open PR to merge.');
  const review: MergeReview = {
    id: crypto.randomUUID(),
    operationId: id,
    destinationFingerprint: operation.destinationFingerprint,
    request: operation.pullRequest,
    manifestDigest: operation.manifestDigest,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    localChanged: backupFingerprint(exportLibrary(store)) !== operation.fingerprint,
  };
  store.put('backup-merge-review', review);
  return review;
}
export async function mergeBackup(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
): Promise<BackupOperation> {
  const review = store.get<MergeReview>('backup-merge-review', z.string().uuid().parse(id));
  if (!review || Date.parse(review.expiresAt) < Date.now())
    throw new Error('The merge review expired. Review this PR again.');
  const operation = backupOperation(store, review.operationId);
  if (operation.state === 'published') return operation;
  if (
    operation.destinationFingerprint !== review.destinationFingerprint ||
    operation.manifestDigest !== review.manifestDigest ||
    operation.commit !== review.request.head
  )
    throw new Error('The reviewed PR changed. Prepare a new merge review.');
  return backupJobs(store, factory).action(operation.id, 'merging-pr', async (signal) => {
    const transport = transportFor(store, operation, factory);
    if (!transport.merge) throw new Error('This destination does not use pull requests.');
    assertRepository(store, operation, await transport.readCurrent(signal));
    await transport.merge(review.request, signal);
    const request = await transport.pullRequest!(review.request.number, signal);
    if (!request.merged)
      throw new BackupRemoteError(
        'GitHub did not confirm this PR as merged. Refresh its status.',
        undefined,
        true,
      );
    await transport.readCurrent(signal);
    await verifyStored(store, operation, transport, signal);
    store.event('backup.merged', operation.destinationLabel);
    return { state: 'published', phase: 'published', pullRequest: request, error: undefined };
  });
}
export async function closeBackupPullRequest(
  store: Store,
  id: string,
  factory: BackupTransportFactory = defaultBackupTransport,
): Promise<BackupOperation> {
  const operation = await refreshBackupOperation(store, id, factory);
  if (operation.state === 'cancelled' || operation.state === 'published') return operation;
  if (!operation.pullRequest || operation.pullRequest.head !== operation.commit)
    throw new Error(
      'This PR changed or was not created by this reviewed operation. Inspect it on GitHub.',
    );
  return backupJobs(store, factory).action(id, 'closing-pr', async (signal) => {
    const transport = transportFor(store, operation, factory);
    if (!transport.closePullRequest || !transport.pullRequest)
      throw new Error('This destination does not use pull requests.');
    const current = await transport.pullRequest(operation.pullRequest!.number, signal);
    if (current.head !== operation.commit)
      throw new BackupRemoteError('The backup PR changed. It was not closed.', 409);
    if (!current.merged && current.state === 'open')
      await transport.closePullRequest(current, signal);
    const closed = await transport.pullRequest(current.number, signal);
    if (closed.merged) {
      await transport.readCurrent(signal);
      await verifyStored(store, operation, transport, signal);
      return { state: 'published', phase: 'published', pullRequest: closed };
    }
    if (closed.state !== 'closed')
      throw new BackupRemoteError(
        'GitHub did not confirm PR closure. Check its remote status.',
        undefined,
        true,
      );
    return { state: 'cancelled', phase: 'closed-pr', pullRequest: closed };
  });
}
export function backupOperationView(operation: BackupOperation) {
  const { ownerPid, ownerSession, ...view } = operation;
  return view;
}
