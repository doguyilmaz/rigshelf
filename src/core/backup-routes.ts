import { z } from 'zod';
import {
  backupOperationView,
  closeBackupPullRequest,
  mergeBackup,
  prepareBackupMerge,
  refreshBackupOperation,
} from './backup-actions';
import { BackupDigest } from './backup-artifacts';
import { BackupDestinationSchema } from './backup-destinations';
import { backupJobs } from './backup-jobs';
import {
  BackupSaveRequest,
  listBackupDestinations,
  prepareRemoteBackup,
  removeBackupDestination,
  saveBackupDestination,
  testBackupDestination,
} from './backup-manager';
import {
  backupHistory,
  inspectBackupChange,
  prepareBackupRestore,
  RestoreMode,
  restoreBackup,
} from './backup-restore';
import { type BackupOperation, savedBackupReview } from './backup-state';
import type { BackupTransportFactory } from './backup-transport';
import type { Store } from './store';

const Empty = z.object({}).strict();
const Identifier = z.string().uuid();
export async function backupRoute(
  store: Store,
  method: string,
  segments: string[],
  input: unknown,
  options: { backupTransport?: BackupTransportFactory; signal?: AbortSignal },
): Promise<unknown> {
  const [resource, id, action] = segments;
  const factory = options.backupTransport;
  const signal = options.signal;
  if (resource === 'backup-destinations') {
    if (method === 'GET' && !id)
      return listBackupDestinations(store).map((value) => ({
        ...value,
        pending: value.pending ? backupOperationView(value.pending) : undefined,
        latest: value.latest ? backupOperationView(value.latest) : undefined,
      }));
    if (method === 'POST' && !id) {
      const value = BackupSaveRequest.parse(input);
      return saveBackupDestination(store, value.value, value.expected);
    }
    if (!id) throw new Error('Choose a backup destination.');
    if (method === 'DELETE' && !action) {
      const value = z.object({ expected: BackupDestinationSchema }).strict().parse(input);
      removeBackupDestination(store, id, value.expected);
      return { removed: true };
    }
    if (method === 'POST' && action === 'test') {
      Empty.parse(input);
      return testBackupDestination(store, id, factory, signal);
    }
    if (method === 'POST' && action === 'review') {
      Empty.parse(input);
      return prepareRemoteBackup(store, id, factory, signal);
    }
    if (method === 'POST' && action === 'history') {
      const value = z
        .object({
          cursor: BackupDigest.optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .strict()
        .parse(input);
      return backupHistory(store, id, value, factory, signal);
    }
    if (method === 'POST' && action === 'restore-review') {
      const value = z
        .object({ digest: BackupDigest, mode: RestoreMode.default('missing') })
        .strict()
        .parse(input);
      return prepareBackupRestore(store, id, value.digest, value.mode, factory, signal);
    }
    if (method === 'POST' && action === 'inspect') {
      const value = z
        .object({
          manifestDigest: BackupDigest.optional(),
          recordId: z.string().min(1).max(220),
          localFingerprint: BackupDigest,
        })
        .strict()
        .parse(input);
      return inspectBackupChange(store, { ...value, destinationId: id }, factory, signal);
    }
  }
  if (resource === 'backup-reviews' && id) {
    Identifier.parse(id);
    if (method === 'GET' && !action) return savedBackupReview(store, id);
    if (method === 'POST' && action === 'sync') {
      Empty.parse(input);
      return backupOperationView(backupJobs(store, factory).start(id));
    }
  }
  if (resource === 'backup-operations') {
    if (method === 'GET' && !id)
      return store
        .list<BackupOperation>('backup-operation')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 30)
        .map(backupOperationView);
    if (id) {
      Identifier.parse(id);
      if (method === 'GET' && !action)
        return backupOperationView(backupJobs(store, factory).get(id));
      if (method === 'POST' && action === 'retry') {
        const value = z
          .object({ acknowledgeFrozen: z.literal(true) })
          .strict()
          .parse(input);
        return backupOperationView(backupJobs(store, factory).retry(id, value.acknowledgeFrozen));
      }
      if (method === 'POST') {
        Empty.parse(input);
        if (action === 'status')
          return backupOperationView(await refreshBackupOperation(store, id, factory, signal));
        if (action === 'cancel')
          return backupOperationView(await backupJobs(store, factory).cancel(id));
        if (action === 'merge-review') return prepareBackupMerge(store, id, factory, signal);
        if (action === 'close-pr')
          return backupOperationView(await closeBackupPullRequest(store, id, factory));
      }
    }
  }
  if (resource === 'backup-merge-reviews' && id && method === 'POST' && action === 'apply') {
    Identifier.parse(id);
    Empty.parse(input);
    return backupOperationView(await mergeBackup(store, id, factory));
  }
  if (resource === 'backup-restore-reviews' && id && method === 'POST' && action === 'apply') {
    Identifier.parse(id);
    Empty.parse(input);
    return restoreBackup(store, id, factory, signal);
  }
  throw new Error('Unknown backup operation.');
}
