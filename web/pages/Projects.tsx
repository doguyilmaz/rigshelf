import { ArrowRight, ArrowUpRight, FolderOpen, Plus, Zap } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Project } from '../../src/core/model';
import { api, apiId, formatDate, shortPath } from '../api';
import { Badge, Button, Empty, Modal, Notice, PageHeader, SearchBox } from '../components';
import { requestDiscard, useDraftGuard } from '../drafts';
import { countText, PAGE_SIZE } from '../format';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { ProjectFileBrowser } from './ProjectFileBrowser';
import { ProjectMaintenance } from './ProjectMaintenance';

export function Projects(props: PageProps): ReactNode {
  const { state, navigate } = props;
  const [query, setQuery] = useState('');
  const [stack, setStack] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = state.projects.find((project) => project.id === selectedId);
  const projects = state.projects.filter(
    (project) =>
      `${project.name} ${project.path} ${project.stacks.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (stack === 'all' || project.stacks.includes(stack)),
  );
  const stacks = [...new Set(state.projects.flatMap((project) => project.stacks))].sort();
  return (
    <>
      <PageHeader
        eyebrow={t('A HOME FOR EVERY KIT')}
        title={t('Your projects')}
        description={t('Different stacks. Different agents. The right setup for each one.')}
        action={
          <Button onClick={() => navigate('setup', '')}>
            <Plus size={16} />
            {t('Set up a project')}
          </Button>
        }
      />
      <div className="library-toolbar">
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          placeholder={t('Find a project…')}
        />
        <Select
          value={stack}
          onValueChange={(value) => {
            setStack(value);
            setPage(0);
          }}
          label={t('Filter project stack')}
          searchable
          options={[
            { value: 'all', label: t('All stacks') },
            ...stacks.map((value) => ({ value, label: value })),
          ]}
        />
        <span className="muted">{countText(projects.length, 'project')}</span>
      </div>
      {projects.length ? (
        <div className="project-grid">
          {projects.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((project) => {
            const count = new Set(
              state.installations
                .filter((location) => location.projectId === project.id)
                .map((location) => location.entryId),
            ).size;
            const approved = state.approvals?.find((value) => value.id === project.id)?.enabled;
            return (
              <article className="project-card" key={project.id}>
                <div className="project-card-top">
                  <span className="project-folder">
                    <FolderOpen size={21} strokeWidth={1.5} />
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('Inspect {{name}}', { name: project.name })}
                    onClick={() => setSelectedId(project.id)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
                <button
                  type="button"
                  className="project-name"
                  onClick={() => setSelectedId(project.id)}
                >
                  {project.name}
                </button>
                <code title={project.path}>{shortPath(project.path)}</code>
                <div className="project-tags">
                  {project.stacks.slice(0, 4).map((value) => (
                    <Badge key={value}>{value}</Badge>
                  ))}
                  {!project.stacks.length && <Badge>{t('Stack unclassified')}</Badge>}
                </div>
                <div className="project-card-bottom">
                  <span>
                    {countText(count, 'capability', 'capabilities')}
                    {approved && (
                      <span className="auto-label">
                        <Zap size={12} />
                        {t('Auto-add approved')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => navigate('setup', project.path)}
                  >
                    {t('Set up ')}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={t('Meet your next project.')}
          text={t(
            'Scan your development folders to find existing projects, or set up a new directory.',
          )}
        >
          <Button onClick={() => navigate('library')}>
            {t('Scan this machine ')}
            <ArrowRight size={15} />
          </Button>
        </Empty>
      )}
      {projects.length > PAGE_SIZE && (
        <div className="list-footer">
          <span>{countText(projects.length, 'project')}</span>
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
              disabled={(page + 1) * PAGE_SIZE >= projects.length}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
      )}
      <ModalPresence>
        {selected && (
          <ProjectDetail {...props} project={selected} onClose={() => setSelectedId(undefined)} />
        )}
      </ModalPresence>
    </>
  );
}

function ProjectDetail({
  state,
  project,
  onClose,
  navigate,
  notify,
  refresh,
}: PageProps & { project: Project; onClose: () => void }): ReactNode {
  const [view, setView] = useState<'files' | 'setup'>('files');
  const [automationBusy, setAutomationBusy] = useState(false);
  const [name, setName] = useState(project.name);
  const [stacks, setStacks] = useState(project.stacks.join(', '));
  const [savedClassification, setSavedClassification] = useState({
    name: project.name,
    stacks: project.stacks.join(', '),
  });
  useDraftGuard(
    name !== savedClassification.name || stacks !== savedClassification.stacks,
    t('Project details'),
  );
  const approved = state.approvals?.find((value) => value.id === project.id)?.enabled || false;
  async function save(): Promise<void> {
    try {
      await api(`projects/${apiId(project.id)}`, 'PATCH', {
        name,
        stacks: stacks
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      await refresh();
      setSavedClassification({ name, stacks });
      notify(t('Project classification saved'));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  return (
    <Modal
      title={project.name}
      subtitle={shortPath(project.path)}
      onClose={() => requestDiscard(onClose)}
      wide
      className="project-inspector"
    >
      <div className="project-inspector-nav">
        <nav className="tabs compact" aria-label={t('Project details')}>
          <button
            type="button"
            aria-pressed={view === 'files'}
            className={view === 'files' ? 'active' : ''}
            onClick={() => setView('files')}
          >
            {t('Files')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'setup'}
            className={view === 'setup' ? 'active' : ''}
            onClick={() => setView('setup')}
          >
            {t('Project setup')}
          </button>
        </nav>
        {view === 'files' && (
          <Button variant="secondary" onClick={() => navigate('setup', project.path)}>
            {t('Prepare this project')}
            <ArrowRight size={14} />
          </Button>
        )}
      </div>
      <div className="project-inspector-files" hidden={view !== 'files'}>
        <ProjectFileBrowser {...{ state, project, refresh, notify, navigate }} />
      </div>
      <div className="project-inspector-overview" hidden={view !== 'setup'}>
        <ProjectMaintenance
          {...{ project, state, refresh, notify }}
          onPrepare={() => navigate('setup', project.path)}
        />
        <details className="project-classification">
          <summary>{t('Project name & stack')}</summary>
          {project.discovery === 'configuration' && (
            <Notice>
              {t(
                'Referenced by a user-level project MCP configuration. Project source files have not been scanned.',
              )}
            </Notice>
          )}
          <div className="editor-form">
            <label>
              {t('Display name')}
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              {t('Stack tags')}
              <input value={stacks} onChange={(event) => setStacks(event.target.value)} />
            </label>
            <Button variant="secondary" onClick={() => void save()}>
              {t('Save classification')}
            </Button>
          </div>
          {!!project.workspaces?.length && (
            <div className="workspace-list">
              <p className="eyebrow">{t('WORKSPACES')}</p>
              {project.workspaces.map((workspace) => (
                <p key={workspace.path}>
                  <code>{workspace.path}</code>
                  <span className="muted"> · {workspace.stacks.join(', ')}</span>
                </p>
              ))}
            </div>
          )}
        </details>
        <div className="automation-box">
          <Zap size={20} />
          <h3>{t('Stay ready as you build')}</h3>
          <p>
            {t(
              'When dependencies change, add only snapshots you have explicitly approved. The project needs an applied kit first.',
            )}
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={automationBusy}
              checked={approved}
              onChange={(event) => {
                setAutomationBusy(true);
                void api(`automation/${apiId(project.id)}`, 'PUT', {
                  enabled: event.target.checked,
                })
                  .then(refresh)
                  .then(() => notify(t('Project automation preference saved')))
                  .catch((error) => notify(error.message, true))
                  .finally(() => setAutomationBusy(false));
              }}
            />
            {t('Allow trusted automatic additions')}
          </label>
          <small>
            {t('Active while the local workbench is running. Watcher errors appear in Activity.')}
          </small>
        </div>
        <p className="field-help">
          {t('Detected ')}
          {formatDate(project.detectedAt)}
        </p>
      </div>
    </Modal>
  );
}
