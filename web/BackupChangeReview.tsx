import { useState } from 'react';
import type { BackupReview } from '../src/core/backup-review';
import { Button, Notice, SearchBox } from './components';
import { t } from './i18n';

const PAGE_SIZE = 30;
export function BackupChangeReview({
  review,
  onInspect,
}: {
  review: Pick<BackupReview, 'counts' | 'changes' | 'excluded'>;
  onInspect?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = review.changes.filter((value) =>
    `${value.name} ${value.kind}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <p role="status">
        {t(
          '{{added}} added · {{changed}} changed · {{removed}} removed · {{unchanged}} unchanged',
          review.counts,
        )}
      </p>
      <SearchBox
        value={query}
        onChange={(value) => {
          setQuery(value);
          setPage(0);
        }}
        label={t('Search backup changes')}
        placeholder={t('Search names or types…')}
      />
      <div className="backup-change-list">
        {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((change) => (
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
            {onInspect && (
              <Button
                variant="ghost"
                onClick={() => onInspect(change.id)}
                aria-label={t('Inspect {{name}}', { name: change.name })}
              >
                {t('Inspect')}
              </Button>
            )}
          </div>
        ))}
        {!filtered.length && <p className="muted">{t('No matching changes.')}</p>}
      </div>
      {filtered.length > PAGE_SIZE && (
        <div className="button-row">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('Previous')}
          </Button>
          <span>
            {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <Button
            variant="secondary"
            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      )}
      {!!review.excluded.length && (
        <Notice tone="warning">
          <details>
            <summary>
              {t('{{count}} records excluded from this archive', { count: review.excluded.length })}
            </summary>
            {review.excluded.map((value) => (
              <p key={value.id}>
                {value.name}: {value.reason}
              </p>
            ))}
          </details>
        </Notice>
      )}
    </>
  );
}
