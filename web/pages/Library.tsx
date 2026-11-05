import {
  ArrowUpRight,
  Code2,
  Download,
  FileText,
  FolderOpen,
  Link2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Entry, Source } from '../../src/core/model';
import { api, apiId, formatDate, shortPath } from '../api';
import {
  Badge,
  Button,
  CopyButton,
  Empty,
  ExternalLink,
  Modal,
  Notice,
  PageHeader,
  SearchBox,
  Spinner,
} from '../components';
import { useDraftGuard } from '../drafts';
import { countText } from '../format';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { Discover } from './Discover';
import { EntryDetail } from './EntryDetail';

type LibraryView = 'skills' | 'mcp' | 'custom' | 'sources' | 'plugins' | 'archived';
export function Library(props: PageProps): ReactNode {
  const { state, refresh, notify } = props;
  const [view, setView] = useState<LibraryView>('skills');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [tag, setTag] = useState('all');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [sourceDetail, setSourceDetail] = useState<Source>();
  const [busy, setBusy] = useState(false);
  const tags = useMemo(
    () => [...new Set(state.entries.flatMap((entry) => entry.tags))].sort(),
    [state.entries],
  );
  const entries = useMemo(
    () =>
      state.entries.filter(
        (entry) =>
          (view === 'archived' ? Boolean(entry.archived) : !entry.archived) &&
          (view === 'archived'
            ? true
            : view === 'custom'
              ? entry.custom
              : view === 'mcp'
                ? entry.kind === 'mcp'
                : view === 'plugins'
                  ? entry.kind === 'plugin'
                  : entry.kind === 'skill') &&
          (group === 'all' || group.startsWith('project:')
            ? group === 'all' ||
              state.installations.some(
                (location) =>
                  location.entryId === entry.id && location.projectId === group.slice(8),
              )
            : entry.sourceId === group) &&
          (tag === 'all' || entry.tags.includes(tag)) &&
          (scope === 'all' ||
            (scope === 'unused'
              ? !state.installations.some((location) => location.entryId === entry.id)
              : state.installations.some(
                  (location) => location.entryId === entry.id && location.scope === scope,
                ))) &&
          `${entry.name} ${entry.description} ${entry.tags.join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [state.entries, state.installations, view, group, tag, query, scope],
  );
  const families = useMemo(() => {
    const grouped = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = `${entry.kind}:${entry.sourceId}:${entry.name}`;
      const family = grouped.get(key) || [];
      family.push(entry);
      grouped.set(key, family);
    }
    return [...grouped.values()].map((family) =>
      family.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }, [entries]);
  const sources = state.sources.filter((source) =>
    `${source.name} ${source.url} ${source.notes}`.toLowerCase().includes(query.toLowerCase()),
  );
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
  const changeView = (next: LibraryView) => {
    setView(next);
    setPage(0);
    setGroup('all');
  };
  return (
    <>
      <PageHeader
        eyebrow={t('YOUR CAPABILITIES, TOGETHER')}
        title={t('The library')}
        description={t('Keep everything you collect. Activate only what a project needs.')}
        action={
          <div className="button-row">
            <Button
              variant="secondary"
              onClick={() => void scan()}
              disabled={busy || state.scan.state === 'running'}
            >
              {state.scan.state === 'running' ? (
                <Spinner text={t('Scanning')} />
              ) : (
                <>
                  <RefreshCw size={15} />
                  {t('Scan this machine')}
                </>
              )}
            </Button>
            <Button variant="secondary" onClick={() => setDiscovering(true)}>
              <Search size={15} />
              {t('Discover')}
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} />
              {t('Add to library')}
            </Button>
          </div>
        }
      />
      <div className="library-topline">
        <div className="tabs" role="tablist" aria-label={t('Library type')}>
          {(['skills', 'mcp', 'custom', 'sources', 'plugins', 'archived'] as const).map((value) => (
            <button
              type="button"
              key={value}
              role="tab"
              aria-selected={view === value}
              className={view === value ? 'active' : ''}
              onClick={() => changeView(value)}
            >
              {value === 'mcp'
                ? t('MCP servers')
                : t(value.charAt(0).toUpperCase() + value.slice(1))}
              <span>
                {value === 'sources'
                  ? state.sources.length
                  : value === 'archived'
                    ? state.entries.filter((entry) => entry.archived).length
                    : value === 'custom'
                      ? state.entries.filter((entry) => entry.custom && !entry.archived).length
                      : state.entries.filter(
                          (entry) =>
                            !entry.archived &&
                            entry.kind ===
                              (value === 'skills'
                                ? 'skill'
                                : value === 'plugins'
                                  ? 'plugin'
                                  : 'mcp'),
                        ).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="library-toolbar filters-toolbar">
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
        {view !== 'sources' && (
          <>
            <Select
              label={t('Group library')}
              searchable
              value={group}
              onValueChange={(value) => {
                setGroup(value);
                setPage(0);
              }}
              options={[
                { value: 'all', label: t('All sources & projects') },
                ...state.sources
                  .filter((source) => state.entries.some((entry) => entry.sourceId === source.id))
                  .map((source) => ({ value: source.id, label: source.name, group: 'Source' })),
                ...state.projects.map((project) => ({
                  value: `project:${project.id}`,
                  label: project.name,
                  group: 'Project',
                })),
              ]}
            />
            <Select
              label={t('Filter by installation scope')}
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setPage(0);
              }}
              options={[
                { value: 'all', label: t('All locations') },
                { value: 'global', label: t('Global installations') },
                { value: 'project', label: t('Project installations') },
                { value: 'unused', label: t('Library only') },
              ]}
            />
            <Select
              label={t('Filter by tag')}
              searchable
              value={tag}
              onValueChange={(value) => {
                setTag(value);
                setPage(0);
              }}
              options={[
                { value: 'all', label: t('All tags') },
                ...tags.map((value) => ({ value, label: value })),
              ]}
            />
          </>
        )}
      </div>
      {view === 'sources' ? (
        <SourceList sources={sources.slice(page * 40, page * 40 + 40)} onSelect={setSourceDetail} />
      ) : entries.length ? (
        <div className="entry-list">
          <div className="entry-list-head">
            <span>{t('CAPABILITY')}</span>
            <span>{t('SOURCE / TAGS')}</span>
            <span>{t('INSTALLED IN')}</span>
            <span>{t('REVIEW')}</span>
          </div>
          {families.slice(page * 40, page * 40 + 40).map((family) => {
            const entry = family[0];
            const locations = state.installations.filter((location) =>
              family.some((version) => version.id === location.entryId),
            );
            const projects = new Set(
              locations
                .filter((location) => location.projectId)
                .map((location) => location.projectId),
            );
            const findings = entry.findings.filter((finding) => finding.level !== 'info');
            return (
              <button
                type="button"
                className="entry-list-row"
                key={entry.id}
                onClick={() => setDetail(entry.id)}
              >
                <div className="entry-title">
                  <span className={`entry-icon ${entry.kind}`}>
                    {entry.kind === 'mcp' ? <Plug size={18} /> : <FileText size={18} />}
                  </span>
                  <div>
                    <strong>{entry.name}</strong>{' '}
                    {family.length > 1 && (
                      <Badge>
                        {family.length}
                        {t(' versions')}
                      </Badge>
                    )}
                    <p>{entry.description || t('No description yet')}</p>
                  </div>
                </div>
                <div className="entry-source">
                  <span>
                    {state.sources.find((source) => source.id === entry.sourceId)?.name ||
                      t('Unknown source')}
                  </span>
                  <div>
                    {entry.tags.slice(0, 2).map((value) => (
                      <Badge key={value}>{value}</Badge>
                    ))}
                    {entry.custom && <Badge tone="green">{t('Custom')}</Badge>}
                  </div>
                </div>
                <div className="entry-locations">
                  {projects.size ? countText(projects.size, 'project') : t('Library only')}
                  {locations.some((location) => location.scope === 'global') && (
                    <span>{t('Global copy exists')}</span>
                  )}
                </div>
                <div>
                  {findings.length ? (
                    <Badge
                      tone={findings.some((finding) => finding.level === 'block') ? 'red' : 'amber'}
                    >
                      {findings.length}
                      {t(' finding')}
                      {findings.length > 1 ? 's' : ''}
                    </Badge>
                  ) : (
                    <span className="scan-label">
                      <span className="live-dot" />
                      {t(' No flags')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            query || tag !== 'all' || group !== 'all'
              ? t('No matching capabilities')
              : t('A good kit starts here.')
          }
          text={t(
            'Scan skills already on this machine, add a source, or write something of your own.',
          )}
        >
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} />
            {t('Add to library')}
          </Button>
        </Empty>
      )}
      <div className="list-footer">
        <span>
          {view === 'sources'
            ? countText(sources.length, 'source')
            : countText(families.length, 'capability group', 'capability groups')}{' '}
          {t('· Content opens on demand')}
        </span>
        <div className="button-row">
          <Button
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('Previous')}
          </Button>
          <span>{page + 1}</span>
          <Button
            variant="ghost"
            disabled={(page + 1) * 40 >= (view === 'sources' ? sources.length : families.length)}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
      {state.lastScan?.skipped.length ? (
        <details className="warnings">
          <summary>
            {state.lastScan.skipped.length}
            {t(' files need attention from the last scan')}
          </summary>
          {[...new Set(state.lastScan.skipped)].map((message) => (
            <p key={message}>{shortPath(message)}</p>
          ))}
        </details>
      ) : null}
      <div className="library-footnote">
        <ShieldAlert size={15} />
        <span>
          {t(
            '“No flags” means the built-in heuristics found nothing. Source reachability and publisher trust are separate.',
          )}
        </span>
      </div>
      <ModalPresence>
        {adding && (
          <AddToLibrary
            {...props}
            onClose={() => setAdding(false)}
            onSourceAdded={(source) => {
              setAdding(false);
              changeView('sources');
              setQuery('');
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
              setQuery('');
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
    </>
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

function AddToLibrary({
  refresh,
  notify,
  onClose,
  onSourceAdded,
}: PageProps & { onClose: () => void; onSourceAdded: (source: Source) => void }): ReactNode {
  const [tab, setTab] = useState<'source' | 'custom' | 'local' | 'mcp'>('source');
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
  const guard = useDraftGuard(
    Boolean(
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
        onSourceAdded(source);
        return;
      }
      if (tab === 'custom')
        await api('custom', 'POST', {
          name,
          description,
          body,
          tags: tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        });
      if (tab === 'local') await api('local-import', 'POST', { path: localPath });
      if (tab === 'mcp')
        await api('mcp', 'POST', {
          name,
          mcp: JSON.parse(body),
          tags: tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        });
      await refresh();
      notify(t('Added to your private library. Project files are unchanged.'));
      onClose();
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
        {(['source', 'custom', 'local', 'mcp'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'active' : ''}
            onClick={() => {
              setTab(value);
            }}
          >
            {value === 'source'
              ? t('Source')
              : value === 'custom'
                ? t('Custom skill')
                : value === 'local'
                  ? t('Local folder')
                  : t('MCP server')}
          </button>
        ))}
      </div>
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
            <label>
              {t('Skill directory')}
              <input
                value={localPath}
                onChange={(event) => setLocalPath(event.target.value)}
                placeholder={t('/path/to/my-skill')}
                required
              />
            </label>
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
            <label>
              {tab === 'mcp' ? t('Canonical MCP definition · JSON') : t('Instructions · Markdown')}
              <textarea
                className="code-editor"
                rows={12}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                spellCheck={false}
              />
            </label>
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
    </Modal>
  );
}

function SourceDetail({
  source: initial,
  refresh,
  notify,
  onClose,
}: PageProps & { source: Source; onClose: () => void }): ReactNode {
  const [source, setSource] = useState(initial);
  const [skills, setSkills] = useState<{ path: string; name: string }[]>();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const guard = useDraftGuard(
    editing &&
      ['name', 'url', 'recipe', 'notes'].some(
        (key) => draft[key as keyof Source] !== source[key as keyof Source],
      ),
    t('Source'),
  );
  useEffect(() => {
    if (initial.type !== 'github') return;
    let live = true;
    void api<{ skills: { path: string; name: string }[] } | null>(
      `sources/${apiId(initial.id)}/index`,
    )
      .then((index) => {
        if (live && index) setSkills(index.skills);
      })
      .catch((error) => notify(error.message, true));
    return () => {
      live = false;
    };
  }, [initial.id, initial.type, notify]);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await api<Source>(`sources/${apiId(source.id)}`, 'PATCH', draft);
      setSource(next);
      setDraft(next);
      setEditing(false);
      if (next.url !== source.url) setSkills(undefined);
      await refresh();
      notify(t('Source updated. Existing snapshot provenance receipts are retained.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function check(): Promise<void> {
    setBusy(true);
    try {
      setSource(await api<Source>(`sources/${apiId(source.id)}/check`, 'POST', {}));
      await refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function discover(): Promise<void> {
    setBusy(true);
    try {
      setSkills(await api(`sources/${apiId(source.id)}/skills`));
      await refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function ingest(path: string): Promise<void> {
    setBusy(true);
    try {
      const entry = await api<Entry>(`sources/${apiId(source.id)}/import`, 'POST', { path });
      await refresh();
      notify(t('{{name}} imported. It is available for project setup.', { name: entry.name }));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={source.name}
      subtitle={
        source.type === 'github'
          ? t('A source can contain many skills. Import just the ones you want.')
          : t('Saved reference and installation method.')
      }
      onClose={() => guard(onClose)}
      wide
    >
      <div className="source-detail-top">
        <ExternalLink href={source.url}>{source.url || t('Local source')}</ExternalLink>
        <Badge tone={source.status === 'reachable' ? 'green' : 'neutral'}>{t(source.status)}</Badge>
        <span className="muted">{formatDate(source.checkedAt)}</span>
      </div>
      {source.repository && (
        <div className="repository-evidence">
          <p className="eyebrow">
            {t('GITHUB REPOSITORY METADATA · ')}
            {formatDate(source.repository.checkedAt)}
          </p>
          <p>
            {t('Owner')}{' '}
            <ExternalLink href={`https://github.com/${source.repository.owner}`}>
              {source.repository.owner}
            </ExternalLink>
            {source.repository.license
              ? t(' · License: {{license}}', { license: source.repository.license })
              : t(' · No declared license found')}
            {source.repository.archived ? t(' · Archived repository') : ''}
          </p>
          {source.repository.description && (
            <p className="muted">{source.repository.description}</p>
          )}
          <small>
            {t(
              'Repository ownership and a license declaration do not establish safety or endorsement.',
            )}
          </small>
        </div>
      )}
      {source.recipe && (
        <div className="recipe">
          <p className="eyebrow">{t('PREFERRED INSTALLATION RECIPE · NEVER AUTO-EXECUTED')}</p>
          <code>{source.recipe}</code>
          <CopyButton text={source.recipe} />
        </div>
      )}
      {editing ? (
        <div className="editor-form">
          <label>
            {t('Display name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            {t('Source URL')}
            <input
              type="url"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </label>
          <label>
            {t('Installation recipe')}
            <input
              value={draft.recipe}
              onChange={(event) => setDraft({ ...draft, recipe: event.target.value })}
            />
          </label>
          <label>
            {t('Research notes')}
            <textarea
              rows={5}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </label>
          <div className="button-row">
            <Button disabled={busy} onClick={() => void save()}>
              {t('Save source')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('Cancel editing')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="source-notes">{source.notes}</p>
      )}
      {source.latestRef && (
        <p className="muted">
          {t('Last checked revision ')}
          <code>{source.latestRef.slice(0, 12)}</code>
          {source.skillCount !== undefined &&
            t(' · {{count}} indexed skills', { count: source.skillCount })}
        </p>
      )}
      {source.focusSkill && (
        <Notice>
          {t('Originally saved for ')}
          <strong>{source.focusSkill}</strong>
          {t('. Other skills from the same source are available below.')}
        </Notice>
      )}
      <div className="button-row">
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(source);
            setEditing(!editing);
          }}
        >
          {t('Edit source')}
        </Button>
        {source.url && (
          <Button variant="secondary" onClick={() => void check()} disabled={busy}>
            <RefreshCw size={14} />
            {t('Check source')}
          </Button>
        )}
        {source.type === 'github' && (
          <Button onClick={() => void discover()} disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                <Search size={15} />
                {t('Find skills in source')}
              </>
            )}
          </Button>
        )}
      </div>
      {skills && (
        <div className="source-skill-results">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t('Search {{count}} discovered skills…', { count: skills.length })}
          />
          {skills.length === 0 && (
            <Notice>
              {t(
                'No SKILL.md files found. This may be a CLI, docs repository, or plugin rather than a skill collection.',
              )}
            </Notice>
          )}
          {skills
            .filter((skill) =>
              `${skill.name} ${skill.path}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 100)
            .map((skill) => (
              <div key={skill.path}>
                <FileText size={17} />
                <div>
                  <strong>{skill.name}</strong>
                  <code>{skill.path}</code>
                </div>
                <Button variant="secondary" disabled={busy} onClick={() => void ingest(skill.path)}>
                  <Download size={13} />
                  {t('Import snapshot')}
                </Button>
              </div>
            ))}
        </div>
      )}
      <div className="detail-danger">
        {removing ? (
          <>
            <span>{t('Remove this saved source?')}</span>
            <Button
              variant="danger"
              onClick={() => {
                void api(`sources/${apiId(source.id)}`, 'DELETE')
                  .then(refresh)
                  .then(onClose)
                  .catch((error) => notify(error.message, true));
              }}
            >
              {t('Remove')}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t('Cancel')}
            </Button>
          </>
        ) : (
          <button type="button" className="inline-button muted" onClick={() => setRemoving(true)}>
            <Trash2 size={13} />
            {t('Remove source')}
          </button>
        )}
      </div>
    </Modal>
  );
}
