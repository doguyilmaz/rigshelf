import { useId } from 'react';
import type { Entry } from '../src/core/model';
import { formatDate } from './api';
import { t } from './i18n';
import { Select } from './Select';

type Metadata = Omit<Entry, 'body'>;
export function KitSnapshotChoice({
  entry,
  entries,
  onChoose,
}: {
  entry: Metadata;
  entries: Metadata[];
  onChoose: (entry: Metadata) => void;
}) {
  const id = useId();
  const versions = entries
    .filter(
      (candidate) =>
        candidate.kind === entry.kind &&
        candidate.name === entry.name &&
        candidate.sourceId === entry.sourceId &&
        (!candidate.archived || candidate.id === entry.id),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (versions.length < 2) return null;
  return (
    <div className="kit-snapshot-choice">
      <label className="field-label" htmlFor={id}>
        {t('Snapshot for {{name}}', { name: entry.name })}
      </label>
      <Select
        id={id}
        label={t('Snapshot for {{name}}', { name: entry.name })}
        value={entry.id}
        options={versions.map((version) => ({
          value: version.id,
          label: `${version.digest.slice(0, 10)} · ${formatDate(version.updatedAt)}`,
        }))}
        onValueChange={(value) => {
          const chosen = versions.find((version) => version.id === value);
          if (chosen && chosen.id !== entry.id) onChoose(chosen);
        }}
      />
      <small>
        {t(
          'Choose a saved Snapshot, then Review setup to inspect the file differences. No project files change here.',
        )}
      </small>
    </div>
  );
}
