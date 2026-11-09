import { ChevronRight, FolderOpen, Info, List } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { LibraryItem } from '../src/core/library';
import type { LibraryGrouping, LibrarySourceGroup } from '../src/core/library-groups';
import type { Source } from '../src/core/model';
import { Button } from './components';
import { countText, PAGE_SIZE } from './format';
import { getLocale, t } from './i18n';

export function LibraryGroupingControl({
  value,
  onChange,
}: {
  value: LibraryGrouping;
  onChange: (value: LibraryGrouping) => void;
}) {
  return (
    <fieldset className="library-grouping" aria-label={t('Item display')}>
      <button type="button" aria-pressed={value === 'source'} onClick={() => onChange('source')}>
        <FolderOpen size={14} aria-hidden="true" />
        {t('By source')}
      </button>
      <button type="button" aria-pressed={value === 'none'} onClick={() => onChange('none')}>
        <List size={14} aria-hidden="true" />
        {t('All items')}
      </button>
    </fieldset>
  );
}

interface SourceGroupsProps {
  groups: LibrarySourceGroup[];
  filterKey: string;
  filtered: boolean;
  renderItems: (items: LibraryItem[]) => ReactNode;
  onSource?: (source: Source) => void;
  selected?: string[];
}
export function SourceGroups({ groups, filterKey, ...props }: SourceGroupsProps) {
  return (
    <div className="library-source-groups">
      {groups.map((group) => (
        <SourceGroup key={JSON.stringify([group.key, filterKey])} group={group} {...props} />
      ))}
    </div>
  );
}

function sourceReference(source: Source | undefined): string {
  if (!source?.url) return '';
  try {
    const url = new URL(source.url);
    if (source.name === url.pathname.replace(/^\/|\/$/g, '') || source.name === source.url)
      return '';
    return url.hostname + url.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}
function SourceGroup({
  group,
  filtered,
  renderItems,
  onSource,
  selected = [],
}: Omit<SourceGroupsProps, 'groups' | 'filterKey'> & { group: LibrarySourceGroup }) {
  const [expanded, setExpanded] = useState(filtered || group.total === 1);
  const [page, setPage] = useState(0);
  const contentId = useId();
  const name = group.source?.name || t('Unknown source');
  const reference = sourceReference(group.source);
  const count = (value: number) => value.toLocaleString(getLocale());
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(group.items.length / PAGE_SIZE) - 1));
  const selectedCount = group.items.filter((item) =>
    item.versions.some((version) => selected.includes(version.id)),
  ).length;
  return (
    <section className="library-source-group" aria-label={t('Items from {{name}}', { name })}>
      <div className="library-source-heading">
        <button
          type="button"
          className="library-source-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight className="source-chevron" size={16} aria-hidden="true" />
          <span className="source-group-name">
            <strong title={name}>{name}</strong>
            {reference && reference !== name && <small title={reference}>{reference}</small>}
            {!group.source && <small title={group.sourceId}>{group.sourceId}</small>}
          </span>
          <span className="source-group-count">
            <span>
              {group.items.length === group.total
                ? countText(group.items.length, 'item')
                : t('{{count}} of {{total}} items', {
                    count: count(group.items.length),
                    total: count(group.total),
                  })}
            </span>
            {selectedCount > 0 && (
              <small>{t('{{count}} selected', { count: count(selectedCount) })}</small>
            )}
          </span>
        </button>
        {group.source && onSource && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('Source details: {{name}}', { name })}
            title={t('Source details')}
            onClick={() => group.source && onSource(group.source)}
          >
            <Info size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div id={contentId} hidden={!expanded} className="library-source-content">
        {expanded && (
          <>
            {renderItems(group.items.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE))}
            {group.items.length > PAGE_SIZE && (
              <div className="source-group-pagination">
                <span role="status">
                  {t('{{start}}–{{end}} of {{count}}', {
                    start: count(visiblePage * PAGE_SIZE + 1),
                    end: count(Math.min((visiblePage + 1) * PAGE_SIZE, group.items.length)),
                    count: count(group.items.length),
                  })}
                </span>
                <div className="button-row">
                  <Button
                    variant="ghost"
                    aria-label={t('Previous items in {{name}}', { name })}
                    disabled={visiblePage === 0}
                    onClick={() => setPage(visiblePage - 1)}
                  >
                    {t('Previous')}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={t('Next items in {{name}}', { name })}
                    disabled={(visiblePage + 1) * PAGE_SIZE >= group.items.length}
                    onClick={() => setPage(visiblePage + 1)}
                  >
                    {t('Next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
