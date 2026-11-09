import { useState } from 'react';
import type { backupOperationView } from '../src/core/backup-actions';
import { formatDate } from './api';
import { Badge, Button, ExternalLink, Notice, Spinner } from './components';
import { t } from './i18n';

export type BackupOperationView = ReturnType<typeof backupOperationView>;
const statusLabels = {
  queued: 'Queued',
  running: 'Syncing',
  cancelling: 'Cancelling',
  published: 'Backup verified',
  noop: 'Already backed up',
  'awaiting-merge': 'Waiting for PR merge',
  conflict: 'Review required',
  failed: 'Sync failed',
  uncertain: 'Outcome needs confirmation',
  cancelled: 'Cancelled',
} as const;
export const backupRunning = (value: BackupOperationView) =>
  ['queued', 'running', 'cancelling'].includes(value.state);
export function BackupOperationCard({
  operation,
  busy,
  onAction,
}: {
  operation: BackupOperationView;
  busy: boolean;
  onAction: (action: 'status' | 'cancel' | 'retry' | 'merge-review' | 'close-pr') => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const retryable = ['failed', 'conflict', 'uncertain'].includes(operation.state);
  return (
    <section className="backup-operation" aria-label={t('Latest backup operation')}>
      <div className="backup-section-head">
        <h3>{t(statusLabels[operation.state])}</h3>
        <Badge>{formatDate(operation.updatedAt)}</Badge>
      </div>
      {backupRunning(operation) && (
        <Spinner text={t('Keep working; Sync continues in this server.')} />
      )}
      {operation.state === 'awaiting-merge' && (
        <p>
          {t(
            'The reviewed Snapshot is in a PR. It becomes a completed backup after merge and verification.',
          )}
        </p>
      )}
      {operation.error && <Notice tone="warning">{operation.error}</Notice>}
      {operation.warnings?.map((warning) => (
        <p key={warning} className="muted">
          {warning}
        </p>
      ))}
      <p className="backup-receipt">
        <span>{t('Snapshot')}</span>
        <code title={operation.manifestDigest}>{operation.manifestDigest.slice(0, 16)}</code>
        <span>{(operation.archiveBytes / 1024).toFixed(1)} KiB</span>
      </p>
      {operation.pullRequest && (
        <p>
          <ExternalLink href={operation.pullRequest.url}>
            {t('Open PR #{{number}}', { number: operation.pullRequest.number })}
          </ExternalLink>
        </p>
      )}
      {retryable && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            {t('Retry this frozen Snapshot, even if my library has changed since review.')}
          </span>
        </label>
      )}
      <div className="button-row">
        {!backupRunning(operation) && (
          <Button variant="secondary" disabled={busy} onClick={() => onAction('status')}>
            {t('Check remote status')}
          </Button>
        )}
        {backupRunning(operation) && (
          <Button
            variant="secondary"
            disabled={busy || operation.state === 'cancelling'}
            onClick={() => onAction('cancel')}
          >
            {t('Cancel Sync')}
          </Button>
        )}
        {retryable && (
          <Button disabled={busy || !acknowledged} onClick={() => onAction('retry')}>
            {t('Retry reviewed Snapshot')}
          </Button>
        )}
        {operation.state === 'awaiting-merge' && (
          <>
            <Button disabled={busy || !!operation.error} onClick={() => onAction('merge-review')}>
              {t('Review merge')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !!operation.error}
              onClick={() => onAction('close-pr')}
            >
              {t('Close backup PR')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
