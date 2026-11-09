import type { BackupArtifact, BackupManifest, BackupPointer } from './backup-artifacts';
import type { BackupDestination } from './backup-destinations';

export interface RemoteBackupState {
  revision: string | null;
  pointer: BackupPointer | null;
  manifest: BackupManifest | null;
  tree?: string;
  repositoryId?: number;
}
export interface BackupPullRequest {
  number: number;
  url: string;
  head: string;
  base: string;
  state: 'open' | 'closed';
  merged: boolean;
}
export interface BackupPublication {
  state: 'published' | 'awaiting-merge';
  revision: string;
  pullRequest?: BackupPullRequest;
}
export interface BackupCheckpoint {
  phase?: string;
  branch?: string;
  commit?: string;
  pullRequest?: BackupPullRequest;
}
export interface BackupPublishContext {
  id: string;
  signal: AbortSignal;
  checkpoint: (value: BackupCheckpoint) => void;
  assertCurrent: () => void;
  previous?: BackupCheckpoint;
}
export interface BackupTransport {
  readCurrent(signal?: AbortSignal): Promise<RemoteBackupState>;
  readManifest(digest: string, signal?: AbortSignal): Promise<BackupManifest>;
  readArchive(digest: string, signal?: AbortSignal): Promise<Uint8Array>;
  probe(signal?: AbortSignal): Promise<void>;
  publish(
    artifact: BackupArtifact,
    expected: RemoteBackupState,
    context: BackupPublishContext,
  ): Promise<BackupPublication>;
  pullRequest?(number: number, signal?: AbortSignal): Promise<BackupPullRequest>;
  operationPullRequest?(id: string, signal?: AbortSignal): Promise<BackupPullRequest | undefined>;
  merge?(request: BackupPullRequest, signal?: AbortSignal): Promise<void>;
  closePullRequest?(request: BackupPullRequest, signal?: AbortSignal): Promise<void>;
}
export type BackupTransportFactory = (destination: BackupDestination) => BackupTransport;
