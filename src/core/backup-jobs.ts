import { exportLibrary } from './backup';
import {
  type BackupArtifact,
  createBackupArtifact,
  verifiedBackupBundle,
} from './backup-artifacts';
import { backupDestination, destinationFingerprint } from './backup-destinations';
import { defaultBackupTransport } from './backup-manager';
import { BackupRemoteError } from './backup-network';
import { backupFingerprint } from './backup-review';
import { readStagedBackup, removeStagedBackup, stageBackup } from './backup-staging';
import {
  BACKUP_OPERATION_TIMEOUT_MS,
  type BackupOperation,
  backupOperation,
  pendingBackup,
  type SavedBackupReview,
  savedBackupReview,
  unfinishedBackupStates,
} from './backup-state';
import type {
  BackupCheckpoint,
  BackupTransport,
  BackupTransportFactory,
  RemoteBackupState,
} from './backup-transport';
import { now } from './safety';
import type { Store } from './store';

const MAX_ACTIVE_BACKUPS = 2;
const session = crypto.randomUUID();
interface BackupLock {
  id: string;
  operationId: string;
  ownerPid: number;
  ownerSession: string;
}
function liveOwner(operation: BackupOperation): boolean {
  if (operation.ownerPid === process.pid) return operation.ownerSession === session;
  try {
    process.kill(operation.ownerPid, 0);
    return true;
  } catch {
    return false;
  }
}
export class BackupJobs {
  private pending = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  closed = false;
  constructor(
    private store: Store,
    private factory: BackupTransportFactory = defaultBackupTransport,
  ) {}

  start(reviewId: string): BackupOperation {
    if (this.closed) throw new Error('The workbench is shutting down. Reopen it before syncing.');
    const review = savedBackupReview(this.store, reviewId);
    let begin = false;
    const operation = this.store.db
      .transaction(() => {
        const existing = this.store.get<BackupOperation>('backup-operation', reviewId);
        if (existing) return existing;
        if (this.pending.size >= MAX_ACTIVE_BACKUPS)
          throw new Error('Two backups are already active. Wait for one to finish.');
        if (Date.parse(review.expiresAt) < Date.now())
          throw new Error('This backup review expired. Prepare a new review.');
        this.assertReview(review);
        const other = pendingBackup(this.store, review.destinationIdentity);
        if (other)
          throw new Error(
            'This destination has an unfinished backup. Check or retry that operation first.',
          );
        const createdAt = now();
        const value: BackupOperation = {
          sequence: 1,
          id: review.id,
          reviewId: review.id,
          destinationId: review.destinationId,
          destinationFingerprint: review.destinationFingerprint,
          destinationIdentity: review.destinationIdentity,
          destinationLabel: review.destinationLabel,
          fingerprint: review.fingerprint,
          manifestDigest: review.manifestDigest,
          archiveDigest: review.archiveDigest,
          archiveBytes: review.archiveBytes,
          createdAt,
          updatedAt: createdAt,
          state: 'queued',
          phase: 'preparing',
          ownerPid: process.pid,
          ownerSession: session,
          expectedRevision: review.remote.revision,
        };
        this.store.put('backup-operation', value);
        this.lock(value);
        begin = true;
        return value;
      })
      .immediate();
    if (begin) this.launch(operation, false);
    return operation;
  }
  retry(id: string, acknowledgeFrozen = false): BackupOperation {
    if (this.closed) throw new Error('The workbench is shutting down.');
    let operation = backupOperation(this.store, id);
    if (this.pending.has(id)) return operation;
    if (this.pending.size >= MAX_ACTIVE_BACKUPS)
      throw new Error('Two backups are already active. Wait for one to finish.');
    if (['published', 'noop', 'cancelled', 'awaiting-merge'].includes(operation.state))
      throw new Error(
        'This operation does not need a retry. Check its status or prepare a new review.',
      );
    if (['queued', 'running', 'cancelling'].includes(operation.state) && liveOwner(operation))
      throw new Error('This backup is still running in another process.');
    if (!acknowledgeFrozen)
      throw new Error('Review and acknowledge the frozen Snapshot before retrying this operation.');
    operation = this.store.db
      .transaction(() => {
        const current = backupOperation(this.store, id);
        if (['published', 'noop', 'cancelled', 'awaiting-merge'].includes(current.state))
          throw new Error('This operation no longer needs a retry. Refresh its status.');
        if (['queued', 'running', 'cancelling'].includes(current.state) && liveOwner(current))
          throw new Error('This backup is still running in another process.');
        this.assertDestination(current);
        const other = pendingBackup(this.store, current.destinationIdentity);
        if (other && other.id !== id)
          throw new Error('Another operation is pending for this destination.');
        const value = {
          ...current,
          sequence: current.sequence + 1,
          state: 'queued' as const,
          ownerPid: process.pid,
          ownerSession: session,
          cancelRequested: false,
          error: undefined,
          updatedAt: now(),
        };
        this.store.put('backup-operation', value);
        this.lock(value);
        return value;
      })
      .immediate();
    this.launch(operation, true);
    return operation;
  }
  private launch(operation: BackupOperation, resume: boolean): void {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => this.run(operation.id, resume, controller));
    this.pending.set(operation.id, { controller, promise });
    void promise.finally(() => this.pending.delete(operation.id)).catch(() => undefined);
  }
  async wait(id: string): Promise<BackupOperation> {
    await this.pending.get(id)?.promise;
    return this.get(id);
  }
  async action(
    id: string,
    phase: string,
    run: (signal: AbortSignal) => Promise<Partial<BackupOperation>>,
  ): Promise<BackupOperation> {
    if (this.closed) throw new Error('The workbench is shutting down.');
    if (this.pending.has(id)) return this.wait(id);
    if (this.pending.size >= MAX_ACTIVE_BACKUPS)
      throw new Error('Two backups are already active. Wait for one to finish.');
    const previous = this.store.db
      .transaction(() => {
        const current = this.get(id);
        this.assertDestination(current);
        if (['queued', 'running', 'cancelling'].includes(current.state) && liveOwner(current))
          throw new Error('This backup is active in another process.');
        if (!['awaiting-merge', 'uncertain'].includes(current.state))
          throw new Error('This backup has no pending remote action.');
        const owned = {
          ...current,
          sequence: current.sequence + 1,
          state: 'running' as const,
          phase,
          ownerPid: process.pid,
          ownerSession: session,
          cancelRequested: false,
          error: undefined,
          updatedAt: now(),
        };
        this.lock(owned);
        this.store.put('backup-operation', owned);
        return current;
      })
      .immediate();
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      try {
        const patch = await run(
          AbortSignal.any([controller.signal, AbortSignal.timeout(BACKUP_OPERATION_TIMEOUT_MS)]),
        );
        if (patch.state === 'published' || patch.state === 'cancelled')
          await this.complete(id, patch);
        else this.update(id, patch);
      } catch (failure) {
        const ambiguous =
          (failure instanceof BackupRemoteError &&
            (failure.uncertain || (!!failure.status && failure.status >= 500))) ||
          controller.signal.aborted;
        this.update(id, {
          state: ambiguous ? 'uncertain' : previous.state,
          error:
            failure instanceof BackupRemoteError
              ? failure.message
              : 'The remote action could not be confirmed. Refresh its status before continuing.',
        });
      }
    });
    this.pending.set(id, { controller, promise });
    void promise.finally(() => this.pending.delete(id)).catch(() => undefined);
    await promise;
    return this.get(id);
  }
  get(id: string): BackupOperation {
    const current = backupOperation(this.store, id);
    if (
      ['queued', 'running', 'cancelling'].includes(current.state) &&
      !this.pending.has(id) &&
      !liveOwner(current)
    )
      return this.update(
        id,
        {
          state: 'uncertain',
          error:
            'The previous process stopped before confirming this backup. Check remote status or retry the frozen Snapshot.',
        },
        current.sequence,
      );
    return current;
  }
  private lock(operation: BackupOperation): void {
    const lock = this.store.get<BackupLock>('backup-lock', operation.destinationIdentity);
    if (lock && lock.operationId !== operation.id) {
      const other = this.store.get<BackupOperation>('backup-operation', lock.operationId);
      if (other && unfinishedBackupStates.includes(other.state))
        throw new Error('Another backup owns this destination.');
    }
    this.store.put('backup-lock', {
      id: operation.destinationIdentity,
      operationId: operation.id,
      ownerPid: process.pid,
      ownerSession: session,
    });
  }
  private update(
    id: string,
    patch: Partial<BackupOperation>,
    expectedSequence?: number,
  ): BackupOperation {
    return this.store.db
      .transaction(() => {
        const current = backupOperation(this.store, id);
        if (expectedSequence !== undefined && current.sequence !== expectedSequence) return current;
        const value = { ...current, ...patch, sequence: current.sequence + 1, updatedAt: now() };
        this.store.put('backup-operation', value);
        return value;
      })
      .immediate();
  }
  private assertDestination(
    operation: Pick<BackupOperation, 'destinationId' | 'destinationFingerprint'>,
  ): void {
    if (
      destinationFingerprint(backupDestination(this.store, operation.destinationId)) !==
      operation.destinationFingerprint
    )
      throw new Error('The backup destination changed. Prepare a new review.');
  }
  private assertReview(review: SavedBackupReview): void {
    this.assertDestination(review);
    if (backupFingerprint(exportLibrary(this.store)) !== review.fingerprint)
      throw new Error('The library changed after review. Prepare a new review.');
  }
  private assertOwned(id: string, resume: boolean, signal: AbortSignal): void {
    signal.throwIfAborted();
    const current = backupOperation(this.store, id);
    this.assertDestination(current);
    const lock = this.store.get<BackupLock>('backup-lock', current.destinationIdentity);
    if (
      current.cancelRequested ||
      lock?.operationId !== id ||
      lock.ownerSession !== session ||
      current.ownerSession !== session
    )
      throw new Error('Backup cancelled or destination ownership changed.');
    if (!resume && backupFingerprint(exportLibrary(this.store)) !== current.fingerprint)
      throw new Error(
        'The library changed during Sync. The reviewed backup was not published; prepare a new review.',
      );
  }
  private checkpoint(id: string, patch: BackupCheckpoint): void {
    this.store.db
      .transaction(() => {
        const current = backupOperation(this.store, id);
        if (current.ownerSession !== session || current.cancelRequested)
          throw new Error('Backup cancelled.');
        this.store.put('backup-operation', {
          ...current,
          ...patch,
          sequence: current.sequence + 1,
          updatedAt: now(),
        });
      })
      .immediate();
  }
  private async artifact(
    operation: BackupOperation,
    review: SavedBackupReview,
    resume: boolean,
  ): Promise<BackupArtifact> {
    if (resume) {
      try {
        return await readStagedBackup(
          this.store,
          operation.id,
          operation.manifestDigest,
          operation.archiveDigest,
        );
      } catch {
        this.assertReview(review);
        // Missing/corrupt stages are never overwritten; exact reconstruction still uses exclusive writes.
      }
    }
    const artifact = this.store.db.transaction(() =>
      createBackupArtifact(this.store, {
        id: review.id,
        createdAt: review.createdAt,
        fingerprint: review.fingerprint,
        previous: review.remote.pointer?.manifestDigest || null,
      }),
    )();
    if (
      artifact.pointer.manifestDigest !== operation.manifestDigest ||
      artifact.manifest.archiveDigest !== operation.archiveDigest
    )
      throw new Error('The reviewed backup cannot be reconstructed exactly. Prepare a new review.');
    await stageBackup(this.store, operation.id, artifact);
    return artifact;
  }
  private async run(id: string, resume: boolean, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(BACKUP_OPERATION_TIMEOUT_MS),
    ]);
    try {
      let operation = this.update(id, { state: 'running' });
      const review = savedBackupReview(this.store, operation.reviewId);
      this.assertOwned(id, resume, signal);
      const artifact = await this.artifact(operation, review, resume);
      const transport = this.factory(backupDestination(this.store, operation.destinationId));
      this.checkpoint(id, { phase: 'reading-remote' });
      const remote = await transport.readCurrent(signal);
      if (remote.pointer?.manifestDigest === operation.manifestDigest) {
        await this.verify(transport, remote, signal);
        await this.complete(id, {
          state: 'published',
          phase: 'published',
          revision: remote.revision!,
        });
        return;
      }
      if (!resume && remote.revision !== review.remote.revision)
        throw new BackupRemoteError(
          'The remote backup changed after review. Prepare a new review.',
          412,
        );
      if (!resume && remote.pointer?.fingerprint === operation.fingerprint) {
        await this.verify(transport, remote, signal);
        await this.complete(id, {
          state: 'noop',
          phase: 'verified',
          manifestDigest: remote.pointer.manifestDigest,
          archiveDigest: remote.pointer.archiveDigest,
          archiveBytes: remote.manifest!.archiveBytes,
          revision: remote.revision!,
        });
        return;
      }
      this.assertOwned(id, resume, signal);
      const published = await transport.publish(
        artifact,
        { ...review.remote, manifest: null },
        {
          id,
          signal,
          previous: resume ? operation : undefined,
          checkpoint: (patch) => this.checkpoint(id, patch),
          assertCurrent: () => this.assertOwned(id, resume, signal),
        },
      );
      operation = this.update(id, {
        state: published.state,
        phase: published.state,
        revision: published.revision,
        pullRequest: published.pullRequest,
        error: undefined,
      });
      if (published.state === 'published') {
        const confirmed = await transport.readCurrent(signal);
        if (confirmed.pointer?.manifestDigest !== artifact.pointer.manifestDigest)
          throw new BackupRemoteError(
            'Publication is not the destination’s current backup. Check remote status.',
            undefined,
            true,
          );
        await this.verify(transport, confirmed, signal);
        await this.complete(id, operation);
      }
      this.store.event('backup.sync', `${operation.destinationLabel}: ${operation.state}`);
    } catch (failure) {
      const current = backupOperation(this.store, id);
      const rejected =
        failure instanceof BackupRemoteError &&
        failure.status !== undefined &&
        failure.status >= 400 &&
        failure.status < 500;
      const possiblyPublished =
        !rejected &&
        ['publishing-current', 'creating-pr', 'verifying-publication', 'published'].includes(
          current.phase,
        );
      const interrupted = signal.aborted || current.cancelRequested;
      const uncertain =
        (failure instanceof BackupRemoteError &&
          (failure.uncertain || (!!failure.status && failure.status >= 500))) ||
        possiblyPublished;
      const state = uncertain
        ? 'uncertain'
        : interrupted
          ? 'cancelled'
          : failure instanceof BackupRemoteError && [409, 412].includes(failure.status || 0)
            ? 'conflict'
            : 'failed';
      const message =
        failure instanceof BackupRemoteError ||
        (failure instanceof Error &&
          /changed|review|destination|staged|cancelled|Snapshot|reconstruct|Set RIGSHELF_BACKUP_/.test(
            failure.message,
          ))
          ? failure.message
          : 'Backup could not finish. Check the destination and its credential references before retrying.';
      this.update(id, { state, error: message.slice(0, 1000) });
      if (state === 'cancelled') await this.cleanup(id);
      this.store.event('backup.failed', `${current.destinationLabel}: ${state}`);
    }
  }
  private async verify(
    transport: BackupTransport,
    remote: RemoteBackupState,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!remote.manifest) throw new Error('The remote backup has no manifest.');
    verifiedBackupBundle(
      this.store,
      await transport.readArchive(remote.manifest.archiveDigest, signal),
      remote.manifest,
    );
  }
  private async cleanup(id: string): Promise<void> {
    const warning = await removeStagedBackup(this.store, id);
    if (warning) this.update(id, { warnings: [warning] });
  }
  private async complete(id: string, patch: Partial<BackupOperation>): Promise<void> {
    this.update(id, { ...patch, error: undefined });
    await this.cleanup(id);
  }
  async cancel(id: string): Promise<BackupOperation> {
    this.get(id);
    const operation = this.store.db
      .transaction(() => {
        const current = backupOperation(this.store, id);
        if (current.state === 'awaiting-merge')
          throw new Error('Close the backup PR explicitly before cancelling this operation.');
        if (current.state === 'uncertain')
          throw new Error(
            'Check remote status or retry this frozen Snapshot before cancelling an uncertain operation.',
          );
        if (!['queued', 'running', 'cancelling'].includes(current.state)) return current;
        return this.update(id, { state: 'cancelling', cancelRequested: true });
      })
      .immediate();
    if (operation.state !== 'cancelling') return operation;
    this.pending.get(id)?.controller.abort();
    await this.pending.get(id)?.promise;
    return this.get(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.pending.values()) job.controller.abort();
    await Promise.allSettled([...this.pending.values()].map((job) => job.promise));
  }
}
const managers = new WeakMap<Store, BackupJobs>();
export function backupJobs(
  store: Store,
  factory: BackupTransportFactory = defaultBackupTransport,
): BackupJobs {
  let manager = managers.get(store);
  if (!manager || manager.closed) {
    manager = new BackupJobs(store, factory);
    managers.set(store, manager);
  }
  return manager;
}
export async function closeBackupJobs(store: Store): Promise<void> {
  await managers.get(store)?.close();
}
