import { useMemo, useState } from 'react';
import {
  defaultLibraryFilters,
  facetCounts,
  filterLibrary,
  type LibraryFilters,
  type LibraryItem,
  libraryItems,
} from '../../src/core/library';
import {
  type LibraryGrouping,
  librarySourceGroups,
  SOURCE_GROUP_PAGE_SIZE,
} from '../../src/core/library-groups';
import { platforms, technologies } from '../../src/core/taxonomy';
import { Button, Modal, Notice, SearchBox } from '../components';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { LibraryGroupingControl, SourceGroups } from '../SourceGroups';
import { KitRow } from './KitRows';

const PAGE_SIZE = 40;
export function SetupKitPicker({
  state,
  selected,
  toggle,
  inspect,
  onClose,
  openLibrary,
  acquire,
  initialKind = 'all',
}: {
  state: PageProps['state'];
  selected: string[];
  toggle: (id: string) => void;
  inspect: (id: string) => void;
  onClose: () => void;
  openLibrary: () => void;
  acquire: () => void;
  initialKind?: 'all' | 'skill' | 'mcp';
}) {
  const [filters, setFilters] = useState<LibraryFilters>(() => ({
    ...defaultLibraryFilters(),
    kind: initialKind,
  }));
  const [grouping, setGrouping] = useState<LibraryGrouping>('source');
  const [limit, setLimit] = useState(SOURCE_GROUP_PAGE_SIZE);
  const items = useMemo(
    () =>
      libraryItems(state, 'active').filter(
        (item) => item.entry.kind === 'skill' || item.entry.kind === 'mcp',
      ),
    [state],
  );
  const matches = filterLibrary(items, filters);
  const groups = librarySourceGroups(matches, items);
  const total = grouping === 'source' ? groups.length : matches.length;
  const platformCounts = facetCounts(items, filters, 'platforms');
  const technologyCounts = facetCounts(items, filters, 'technologies');
  const change = (values: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...values }));
    setLimit(grouping === 'source' ? SOURCE_GROUP_PAGE_SIZE : PAGE_SIZE);
  };
  const rows = (values: LibraryItem[]) =>
    values.map((item) => {
      const entry = item.versions.find((version) => selected.includes(version.id)) || item.entry;
      return (
        <KitRow
          key={item.key}
          entry={entry}
          selected={selected.includes(entry.id)}
          reason={[item.source?.name, entry.description].filter(Boolean).join(' · ')}
          toggle={() => toggle(entry.id)}
          inspect={() => inspect(entry.id)}
        />
      );
    });
  return (
    <Modal
      title={t('Add from library')}
      subtitle={t('Choose Skills and MCP servers for this project. Nothing is applied yet.')}
      onClose={onClose}
      wide
    >
      <div className="kit-picker-toolbar">
        <SearchBox
          value={filters.query}
          onChange={(query) => change({ query })}
          placeholder={t('Search skills and MCP servers…')}
          label={t('Search kit library')}
        />
        <div className="kit-picker-filters">
          <div>
            <label className="field-label" htmlFor="kit-type">
              {t('Type')}
            </label>
            <Select
              id="kit-type"
              label={t('Type')}
              value={filters.kind}
              onValueChange={(kind) => {
                if (kind === 'all' || kind === 'skill' || kind === 'mcp') change({ kind });
              }}
              options={[
                { value: 'all', label: t('All types') },
                { value: 'skill', label: 'Skills' },
                { value: 'mcp', label: 'MCP' },
              ]}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="kit-platform">
              {t('Platform')}
            </label>
            <Select
              id="kit-platform"
              label={t('Platform')}
              value={filters.platforms[0] || 'all'}
              onValueChange={(value) => change({ platforms: value === 'all' ? [] : [value] })}
              options={[
                { value: 'all', label: t('All platforms') },
                ...platforms
                  .filter(
                    (item) => platformCounts.has(item.id) || filters.platforms.includes(item.id),
                  )
                  .map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="kit-technology">
              {t('Technology')}
            </label>
            <Select
              id="kit-technology"
              label={t('Technology')}
              searchable
              value={filters.technologies[0] || 'all'}
              onValueChange={(value) => change({ technologies: value === 'all' ? [] : [value] })}
              options={[
                { value: 'all', label: t('All technologies') },
                ...technologies
                  .filter(
                    (item) =>
                      technologyCounts.has(item.id) || filters.technologies.includes(item.id),
                  )
                  .map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </div>
        </div>
      </div>
      <p className="field-help" role="status">
        {t('{{count}} matches · {{selected}} selected', {
          count: matches.length,
          selected: selected.length,
        })}
      </p>
      <LibraryGroupingControl
        value={grouping}
        onChange={(value) => {
          setGrouping(value);
          setLimit(value === 'source' ? SOURCE_GROUP_PAGE_SIZE : PAGE_SIZE);
        }}
      />
      <div className="kit-results">
        {grouping === 'source' ? (
          <SourceGroups
            groups={groups.slice(0, limit)}
            filterKey={JSON.stringify(filters)}
            filtered={Boolean(
              filters.query.trim() ||
                filters.kind !== 'all' ||
                filters.platforms.length ||
                filters.technologies.length,
            )}
            selected={selected}
            renderItems={rows}
          />
        ) : (
          rows(matches.slice(0, limit))
        )}
      </div>
      {!matches.length && (
        <Notice>
          {t('No matches. Try fewer filters or import a source in Library.')}{' '}
          <button
            type="button"
            className="inline-button"
            onClick={() => change({ ...defaultLibraryFilters(), kind: 'all' })}
          >
            {t('Clear filters')}
          </button>
        </Notice>
      )}
      {total > limit && (
        <Button
          variant="secondary"
          onClick={() =>
            setLimit(
              (current) => current + (grouping === 'source' ? SOURCE_GROUP_PAGE_SIZE : PAGE_SIZE),
            )
          }
        >
          {t('Show more')}
        </Button>
      )}
      <div className="modal-actions">
        <Button variant="ghost" onClick={openLibrary}>
          {t('Open full library')}
        </Button>
        <Button variant="secondary" onClick={acquire}>
          {t('Find more tools')}
        </Button>
        <Button onClick={onClose}>{t('Done')}</Button>
      </div>
    </Modal>
  );
}
