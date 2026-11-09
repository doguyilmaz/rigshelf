import { Bookmark, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  defaultLibraryFilters,
  facetCounts,
  type LibraryFilters,
  type LibraryItem,
} from '../../src/core/library';
import { pluginEvidenceLabels } from '../../src/core/plugin-evidence';
import {
  type Category,
  isClassificationTag,
  platforms,
  technologies,
  topics,
} from '../../src/core/taxonomy';
import type { AppState } from '../api';
import { Button, Modal } from '../components';
import { t } from '../i18n';
import type { useLibraryPreferences } from '../library-preferences';
import { ModalPresence } from '../ModalPresence';
import { MultiSelect } from '../MultiSelect';
import { Select, type SelectOption } from '../Select';

type Preferences = ReturnType<typeof useLibraryPreferences>;
interface FilterChip {
  key: string;
  label: string;
  remove: () => void;
}
export function libraryFilterChips(
  filters: LibraryFilters,
  change: (next: LibraryFilters) => void,
  state: AppState,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const arrays = { platforms, technologies, topics, tags: [] };
  const axisLabels = {
    platforms: 'Platform',
    technologies: 'Technology',
    topics: 'Task',
    tags: 'Tag',
  };
  for (const axis of ['platforms', 'technologies', 'topics', 'tags'] as const) {
    for (const value of filters[axis])
      chips.push({
        key: `${axis}:${value}`,
        label: `${t(axisLabels[axis])}: ${value === 'unclassified' ? t('Unclassified') : t(arrays[axis].find((item) => item.id === value)?.label || value)}`,
        remove: () =>
          change({ ...filters, [axis]: filters[axis].filter((item) => item !== value) }),
      });
  }
  const singles: {
    axis: 'source' | 'project' | 'agent' | 'scope' | 'origin' | 'status' | 'review' | 'evidence';
    label: string;
    value: string;
    initial: string;
  }[] = [
    {
      axis: 'evidence',
      label: 'Plugin evidence',
      value:
        filters.evidence === 'all'
          ? t('Any Plugin evidence')
          : t(pluginEvidenceLabels[filters.evidence]),
      initial: 'all',
    },
    {
      axis: 'source',
      label: 'Source',
      value:
        state.sources.find((item) => item.id === filters.source)?.name || t('Unavailable source'),
      initial: 'all',
    },
    {
      axis: 'project',
      label: 'Used in project',
      value:
        state.projects.find((item) => item.id === filters.project)?.name ||
        t('Unavailable project'),
      initial: 'all',
    },
    {
      axis: 'agent',
      label: 'Agent',
      value: state.adapters.find((item) => item.id === filters.agent)?.name || filters.agent,
      initial: 'all',
    },
    {
      axis: 'scope',
      label: 'Location',
      value: t(
        {
          all: 'All locations',
          project: 'Project installations',
          global: 'Global installations',
          unused: 'Library only',
        }[filters.scope],
      ),
      initial: 'all',
    },
    {
      axis: 'origin',
      label: 'Origin',
      value: t(
        { all: 'All origins', custom: 'Custom content', upstream: 'Imported content' }[
          filters.origin
        ],
      ),
      initial: 'all',
    },
    {
      axis: 'status',
      label: 'Status',
      value: t(
        { all: 'All statuses', active: 'Active only', archived: 'Archived only' }[filters.status],
      ),
      initial: 'active',
    },
    {
      axis: 'review',
      label: 'Review',
      value: t(
        {
          all: 'Any review status',
          flagged: 'Needs review',
          blocked: 'Blocked content',
          clean: 'No heuristic flags',
          approved: 'Approved for automation',
        }[filters.review],
      ),
      initial: 'all',
    },
  ];
  for (const item of singles)
    if (filters[item.axis] !== item.initial)
      chips.push({
        key: item.axis,
        label: `${t(item.label)}: ${item.value}`,
        remove: () => change({ ...filters, [item.axis]: item.initial }),
      });
  if (filters.query)
    chips.push({
      key: 'query',
      label: t('Search: {{query}}', { query: filters.query }),
      remove: () => change({ ...filters, query: '' }),
    });
  return chips;
}
function categoryOptions(
  definitions: Category[],
  counts: Map<string, number>,
  selected: string[],
): SelectOption[] {
  const result = definitions
    .filter((item) => counts.has(item.id) || selected.includes(item.id))
    .map((item) => ({
      value: item.id,
      label: t(item.label),
      count: counts.get(item.id) || 0,
    }));
  for (const id of selected)
    if (id !== 'unclassified' && !definitions.some((item) => item.id === id))
      result.push({ value: id, label: id, count: 0 });
  if (counts.has('unclassified') || selected.includes('unclassified'))
    result.push({
      value: 'unclassified',
      label: t('Unclassified'),
      count: counts.get('unclassified') || 0,
    });
  return result;
}
export function LibraryFilterPanel({
  items,
  state,
  preferences,
  onChange,
}: {
  items: LibraryItem[];
  state: AppState;
  preferences: Preferences;
  onChange: (next: LibraryFilters) => void;
}) {
  const { filters } = preferences;
  const [expanded, setExpanded] = useState(false);
  const platformOptions = useMemo(
    () => categoryOptions(platforms, facetCounts(items, filters, 'platforms'), filters.platforms),
    [items, filters],
  );
  const technologyOptions = useMemo(
    () =>
      categoryOptions(
        technologies,
        facetCounts(items, filters, 'technologies'),
        filters.technologies,
      ),
    [items, filters],
  );
  const topicOptions = useMemo(
    () => categoryOptions(topics, facetCounts(items, filters, 'topics'), filters.topics),
    [items, filters],
  );
  const tagCounts = useMemo(() => facetCounts(items, filters, 'tags'), [items, filters]);
  const tagOptions = [...new Set([...tagCounts.keys(), ...filters.tags])]
    .filter((tag) => !isClassificationTag(tag) && tag !== 'unclassified')
    .sort()
    .map((tag) => ({ value: tag, label: tag, count: tagCounts.get(tag) || 0 }));
  const refineCount = libraryFilterChips(filters, onChange, state).filter(
    (chip) =>
      ![
        'query',
        'status',
        ...filters.platforms.map((value) => `platforms:${value}`),
        ...filters.technologies.map((value) => `technologies:${value}`),
        ...filters.topics.map((value) => `topics:${value}`),
      ].includes(chip.key),
  ).length;
  return (
    <aside className="library-facets" aria-label={t('Library filters')}>
      <div className="facet-heading">
        <h2>{t('Filters')}</h2>
        <SlidersHorizontal size={15} aria-hidden="true" />
      </div>
      <p className="facet-intro">{t('Start with where you build or what you need to do.')}</p>
      {(filters.kind === 'plugin' || filters.evidence !== 'all') && (
        <label htmlFor="library-plugin-evidence">
          {t('Plugin evidence')}
          <Select
            id="library-plugin-evidence"
            label={t('Plugin evidence')}
            value={filters.evidence}
            onValueChange={(evidence) =>
              onChange({ ...filters, evidence: evidence as LibraryFilters['evidence'] })
            }
            options={[
              { value: 'all', label: t('Any Plugin evidence') },
              ...Object.entries(pluginEvidenceLabels).map(([value, label]) => ({
                value,
                label: t(label),
              })),
            ]}
          />
          <small className="muted">
            {t('Configuration and cache presence do not prove a Plugin is loaded in a session.')}
          </small>
        </label>
      )}
      <label htmlFor="library-platform">
        {t('Platform & area')}
        <MultiSelect
          id="library-platform"
          label={t('Platform & area')}
          values={filters.platforms}
          onChange={(values) => onChange({ ...filters, platforms: values })}
          options={platformOptions}
          placeholder={t('Any platform')}
        />
      </label>
      <label htmlFor="library-technology">
        {t('Technology')}
        <MultiSelect
          id="library-technology"
          label={t('Technology')}
          values={filters.technologies}
          onChange={(values) => onChange({ ...filters, technologies: values })}
          options={technologyOptions}
          placeholder={t('Any technology')}
        />
      </label>
      <label htmlFor="library-task">
        {t('Task')}
        <MultiSelect
          id="library-task"
          label={t('Task')}
          values={filters.topics}
          onChange={(values) => onChange({ ...filters, topics: values })}
          options={topicOptions}
          placeholder={t('Any task')}
        />
      </label>
      <button
        type="button"
        className="facet-more"
        aria-label={t('More filters')}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {t('More filters')}
        {refineCount > 0 && <span>{refineCount}</span>}
      </button>
      {expanded && (
        <div className="facet-refinements">
          <label htmlFor="library-source">
            {t('Source')}
            <Select
              id="library-source"
              label={t('Source')}
              searchable
              value={filters.source}
              onValueChange={(source) => onChange({ ...filters, source })}
              options={[
                { value: 'all', label: t('Any source') },
                ...state.sources
                  .filter(
                    (source) =>
                      items.some((item) => item.entry.sourceId === source.id) ||
                      source.id === filters.source,
                  )
                  .map((source) => ({ value: source.id, label: source.name })),
              ]}
            />
          </label>
          <label htmlFor="library-project">
            {t('Used in project')}
            <Select
              id="library-project"
              label={t('Used in project')}
              searchable
              value={filters.project}
              onValueChange={(project) => onChange({ ...filters, project })}
              options={[
                { value: 'all', label: t('Any project') },
                ...state.projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
            />
          </label>
          <label htmlFor="library-agent">
            {t('Agent')}
            <Select
              id="library-agent"
              label={t('Agent')}
              value={filters.agent}
              onValueChange={(agent) => onChange({ ...filters, agent })}
              options={[
                { value: 'all', label: t('Any agent') },
                ...state.adapters.map((agent) => ({ value: agent.id, label: agent.name })),
              ]}
            />
          </label>
          <label htmlFor="library-location">
            {t('Location')}
            <Select
              id="library-location"
              label={t('Location')}
              value={filters.scope}
              onValueChange={(scope) =>
                onChange({ ...filters, scope: scope as LibraryFilters['scope'] })
              }
              options={[
                { value: 'all', label: t('All locations') },
                { value: 'project', label: t('Project installations') },
                { value: 'global', label: t('Global installations') },
                { value: 'unused', label: t('Library only') },
              ]}
            />
          </label>
          <label htmlFor="library-origin">
            {t('Origin')}
            <Select
              id="library-origin"
              label={t('Origin')}
              value={filters.origin}
              onValueChange={(origin) =>
                onChange({ ...filters, origin: origin as LibraryFilters['origin'] })
              }
              options={[
                { value: 'all', label: t('All origins') },
                { value: 'custom', label: t('Custom content') },
                { value: 'upstream', label: t('Imported content') },
              ]}
            />
          </label>

          <label htmlFor="library-review">
            {t('Review')}
            <Select
              id="library-review"
              label={t('Review')}
              value={filters.review}
              onValueChange={(review) =>
                onChange({ ...filters, review: review as LibraryFilters['review'] })
              }
              options={[
                { value: 'all', label: t('Any review status') },
                { value: 'flagged', label: t('Needs review') },
                { value: 'blocked', label: t('Blocked content') },
                { value: 'clean', label: t('No heuristic flags') },
                { value: 'approved', label: t('Approved for automation') },
              ]}
            />
          </label>
          <label htmlFor="library-tags">
            {t('Tags')}
            <MultiSelect
              id="library-tags"
              label={t('Tags')}
              values={filters.tags}
              onChange={(tags) => onChange({ ...filters, tags })}
              options={tagOptions}
              placeholder={t('Any tag')}
            />
          </label>
        </div>
      )}
    </aside>
  );
}
export function ActiveLibraryFilters({ chips, clear }: { chips: FilterChip[]; clear: () => void }) {
  return chips.length ? (
    <fieldset className="active-library-filters" aria-label={t('Active filters')}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          aria-label={t('Remove filter: {{filter}}', { filter: chip.label })}
        >
          {chip.label}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      <button type="button" className="clear-library-filters" onClick={clear}>
        {t('Clear filters')}
      </button>
    </fieldset>
  ) : null;
}
export function SavedLibraryViews({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (filters: LibraryFilters) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState(false);
  const current = preferences.saved.find(
    (view) => JSON.stringify(view.filters) === JSON.stringify(preferences.filters),
  );
  return (
    <>
      <div className="saved-library-views">
        {preferences.saved.length > 0 && (
          <Select
            label={t('Saved views')}
            value={current?.id || 'none'}
            onValueChange={(id) => {
              const view = preferences.saved.find((item) => item.id === id);
              if (view) onChange(view.filters);
            }}
            options={[
              { value: 'none', label: t('Saved views') },
              ...preferences.saved.map((view) => ({ value: view.id, label: view.name })),
            ]}
          />
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setName(current?.name || '');
            setSaveError(false);
            setSaving(true);
          }}
        >
          <Bookmark size={14} />
          {t('Save view')}
        </Button>
        {current && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('Delete saved view')}
            onClick={() => preferences.removeView(current.id)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {!preferences.persistent && (
        <p className="field-help">
          {t('Browser storage is unavailable. Views last only for this visit.')}
        </p>
      )}
      <ModalPresence>
        {saving && (
          <Modal
            title={t('Save library view')}
            subtitle={t('Saved in this browser. No project files are changed.')}
            onClose={() => setSaving(false)}
          >
            <form
              className="editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                preferences.saveView(name);
                setSaving(false);
              }}
            >
              <label>
                {t('View name')}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={48}
                  autoComplete="off"
                  required
                  placeholder={t('For example: Expo authentication')}
                />
              </label>
              <p className="field-help">{t('Saving with an existing name updates that view.')}</p>
              {saveError && (
                <p role="alert" className="field-help">
                  {t('You can save up to 12 views. Use an existing name to update a view.')}
                </p>
              )}
              <div className="modal-actions">
                <Button variant="ghost" onClick={() => setSaving(false)}>
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={!name.trim()}>
                  {t('Save view')}
                </Button>
              </div>
            </form>
          </Modal>
        )}
      </ModalPresence>
    </>
  );
}
export const clearLibraryFilters = (filters: LibraryFilters): LibraryFilters => ({
  ...defaultLibraryFilters(),
  kind: filters.kind,
});

export function LibraryStatusFilter({
  filters,
  onChange,
}: {
  filters: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
}) {
  return (
    <Select
      id="library-status"
      label={t('Status')}
      value={filters.status}
      onValueChange={(status) =>
        onChange({ ...filters, status: status as LibraryFilters['status'] })
      }
      options={[
        { value: 'active', label: t('Active only') },
        { value: 'archived', label: t('Archived only') },
        { value: 'all', label: t('All statuses') },
      ]}
    />
  );
}
