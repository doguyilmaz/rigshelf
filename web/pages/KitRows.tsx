import { Check } from 'lucide-react';
import type { Entry } from '../../src/core/model';
import { Badge } from '../components';
import { t } from '../i18n';

export function KitRow({
  entry,
  selected,
  toggle,
  inspect,
  reason,
}: {
  entry: Omit<Entry, 'body'>;
  selected: boolean;
  toggle: () => void;
  inspect: () => void;
  reason?: string;
}) {
  const flagged = entry.findings.some((finding) => finding.level !== 'info');
  return (
    <div className={`kit-entry ${selected ? 'selected' : ''}`}>
      <button type="button" className="capability-row" onClick={toggle} aria-pressed={selected}>
        <span className="checkbox">{selected && <Check size={12} />}</span>
        <div>
          <strong>{entry.name}</strong>
          <span>{reason || entry.description.slice(0, 140)}</span>
        </div>
        {flagged && (
          <Badge
            tone={entry.findings.some((finding) => finding.level === 'block') ? 'red' : 'amber'}
          >
            {t('Review')}
          </Badge>
        )}
        <Badge>{entry.kind === 'skill' ? 'Skill' : 'MCP'}</Badge>
      </button>
      <button
        type="button"
        className="inline-button kit-inspect"
        onClick={inspect}
        aria-label={t('Inspect {{name}}', { name: entry.name })}
      >
        {t('Inspect')}
      </button>
    </div>
  );
}
