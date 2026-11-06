import {
  ArrowUpRight,
  Code2,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  defaultLibraryFilters,
  facetCounts,
  filterLibrary,
  type LibraryFilters,
  libraryItems,
} from '../../src/core/library';
import { librarySourceGroups, SOURCE_GROUP_PAGE_SIZE } from '../../src/core/library-groups';
import type { Entry, Source } from '../../src/core/model';
import { foldSearch } from '../../src/core/taxonomy';
import { AiAssist } from '../AiAssist';
import { api } from '../api';
import { CurrentProjectBanner } from '../CurrentProjectBanner';
import { Badge, Button, Empty, Modal, Notice, PageHeader, SearchBox, Spinner } from '../components';
import { DirectoryPathInput } from '../DirectoryPathInput';
import { useDraftGuard } from '../drafts';
import { countText, PAGE_SIZE } from '../format';
import { t } from '../i18n';
import { useLibraryPreferences } from '../library-preferences';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { ScanDiagnostics } from '../ScanDiagnostics';
import { Select } from '../Select';
import { LibraryGroupingControl, SourceGroups } from '../SourceGroups';
import { Discover } from './Discover';
import { EntryDetail } from './EntryDetail';
import {
  ActiveLibraryFilters,
  clearLibraryFilters,
  LibraryFilterPanel,
  LibraryStatusFilter,
  libraryFilterChips,
  SavedLibraryViews,
} from './LibraryFilters';
import { kindLabels, LibraryRows } from './LibraryRows';
import { SourceDetail } from './SourceDetail';

export function Library(props: PageProps): ReactNode {
  const { state, refresh, notify } = props;
  const preferences = useLibraryPreferences();
  const { filters } = preferences;
  const [view, setView] = useState<'items' | 'sources'>('items');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceType, setSourceType] = useState('all');
  const [sourceStatus, setSourceStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [detail, setDetail] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [sourceDetail, setSourceDetail] = useState<Source>();
  const [busy, setBusy] = useState(false);
  const changeFilters = (next: LibraryFilters) => {
    preferences.setFilters(next);
    setPage(0);
  };
  const items = useMemo(() => libraryItems(state, filters.status), [state, filters.status]);
  const savedCount = useMemo(
    () =>
      new Set(
        state.entries.map((entry) => JSON.stringify([entry.kind, entry.sourceId, entry.name])),
      ).size,
    [state.entries],
  );
  const results = useMemo(
    () =>
      filterLibrary(items, filters).sort((left, right) =>
        sort === 'updated'
          ? (Date.parse(right.entry.updatedAt) || 0) - (Date.parse(left.entry.updatedAt) || 0)
          : sort === 'usage'
            ? new Set(right.locations.map((location) => location.projectId).filter(Boolean)).size -
              new Set(left.locations.map((location) => location.projectId).filter(Boolean)).size
            : left.entry.name.localeCompare(right.entry.name),
      ),
    [items, filters, sort],
  );
  const kinds = useMemo(() => facetCounts(items, filters, 'kind'), [items, filters]);
  const groups = useMemo(() => {
    const grouped = librarySourceGroups(
      results,
      filters.kind === 'all' ? items : items.filter((item) => item.entry.kind === filters.kind),
    );
    return sort === 'name'
      ? grouped.sort((left, right) =>
          (left.source?.name || left.sourceId).localeCompare(right.source?.name || right.sourceId),
        )
      : grouped;
  }, [results, items, sort, filters.kind]);
  const chips = libraryFilterChips(filters, changeFilters, state);
  const sources = state.sources.filter(
    (source) =>
      (sourceType === 'all' || source.type === sourceType) &&
      (sourceStatus === 'all' || source.status === sourceStatus) &&
      foldSearch(sourceQuery)
        .trim()
        .split(/\s+/)
        .every((word) => foldSearch(`${source.name} ${source.url} ${source.notes}`).includes(word)),
  );
  const grouped = view === 'items' && preferences.grouping === 'source';
  const pageSize = grouped ? SOURCE_GROUP_PAGE_SIZE : PAGE_SIZE;
  const total = view === 'items' ? (grouped ? groups.length : results.length) : sources.length;
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const changeView = (next: 'items' | 'sources') => {
    setView(next);
    setPage(0);
  };
  async function scan(): Promise<void> {
    setBusy(true);
    try {
      await api('scan', 'POST', {});
      await refresh();
      notify(t('Scanning actual project and global files. Existing installations stay in place.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="library-explorer">
      <PageHeader
        eyebrow=""
        title={t('Library')}
        description={t('Find saved items by type, platform, technology or task.')}
        action={
          <div className="button-row">
            <Button
              variant="ghost"
              onClick={() => void scan()}
              disabled={busy || state.scan.state === 'running'}
            >
              <RefreshCw size={15} />
              {busy ? <Spinner text={t('Scanning')} /> : t('Scan this machine')}
            </Button>
            <Button variant="secondary" onClick={() => setDiscovering(true)}>
              <Search size={15} />
              {t('Discover')}
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={15} />
              {t('Add to library')}
            </Button>
          </div>
        }
      />
      <CurrentProjectBanner {...props} />
      <div className="library-view-switch" role="tablist" aria-label={t('Library view')}>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'items'}
          onClick={() => changeView('items')}
        >
          {t('Items')}
          <small>{savedCount}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'sources'}
          onClick={() => changeView('sources')}
        >
          {t('Sources')}
          <small>{state.sources.length}</small>
        </button>
      </div>
      {view === 'items' ? (
        <>
          <div className="library-type-tabs" role="tablist" aria-label={t('Item type')}>
            {(['all', 'skill', 'mcp', 'plugin', 'resource'] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                role="tab"
                aria-selected={filters.kind === kind}
                aria-label={t(kindLabels[kind])}
                onClick={() => changeFilters({ ...filters, kind })}
              >
                {t(kindLabels[kind])}
                <small>
                  {kind === 'all'
                    ? [...kinds.values()].reduce((sum, count) => sum + count, 0)
                    : kinds.get(kind) || 0}
                </small>
              </button>
            ))}
          </div>
          <div className="library-search-row">
            <SearchBox
              value={filters.query}
              label={t('Search library')}
              placeholder={t('Search names, descriptions, tags or sources…')}
              onChange={(query) => changeFilters({ ...filters, query })}
            />
            <SavedLibraryViews preferences={preferences} onChange={changeFilters} />
          </div>
          <ActiveLibraryFilters
            chips={chips}
            clear={() => changeFilters(clearLibraryFilters(filters))}
          />
          <div className="library-browser-layout" data-filters-open={mobileFilters || undefined}>
            <button
              type="button"
              className="library-filter-toggle"
              aria-expanded={mobileFilters}
              onClick={() => setMobileFilters(!mobileFilters)}
            >
              <SlidersHorizontal size={15} />
              {t('Filters')}
              {chips.length > 0 && <span>{chips.length}</span>}
            </button>
            <LibraryFilterPanel
              items={items}
              state={state}
              preferences={preferences}
              onChange={changeFilters}
            />
            <section className="library-results" aria-label={t('Library results')}>
              <div className="library-display-row">
                <LibraryGroupingControl
                  value={preferences.grouping}
                  onChange={(value) => {
                    preferences.setGrouping(value);
                    setPage(0);
                  }}
                />
                {grouped && <span>{countText(groups.length, 'source')}</span>}
              </div>
              <div className="library-results-toolbar">
                <p role="status" aria-live="polite">
                  {countText(results.length, 'item')}
                  <span>{t('of {{count}} saved items', { count: savedCount })}</span>
                </p>
                <div className="library-sort-controls">
                  <LibraryStatusFilter filters={filters} onChange={changeFilters} />
                  <Select
                    label={t('Sort items')}
                    value={sort}
                    onValueChange={setSort}
                    options={[
                      { value: 'name', label: t('Name A–Z') },
                      { value: 'updated', label: t('Recently updated') },
                      { value: 'usage', label: t('Most used in projects') },
                    ]}
                  />
                </div>
              </div>
              {results.length ? (
                grouped ? (
                  <SourceGroups
                    groups={groups.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)}
                    filterKey={JSON.stringify(filters)}
                    filtered={Boolean(filters.query.trim() || chips.length)}
                    onSource={setSourceDetail}
                    renderItems={(matches) => (
                      <LibraryRows
                        items={matches}
                        onSelect={setDetail}
                        showKind={filters.kind === 'all'}
                        showSource={false}
                      />
                    )}
                  />
                ) : (
                  <LibraryRows
                    items={results.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE)}
                    onSelect={setDetail}
                    showKind={filters.kind === 'all'}
                  />
                )
              ) : (
                <Empty
                  title={savedCount ? t('No items match these filters') : t('No saved items yet')}
                  text={
                    savedCount
                      ? t(
                          'Remove a filter or search all item types. Your saved content is still in the library.',
                        )
                      : t('Scan this machine, add a source, or create a custom item.')
                  }
                >
                  {savedCount > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        changeFilters({ ...defaultLibraryFilters(), kind: 'all', status: 'all' })
                      }
                    >
                      {t('Show all items')}
                    </Button>
                  )}
                  {savedCount === 0 && (
                    <Button variant="secondary" onClick={() => changeView('sources')}>
                      {t('Browse saved sources')}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    {t('Paste a link or describe a tool')}
                  </Button>
                </Empty>
              )}
              <p className="library-classification-note">
                {t(
                  'Classification is detected from names and tags. You can edit it in item details.',
                )}
              </p>
            </section>
          </div>
        </>
      ) : (
        <>
          <p className="source-view-help">
            {t(
              'Sources are collections and references. Open a source to choose which items to import.',
            )}
          </p>
          <div className="source-filter-row">
            <SearchBox
              value={sourceQuery}
              label={t('Search sources')}
              placeholder={t('Search source names, URLs or notes…')}
              onChange={(query) => {
                setSourceQuery(query);
                setPage(0);
              }}
            />
            <label htmlFor="library-source-type">
              {t('Source type')}
              <Select
                label={t('Source type')}
                id="library-source-type"
                value={sourceType}
                onValueChange={(value) => {
                  setSourceType(value);
                  setPage(0);
                }}
                options={[
                  { value: 'all', label: t('All source types') },
                  ...(['github', 'local', 'listing', 'plugin', 'resource'] as const).map(
                    (type) => ({
                      value: type,
                      label: {
                        github: 'GitHub',
                        local: t('Local folder'),
                        listing: t('Directory listing'),
                        plugin: t('Plugin'),
                        resource: t('Reference'),
                      }[type],
                    }),
                  ),
                ]}
              />
            </label>
            <label htmlFor="library-source-status">
              {t('Reachability')}
              <Select
                label={t('Reachability')}
                id="library-source-status"
                value={sourceStatus}
                onValueChange={(value) => {
                  setSourceStatus(value);
                  setPage(0);
                }}
                options={[
                  { value: 'all', label: t('Any reachability') },
                  { value: 'unchecked', label: t('Not checked') },
                  { value: 'reachable', label: t('Reachable') },
                  { value: 'unavailable', label: t('Unavailable') },
                ]}
              />
            </label>
          </div>
          {sources.length ? (
            <SourceList
              sources={sources.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE)}
              onSelect={setSourceDetail}
            />
          ) : (
            <Empty
              title={t('No matching sources')}
              text={t('Change the search or source filters.')}
            >
              <Button
                variant="secondary"
                onClick={() => {
                  setSourceQuery('');
                  setSourceType('all');
                  setSourceStatus('all');
                }}
              >
                {t('Clear filters')}
              </Button>
            </Empty>
          )}
        </>
      )}
      <div className="list-footer">
        <span>
          {view === 'items'
            ? countText(results.length, 'item')
            : countText(sources.length, 'source')}
          {grouped && ` · ${countText(groups.length, 'source')}`}
        </span>
        <div className="button-row">
          <Button
            variant="ghost"
            disabled={visiblePage === 0}
            onClick={() => setPage(visiblePage - 1)}
          >
            {t('Previous')}
          </Button>
          <span>{visiblePage + 1}</span>
          <Button
            variant="ghost"
            disabled={(visiblePage + 1) * pageSize >= total}
            onClick={() => setPage(visiblePage + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
      <ScanDiagnostics messages={state.lastScan?.skipped || []} />
      <div className="library-footnote">
        <ShieldAlert size={14} />
        <span>{t('No flags means no heuristic findings. It is not a security guarantee.')}</span>
      </div>
      <ModalPresence>
        {adding && (
          <AddToLibrary
            {...props}
            onClose={() => setAdding(false)}
            onSourceAdded={(source) => {
              setAdding(false);
              changeView('sources');
              setSourceQuery('');
              setSourceDetail(source);
            }}
          />
        )}
      </ModalPresence>
      <ModalPresence>
        {detail && <EntryDetail {...props} id={detail} onClose={() => setDetail(undefined)} />}
      </ModalPresence>
      <ModalPresence>
        {discovering && (
          <Discover
            {...props}
            onClose={() => setDiscovering(false)}
            onSource={(source) => {
              setDiscovering(false);
              changeView('sources');
              setSourceQuery('');
              setSourceDetail(source);
            }}
          />
        )}
      </ModalPresence>
      <ModalPresence>
        {sourceDetail && (
          <SourceDetail
            {...props}
            source={sourceDetail}
            onClose={() => setSourceDetail(undefined)}
          />
        )}
      </ModalPresence>
    </div>
  );
}

function SourceList({
  sources,
  onSelect,
}: {
  sources: Source[];
  onSelect: (source: Source) => void;
}): ReactNode {
  return (
    <div className="source-list">
      {sources.map((source) => (
        <button type="button" key={source.id} onClick={() => onSelect(source)}>
          <span className="source-avatar">
            {source.type === 'github' ? (
              <Code2 size={20} />
            ) : source.type === 'local' ? (
              <FolderOpen size={20} />
            ) : (
              <Link2 size={20} />
            )}
          </span>
          <div>
            <strong>{source.name}</strong>
            <span>{source.url || source.notes.slice(0, 90)}</span>
          </div>
          <Badge
            tone={
              source.status === 'reachable'
                ? 'green'
                : source.status === 'unavailable'
                  ? 'amber'
                  : 'neutral'
            }
          >
            {source.status === 'reachable'
              ? 'Reachable'
              : source.status === 'unchecked'
                ? t('Not checked')
                : t('Needs attention')}
          </Badge>
          <ArrowUpRight size={17} />
        </button>
      ))}
    </div>
  );
}

export function AddToLibrary({
  state,
  refresh,
  notify,
  onClose,
  onSourceAdded,
  onEntryAdded,
}: PageProps & {
  onClose: () => void;
  onSourceAdded: (source: Source) => void;
  onEntryAdded?: (entry: Entry) => void;
}): ReactNode {
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [tab, setTab] = useState<'assist' | 'source' | 'custom' | 'local' | 'mcp'>('assist');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skillBody, setSkillBody] = useState('');
  const template =
    '{\n  "transport": "http",\n  "url": "https://example.com/mcp",\n  "args": [],\n  "env": {},\n  "headers": {}\n}';
  const [mcpBody, setMcpBody] = useState(template);
  const body = tab === 'mcp' ? mcpBody : skillBody;
  const setBody = tab === 'mcp' ? setMcpBody : setSkillBody;
  const [tags, setTags] = useState('');
  const [url, setUrl] = useState('');
  const [recipe, setRecipe] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const guard = useDraftGuard(
    Boolean(
      aiDirty ||
        name ||
        description ||
        skillBody ||
        tags ||
        url ||
        recipe ||
        localPath ||
        mcpBody !== template,
    ),
    t('New library item'),
  );
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (tab === 'source') {
        const source = await api<Source>('sources', 'POST', {
          input: url,
          name: name || undefined,
          recipe,
        });
        await refresh();
        if (mounted.current) onSourceAdded(source);
        return;
      }
      let entry: Entry | undefined;
      if (tab === 'custom')
        entry = await api<Entry>('custom', 'POST', {
          name,
          description,
          body,
          tags: tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        });
      if (tab === 'local') entry = await api<Entry>('local-import', 'POST', { path: localPath });
      if (tab === 'mcp')
        entry = await api<Entry>('mcp', 'POST', {
          name,
          mcp: JSON.parse(body),
          tags: tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        });
      await refresh();
      notify(t('Added to your private library. Project files are unchanged.'));
      if (mounted.current) {
        if (entry && onEntryAdded) onEntryAdded(entry);
        else onClose();
      }
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Add something useful')}
      subtitle={t('Collect it once. Use it in the projects that need it.')}
      onClose={() => guard(onClose)}
    >
      <div className="tabs compact">
        {(['assist', 'source', 'custom', 'local', 'mcp'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'active' : ''}
            onClick={() => {
              if (aiDirty) guard(() => setTab(value));
              else setTab(value);
            }}
          >
            {value === 'assist'
              ? t('Start with AI')
              : value === 'source'
                ? t('Source')
                : value === 'custom'
                  ? t('Custom skill')
                  : value === 'local'
                    ? t('Local folder')
                    : t('MCP server')}
          </button>
        ))}
      </div>
      {tab !== 'local' && (
        <AiAssist
          key={tab}
          onDirtyChange={setAiDirty}
          settings={state.settings}
          task={tab === 'custom' ? 'skill' : tab === 'mcp' ? 'mcp' : 'library'}
          defaultOpen={tab === 'assist'}
          label={tab === 'assist' ? t('Paste or describe it') : t('Fill or improve with AI')}
          current={
            tab === 'assist'
              ? ''
              : JSON.stringify(
                  tab === 'source'
                    ? { name, input: url, recipe }
                    : tab === 'mcp'
                      ? { name, mcp: body, tags }
                      : { name, description, body, tags },
                )
          }
          onUse={(draft) => {
            if (draft.kind === 'source') {
              setTab('source');
              setName(draft.name);
              setUrl(draft.input);
              setRecipe(draft.recipe);
            }
            if (draft.kind === 'skill') {
              setTab('custom');
              setName(draft.name);
              setDescription(draft.description);
              setSkillBody(draft.body);
              setTags(draft.tags.join(', '));
            }
            if (draft.kind === 'mcp') {
              setTab('mcp');
              setName(draft.name);
              setMcpBody(JSON.stringify(draft.mcp, null, 2));
              setTags(draft.tags.join(', '));
            }
          }}
        />
      )}
      {tab !== 'assist' && (
        <form onSubmit={(event) => void submit(event)} className="editor-form">
          {tab === 'source' && (
            <>
              <label>
                {t('URL, repository, or installation command')}
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://github.com/expo/skills"
                  required
                />
              </label>
              <label>
                {t('Display name ')}
                <span>{t('Optional')}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                {t('Installation recipe ')}
                <span>{t('Stored, never executed on import')}</span>
                <input
                  value={recipe}
                  onChange={(event) => setRecipe(event.target.value)}
                  placeholder={t('bunx skills add owner/repo')}
                />
              </label>
              <Notice>
                {t(
                  'Sources can contain many skills. Add the source, then choose which skills to snapshot.',
                )}
              </Notice>
            </>
          )}
          {tab === 'local' && (
            <>
              <div className="directory-input-field">
                <label htmlFor="local-skill-directory">{t('Skill directory')}</label>
                <DirectoryPathInput
                  id="local-skill-directory"
                  label={t('Skill directory')}
                  value={localPath}
                  onValueChange={setLocalPath}
                  placeholder={t('/path/to/my-skill')}
                  required
                />
              </div>
              <Notice>
                {t(
                  'Reads SKILL.md and supporting files directly. Symlinked resources and oversized bundles are reported.',
                )}
              </Notice>
            </>
          )}
          {(tab === 'custom' || tab === 'mcp') && (
            <>
              <label>
                {t('Name')}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('my-project-workflow')}
                  required
                />
              </label>
              {tab === 'custom' && (
                <label>
                  {t('When should an agent use it?')}
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                  />
                </label>
              )}
              <div>
                <label htmlFor="new-library-body">
                  {tab === 'mcp'
                    ? t('Canonical MCP definition · JSON')
                    : t('Instructions · Markdown')}
                </label>
                <textarea
                  id="new-library-body"
                  className="code-editor"
                  rows={12}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  spellCheck={false}
                />
              </div>
              <label>
                {t('Tags ')}
                <span>{t('Comma separated')}</span>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder={t('backend, typescript')}
                />
              </label>
              {tab === 'mcp' && (
                <Notice>
                  {t(
                    'Use environment placeholders for secrets. No server is started when you add a definition.',
                  )}
                </Notice>
              )}
            </>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => guard(onClose)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {t('Add to library ')}
                  <Plus size={15} />
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
