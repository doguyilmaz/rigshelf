import { Download } from 'lucide-react';
import { useState } from 'react';
import type { BackupReview } from '../src/core/backup-review';
import { accessToken, api } from './api';
import { Button, Modal, Notice, Spinner } from './components';
import { t } from './i18n';
import { ModalPresence } from './ModalPresence';

const CHANGE_PAGE_SIZE = 50;
export function BackupReviewPanel({
  disabled,
  onDownload,
  notify,
}: {
  disabled: boolean;
  onDownload: (expected: string) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [review, setReview] = useState<BackupReview>();
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  async function prepare(file?: File): Promise<void> {
    setBusy(true);
    try {
      if (file && file.size > 128 * 1024 * 1024)
        throw new Error(t('Compressed import exceeds 128 MiB. Use the CLI for larger libraries.'));
      let next: BackupReview;
      if (file) {
        const response = await fetch('/api/backup-review', {
          method: 'POST',
          headers: { 'x-kitfold-token': accessToken(), 'content-type': 'application/gzip' },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        next = result;
      } else next = await api('backup-review', 'POST', {});
      setPage(0);
      setReview(next);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" disabled={disabled || busy} onClick={() => void prepare()}>
        {busy ? (
          <Spinner />
        ) : (
          <>
            <Download size={14} />
            {t('Review backup')}
          </>
        )}
      </Button>
      <ModalPresence>
        {review && (
          <Modal
            title={t('Review backup')}
            closeDisabled={busy || disabled}
            onClose={() => setReview(undefined)}
            subtitle={t(
              'One portable archive. No project files, credentials or automation permissions.',
            )}
          >
            <Notice>
              {t(
                'This is a local export review. GitHub and S3 sync are not connected; downloading does not confirm a remote backup.',
              )}
            </Notice>
            <label className="backup-baseline">
              {t('Compare with a previous export')}
              <input
                type="file"
                accept=".gz,application/gzip"
                disabled={busy || disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void prepare(file);
                  event.target.value = '';
                }}
              />
            </label>
            <p>
              {review.compared
                ? t('Changes since the selected export')
                : t(
                    'All records in this export. Select an earlier .json.gz export to see only changes.',
                  )}
            </p>
            <p role="status">
              {t(
                '{{added}} added · {{changed}} changed · {{removed}} removed · {{unchanged}} unchanged',
                review.counts,
              )}
            </p>
            <div className="backup-change-list">
              {review.changes
                .slice(page * CHANGE_PAGE_SIZE, (page + 1) * CHANGE_PAGE_SIZE)
                .map((change) => (
                  <div className="backup-change" key={change.id}>
                    <span>
                      {t(
                        change.action === 'added'
                          ? 'Added'
                          : change.action === 'changed'
                            ? 'Changed'
                            : 'Removed',
                      )}
                    </span>
                    <strong title={change.name} translate="no">
                      {change.name}
                    </strong>
                    <code translate="no">{change.kind}</code>
                  </div>
                ))}
            </div>
            {review.changes.length > CHANGE_PAGE_SIZE && (
              <div className="button-row">
                <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  {t('Previous')}
                </Button>
                <span>
                  {page + 1} / {Math.ceil(review.changes.length / CHANGE_PAGE_SIZE)}
                </span>
                <Button
                  variant="secondary"
                  disabled={(page + 1) * CHANGE_PAGE_SIZE >= review.changes.length}
                  onClick={() => setPage(page + 1)}
                >
                  {t('Next')}
                </Button>
              </div>
            )}
            {review.excluded.length > 0 && (
              <Notice tone="warning">
                <strong>{t('Excluded from this archive')}</strong>
                {review.excluded.map((item) => (
                  <p key={item.id}>
                    {item.name}: {item.reason}
                  </p>
                ))}
              </Notice>
            )}
            <div className="modal-actions">
              <Button
                variant="secondary"
                disabled={disabled || busy}
                onClick={() => void prepare()}
              >
                {t('Refresh review')}
              </Button>
              <Button
                disabled={disabled || busy}
                onClick={() => void onDownload(review.fingerprint)}
              >
                {disabled ? <Spinner /> : t('Download reviewed archive')}
              </Button>
            </div>
          </Modal>
        )}
      </ModalPresence>
    </>
  );
}
