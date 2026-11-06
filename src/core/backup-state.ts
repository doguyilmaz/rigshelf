import type { BackupPointer } from './backup-artifacts';
import type { BackupReview } from './backup-review';
import type { BackupPullRequest } from './backup-transport';
import type { Store } from './store';

export const BACKUP_REVIEW_LIFETIME_MS = 30 * 60 * 1000;
export const BACKUP_OPERATION_TIMEOUT_MS = 3 * 60 * 1000;
export type BackupOperationState =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'awaiting-merge'
  | 'published'
  | 'noop'
  | 'conflict'
  | 'failed'
  | 'uncertain'
  | 'cancelled';
export interface SavedBackupReview extends BackupReview {
  id: string;
  destinationId: string;
  destinationFingerprint: string;
  destinationIdentity: string;
  destinationLabel: string;
  createdAt: string;
  expiresAt: string;
  remote: {
    revision: string | null;
    pointer: BackupPointer | null;
    tree?: string;
    repositoryId?: number;
  };
  manifestDigest: string;
  archiveDigest: string;
  archiveBytes: number;
  manifestBytes: number;
}
export interface BackupOperation {
  sequence: number;
  id: string;
  reviewId: string;
  destinationId: string;
  destinationFingerprint: string;
  destinationIdentity: string;
  destinationLabel: string;
  fingerprint: string;
  manifestDigest: string;
  archiveDigest: string;
  archiveBytes: number;
  createdAt: string;
  updatedAt: string;
  state: BackupOperationState;
  phase: string;
  ownerPid: number;
  ownerSession: string;
  expectedRevision: string | null;
  revision?: string;
  branch?: string;
  commit?: string;
  pullRequest?: BackupPullRequest;
  error?: string;
  warnings?: string[];
  cancelRequested?: boolean;
}
export const unfinishedBackupStates: BackupOperationState[] = [
  'queued',
  'running',
  'cancelling',
  'awaiting-merge',
  'uncertain',
];
export function backupOperation(store: Store, id: string): BackupOperation {
  const operation = store.get<BackupOperation>('backup-operation', id);
  if (!operation) throw new Error('Backup operation not found.');
  return operation;
}
export function savedBackupReview(store: Store, id: string): SavedBackupReview {
  const review = store.get<SavedBackupReview>('backup-review', id);
  if (!review) throw new Error('Backup review not found. Prepare a new review.');
  return review;
}
export function pendingBackup(store: Store, identity: string): BackupOperation | undefined {
  return store
    .list<BackupOperation>('backup-operation')
    .find(
      (operation) =>
        operation.destinationIdentity === identity &&
        unfinishedBackupStates.includes(operation.state),
    );
}
