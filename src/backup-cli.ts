import { z } from 'zod';
import { backupJobs, closeBackupJobs } from './core/backup-jobs';
import { readRecord } from './core/local-files';
import { route } from './core/service';
import type { Store } from './core/store';

export const backupHelp = `
Remote backups (credentials are selected RIGSHELF_BACKUP_* environment references):
  rigshelf backup list                         Saved private destinations; no remote requests
  rigshelf backup save destination.json [--expect previous.json]
  rigshelf backup remove <destination-id> --expect previous.json
  rigshelf backup test <destination-id>        Explicit connection/conditional-write probe
  rigshelf backup review <destination-id>      Compare with remote; returns a review ID
  rigshelf backup sync <review-id>             Publish that exact review; waits for completion
  rigshelf backup status <operation-id>        Reconcile remote publication / PR state
  rigshelf backup retry <operation-id> --acknowledge-frozen
  rigshelf backup cancel <operation-id>        Cancel a running local Sync
  rigshelf backup history <destination-id> [--cursor manifest-digest]
  rigshelf backup restore-review <destination-id> <manifest-digest> [--mode definitions]
  rigshelf backup restore <restore-review-id>  Apply the reviewed library restore
  rigshelf backup merge-review <operation-id> Review the unchanged GitHub backup PR
  rigshelf backup merge <merge-review-id>      Merge the reviewed PR; honors GitHub rules
  rigshelf backup close-pr <operation-id>     Close an unchanged backup PR without merging
GitHub creates one commit + PR, never commits per record. S3/R2 publishes conditionally.
Restore never changes project files, credentials or automation permissions.
`;
export async function runBackupCommand(
  store: Store,
  action: string | undefined,
  id: string | undefined,
  argument: string | undefined,
  options: { expect?: string; cursor?: string; mode?: string; 'acknowledge-frozen'?: boolean },
): Promise<unknown> {
  const required = () => {
    if (!id)
      throw new Error(`backup ${action} requires an identifier or file. Run rigshelf --help.`);
    return id;
  };
  const call = (resource: string, operation: string) =>
    route(store, 'POST', `${resource}/${required()}/${operation}`, {});
  try {
    if (action === 'list') return route(store, 'GET', 'backup-destinations', undefined);
    if (action === 'save')
      return route(store, 'POST', 'backup-destinations', {
        value: await readRecord(required()),
        expected: options.expect ? await readRecord(options.expect) : undefined,
      });
    if (action === 'remove') {
      if (!options.expect)
        throw new Error('Provide --expect previous.json to remove this exact saved connection.');
      return route(store, 'DELETE', `backup-destinations/${required()}`, {
        expected: await readRecord(options.expect),
      });
    }
    if (action === 'test' || action === 'review') return call('backup-destinations', action);
    if (action === 'history')
      return route(store, 'POST', `backup-destinations/${required()}/history`, {
        cursor: options.cursor,
      });
    if (action === 'restore-review') {
      if (!argument) throw new Error('Choose a manifest digest from backup history.');
      return route(store, 'POST', `backup-destinations/${required()}/restore-review`, {
        digest: argument,
        mode: options.mode || 'missing',
      });
    }
    if (action === 'restore') return call('backup-restore-reviews', 'apply');
    if (action === 'merge') return call('backup-merge-reviews', 'apply');
    if (
      action === 'status' ||
      action === 'cancel' ||
      action === 'merge-review' ||
      action === 'close-pr'
    )
      return call('backup-operations', action);
    if (action === 'sync' || action === 'retry') {
      z.string().uuid().parse(required());
      if (action === 'sync') await call('backup-reviews', 'sync');
      else
        await route(store, 'POST', `backup-operations/${required()}/retry`, {
          acknowledgeFrozen: options['acknowledge-frozen'] || false,
        });
      const { ownerPid, ownerSession, ...operation } = await backupJobs(store).wait(required());
      return operation;
    }
    throw new Error('Choose a backup command. Run rigshelf --help.');
  } finally {
    await closeBackupJobs(store);
  }
}
