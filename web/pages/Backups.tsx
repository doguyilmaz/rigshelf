import { ArrowLeft, CloudUpload, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { prepareBackupMerge } from '../../src/core/backup-actions';
import type { BackupDestination } from '../../src/core/backup-destinations';
import type { listBackupDestinations } from '../../src/core/backup-manager';
import type { backupHistory, prepareBackupRestore } from '../../src/core/backup-restore';
import type { SavedBackupReview } from '../../src/core/backup-state';
import { api, formatDate } from '../api';
import { BackupChangeReview } from '../BackupChangeReview';
import { BackupDestinationEditor } from '../BackupDestinationEditor';
import {
  BackupOperationCard,
  type BackupOperationView,
  backupRunning,
} from '../BackupOperationCard';
import { Badge, Button, Empty, Modal, Notice, PageHeader, Spinner } from '../components';
import { FileScrollArea } from '../FileWorkspace';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';

type DestinationRow = Omit<
  ReturnType<typeof listBackupDestinations>[number],
  'pending' | 'latest'
> & { pending?: BackupOperationView; latest?: BackupOperationView };
type History = Awaited<ReturnType<typeof backupHistory>>;
type RestoreReview = Awaited<ReturnType<typeof prepareBackupRestore>>;
type MergeReview = Awaited<ReturnType<typeof prepareBackupMerge>>;
type Review =
  | { kind: 'sync'; value: SavedBackupReview }
  | { kind: 'restore'; value: RestoreReview }
  | { kind: 'merge'; value: MergeReview };
export function Backups({ notify, navigate, refresh }: PageProps) {
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<BackupDestination | 'new'>();
  const [review, setReview] = useState<Review>();
  const [history, setHistory] = useState<History>();
  const [restoreDefinitions, setRestoreDefinitions] = useState(false);
  const [confirmation, setConfirmation] = useState<'remove' | 'close-pr'>();
  const [inspection, setInspection] = useState<{
    before: string;
    after: string;
    truncated: boolean;
  }>();
  const mounted = useRef(true);
  const controller = useRef<AbortController>(undefined);
  const selected =
    destinations.find((value) => value.destination.id === selectedId) || destinations[0];
  const operation = selected?.pending || selected?.latest;
  const reload = useCallback(async (signal?: AbortSignal) => {
    const values = await api<DestinationRow[]>('backup-destinations', 'GET', undefined, signal);
    if (mounted.current) setDestinations(values);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void reload(abort.signal)
      .catch((failure) => {
        if (!abort.signal.aborted) setError((failure as Error).message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      abort.abort();
      controller.current?.abort();
    };
  }, [reload]);
  useEffect(() => {
    if (!operation || !backupRunning(operation)) return;
    const abort = new AbortController();
    const timer = setInterval(() => void reload(abort.signal).catch(() => undefined), 1000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [operation, reload]);
  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      await task(abort.signal);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function action(
    action: 'status' | 'cancel' | 'retry' | 'merge-review' | 'close-pr',
    signal: AbortSignal,
  ) {
    if (!operation) return;
    if (action === 'close-pr') {
      setConfirmation('close-pr');
      return;
    }
    if (action === 'merge-review') {
      setReview({
        kind: 'merge',
        value: await api(`backup-operations/${operation.id}/merge-review`, 'POST', {}, signal),
      });
      return;
    }
    await api(
      `backup-operations/${operation.id}/${action}`,
      'POST',
      action === 'retry' ? { acknowledgeFrozen: true } : {},
      signal,
    );
    await reload(signal);
  }
  async function applyReview(signal: AbortSignal) {
    if (!review) return;
    if (review.kind === 'sync')
      await api(`backup-reviews/${review.value.id}/sync`, 'POST', {}, signal);
    if (review.kind === 'restore') {
      await api(`backup-restore-reviews/${review.value.id}/apply`, 'POST', {}, signal);
      await refresh();
      notify(t('Backup restored to your library. No project files or permissions were changed.'));
    }
    if (review.kind === 'merge')
      await api(`backup-merge-reviews/${review.value.id}/apply`, 'POST', {}, signal);
    setReview(undefined);
    setInspection(undefined);
    await reload(signal);
  }
  async function inspect(recordId: string, signal: AbortSignal) {
    if (!review || review.kind === 'merge' || !selected) return;
    const value = review.value;
    const digest =
      review.kind === 'sync'
        ? review.value.remote.pointer?.manifestDigest
        : review.value.manifestDigest;
    const comparison = await api<{ before: string; after: string; truncated: boolean }>(
      `backup-destinations/${selected.destination.id}/inspect`,
      'POST',
      {
        recordId,
        manifestDigest: digest,
        localFingerprint:
          review.kind === 'sync' ? value.fingerprint : review.value.localFingerprint,
      },
      signal,
    );
    setInspection(
      review.kind === 'restore'
        ? { ...comparison, before: comparison.after, after: comparison.before }
        : comparison,
    );
  }
  const ready = selected && !selected.missingCredentials.length;
  return (
    <div className="backups-page">
      <PageHeader
        eyebrow={t('PRIVATE LIBRARY')}
        title={t('Backups')}
        description={t('Review changes, save one Snapshot, restore when you need it.')}
        action={
          <Button variant="secondary" onClick={() => navigate('settings')}>
            <ArrowLeft size={14} />
            {t('Settings')}
          </Button>
        }
      />
      <Notice>
        {t(
          'Backups include portable Skills, MCP, Plugins, sources, Presets and directives. Project files, sessions, credentials and permissions stay out.',
        )}
      </Notice>
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      <div className="backup-section-head">
        <h2>{t('Your destinations')}</h2>
        <Button disabled={busy} onClick={() => setEditor('new')}>
          <Plus size={14} />
          {t('Add destination')}
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : !destinations.length ? (
        <Empty
          title={t('Keep a copy of your library')}
          text={t(
            'Connect an existing private GitHub repository or S3-compatible bucket. You decide when to Sync.',
          )}
        >
          <Button onClick={() => setEditor('new')}>{t('Connect a destination')}</Button>
        </Empty>
      ) : (
        <div className="backup-layout">
          <nav className="backup-destinations" aria-label={t('Backup destinations')}>
            {destinations.map((value) => (
              <button
                key={value.destination.id}
                type="button"
                disabled={busy}
                aria-pressed={selected?.destination.id === value.destination.id}
                onClick={() => {
                  setSelectedId(value.destination.id);
                  setHistory(undefined);
                  setError('');
                }}
              >
                <CloudUpload size={18} />
                <span>
                  <strong>{value.destination.name}</strong>
                  <small>
                    {value.destination.kind === 'github'
                      ? 'GitHub'
                      : value.destination.service === 'r2'
                        ? 'Cloudflare R2'
                        : 'S3-compatible'}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          {selected && (
            <div className="backup-detail">
              <div className="backup-section-head">
                <div>
                  <h2>{selected.destination.name}</h2>
                  <p className="backup-location" translate="no">
                    {selected.label}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditor(selected.destination)}
                >
                  {t('Edit connection')}
                </Button>
              </div>
              {!!selected.missingCredentials.length && (
                <Notice tone="warning">
                  <strong>{t('Credentials are not configured in this server')}</strong>
                  <p>
                    {t(
                      'Set these environment variables, restart Rigshelf, then test the connection:',
                    )}
                  </p>
                  {selected.missingCredentials.map((value) => (
                    <code className="backup-env" translate="no" key={value}>
                      {value}
                    </code>
                  ))}
                </Notice>
              )}
              <div className="button-row">
                <Button
                  disabled={busy || !ready || !!selected.pending}
                  onClick={() =>
                    void run(async (signal) => {
                      setReview({
                        kind: 'sync',
                        value: await api(
                          `backup-destinations/${selected.destination.id}/review`,
                          'POST',
                          {},
                          signal,
                        ),
                      });
                    })
                  }
                >
                  {busy ? <Spinner /> : t('Review changes before Sync')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !ready}
                  onClick={() =>
                    void run(async (signal) => {
                      await api(
                        `backup-destinations/${selected.destination.id}/test`,
                        'POST',
                        {},
                        signal,
                      );
                      notify(t('Connection test passed. No library archive was sent.'));
                    })
                  }
                >
                  {t('Test connection')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !ready}
                  onClick={() =>
                    void run(async (signal) => {
                      setHistory(
                        await api(
                          `backup-destinations/${selected.destination.id}/history`,
                          'POST',
                          {},
                          signal,
                        ),
                      );
                    })
                  }
                >
                  {t('Backup history')}
                </Button>
              </div>
              {selected.pending && (
                <p className="muted">
                  {t(
                    'Resolve the unfinished operation before starting another Sync to this destination.',
                  )}
                </p>
              )}
              {operation ? (
                <BackupOperationCard
                  key={operation.id}
                  operation={operation}
                  busy={busy}
                  onAction={(value) => void run((signal) => action(value, signal))}
                />
              ) : (
                <p className="muted">
                  {t('No completed backup yet. Review changes, then choose Sync.')}
                </p>
              )}
              {history && (
                <section className="backup-history">
                  <h3>{t('Restore from a verified Snapshot')}</h3>
                  <p>
                    {t(
                      'Restore adds missing library records. It never activates tools in projects.',
                    )}
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={restoreDefinitions}
                      onChange={(event) => setRestoreDefinitions(event.target.checked)}
                    />
                    <span>
                      {t('Also review replacements for existing Presets and directives.')}
                    </span>
                  </label>
                  {!history.snapshots.length && (
                    <p>{t('This destination has no published backup yet.')}</p>
                  )}
                  {history.snapshots.map((snapshot) => (
                    <div className="backup-history-row" key={snapshot.digest}>
                      <span>
                        <strong>{formatDate(snapshot.createdAt)}</strong>
                        <small>
                          {t('{{count}} records', { count: snapshot.records })} ·{' '}
                          {(snapshot.archiveBytes / 1024).toFixed(1)} KiB
                        </small>
                      </span>
                      <Badge>{snapshot.digest.slice(0, 10)}</Badge>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (signal) => {
                            setReview({
                              kind: 'restore',
                              value: await api(
                                `backup-destinations/${selected.destination.id}/restore-review`,
                                'POST',
                                {
                                  digest: snapshot.digest,
                                  mode: restoreDefinitions ? 'definitions' : 'missing',
                                },
                                signal,
                              ),
                            });
                          })
                        }
                      >
                        {t('Review restore')}
                      </Button>
                    </div>
                  ))}
                  {history.nextCursor && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async (signal) => {
                          const next = await api<History>(
                            `backup-destinations/${selected.destination.id}/history`,
                            'POST',
                            { cursor: history.nextCursor },
                            signal,
                          );
                          setHistory({
                            ...next,
                            snapshots: [...history.snapshots, ...next.snapshots],
                          });
                        })
                      }
                    >
                      {t('Load older Snapshots')}
                    </Button>
                  )}
                </section>
              )}
              <details className="backup-disconnect">
                <summary>{t('Remove connection')}</summary>
                <p>
                  {t(
                    'This removes the local connection only. Remote archives and local receipts are kept.',
                  )}
                </p>
                <Button
                  variant="danger"
                  disabled={busy || !!selected.pending}
                  onClick={() => setConfirmation('remove')}
                >
                  {t('Remove connection')}
                </Button>
              </details>
            </div>
          )}
        </div>
      )}
      <ModalPresence>
        {editor && (
          <BackupDestinationEditor
            initial={editor === 'new' ? undefined : editor}
            onClose={() => setEditor(undefined)}
            onSave={async (destination) => {
              await reload();
              setSelectedId(destination.id);
              setHistory(undefined);
            }}
          />
        )}
      </ModalPresence>
      <ModalPresence>
        {review && (
          <Modal
            wide
            title={t(
              review.kind === 'sync'
                ? 'Review Sync'
                : review.kind === 'restore'
                  ? 'Review restore'
                  : 'Review PR merge',
            )}
            onClose={() => {
              setReview(undefined);
              setInspection(undefined);
            }}
            closeDisabled={busy}
            className="backup-review-modal"
            subtitle={selected?.label}
          >
            {inspection ? (
              <>
                <Button variant="secondary" onClick={() => setInspection(undefined)}>
                  <ArrowLeft size={14} />
                  {t('Back to changes')}
                </Button>
                <div className="backup-diff">
                  <section>
                    <h3>{t('Before')}</h3>
                    <FileScrollArea label={t('Content before')} className="backup-diff-content">
                      <pre>{inspection.before || t('No record')}</pre>
                    </FileScrollArea>
                  </section>
                  <section>
                    <h3>{t('After')}</h3>
                    <FileScrollArea label={t('Content after')} className="backup-diff-content">
                      <pre>{inspection.after || t('No record')}</pre>
                    </FileScrollArea>
                  </section>
                </div>
                {inspection.truncated && (
                  <p>
                    {t(
                      'Preview limited to 25,000 characters per side. Supporting files are listed by path, size and executable intent.',
                    )}
                  </p>
                )}
              </>
            ) : (
              <>
                {review.kind === 'merge' ? (
                  <>
                    <Notice>
                      {t(
                        'Merge the reviewed backup PR into its target branch. GitHub protection rules still apply.',
                      )}
                    </Notice>
                    <p>PR #{review.value.request.number}</p>
                    <code>{review.value.request.head}</code>
                    {review.value.localChanged && (
                      <Notice tone="warning">
                        {t(
                          'Your library changed since this Snapshot was prepared. This merge backs up the frozen Snapshot, not those newer changes.',
                        )}
                      </Notice>
                    )}
                  </>
                ) : (
                  <>
                    <Notice>
                      {review.kind === 'sync'
                        ? t(
                            'Sync sends one archive and a readable manifest to the destination shown above. GitHub creates a PR; S3 publishes only if the remote pointer is unchanged.',
                          )
                        : t(
                            'Existing Skills and source metadata are kept. Local-only records are never removed. No project files or permissions will be restored.',
                          )}
                    </Notice>
                    {review.kind === 'restore' && (
                      <p>{t('{{count}} existing records kept', { count: review.value.kept })}</p>
                    )}
                    <BackupChangeReview
                      key={review.value.id}
                      review={{
                        ...review.value,
                        excluded: review.value.excluded,
                      }}
                      onInspect={(id) => void run((signal) => inspect(id, signal))}
                    />
                    {review.kind === 'restore' && !!review.value.import.conflicts.length && (
                      <Notice tone="warning">
                        <strong>{t('Resolve these conflicts before restoring:')}</strong>
                        {review.value.import.conflicts.map((value) => (
                          <p key={value}>{value}</p>
                        ))}
                      </Notice>
                    )}
                  </>
                )}
                <div className="modal-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => setReview(undefined)}>
                    {t('Cancel')}
                  </Button>
                  <Button
                    disabled={
                      busy || (review.kind === 'restore' && !!review.value.import.conflicts.length)
                    }
                    onClick={() => void run(applyReview)}
                  >
                    {busy ? (
                      <Spinner />
                    ) : (
                      t(
                        review.kind === 'sync'
                          ? 'Sync reviewed Snapshot'
                          : review.kind === 'restore'
                            ? 'Restore reviewed records'
                            : 'Merge reviewed PR',
                      )
                    )}
                  </Button>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="backup-error">
                {error}
              </p>
            )}
          </Modal>
        )}
      </ModalPresence>
      <ModalPresence>
        {confirmation && selected && (
          <Modal
            title={t(confirmation === 'remove' ? 'Remove connection' : 'Close backup PR')}
            closeDisabled={busy}
            onClose={() => setConfirmation(undefined)}
          >
            <p>
              {confirmation === 'remove'
                ? t('Remote archives and local receipts will remain.')
                : t(
                    'Close this unchanged backup PR without merging. Its branch and immutable objects are retained on GitHub.',
                  )}
            </p>
            <div className="modal-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmation(undefined)}
              >
                {t('Cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    if (confirmation === 'remove')
                      await api(
                        `backup-destinations/${selected.destination.id}`,
                        'DELETE',
                        { expected: selected.destination },
                        signal,
                      );
                    else if (operation)
                      await api(`backup-operations/${operation.id}/close-pr`, 'POST', {}, signal);
                    setConfirmation(undefined);
                    setHistory(undefined);
                    await reload(signal);
                  })
                }
              >
                {busy ? <Spinner /> : t('Confirm')}
              </Button>
            </div>
            {error && (
              <p role="alert" className="backup-error">
                {error}
              </p>
            )}
          </Modal>
        )}
      </ModalPresence>
    </div>
  );
}
