import { ArrowRight, ArrowUpRight, FolderOpen, Plus, Zap } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Project, Rule } from '../../src/core/model';
import type { PlanView } from '../../src/core/plan-view';
import { AiAssist } from '../AiAssist';
import { api, apiId, formatDate, shortPath } from '../api';
import {
  Badge,
  Button,
  CopyButton,
  Empty,
  Modal,
  Notice,
  PageHeader,
  SearchBox,
  Spinner,
} from '../components';
import { useDraftGuard } from '../drafts';
import { countText, PAGE_SIZE } from '../format';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { RuleEditor } from './Directives';
import { type DocumentChoice, ProjectDocuments } from './ProjectDocuments';
import { PlanReview } from './Setup';

export function Projects(props: PageProps): ReactNode {
  const { state, navigate } = props;
  const [query, setQuery] = useState('');
  const [stack, setStack] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Project>();
  const projects = state.projects.filter(
    (project) =>
      `${project.name} ${project.path}`.toLowerCase().includes(query.toLowerCase()) &&
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
                    onClick={() => setSelected(project)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
                <button type="button" className="project-name" onClick={() => setSelected(project)}>
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
          <ProjectDetail {...props} project={selected} onClose={() => setSelected(undefined)} />
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
  const [document, setDocument] = useState<{
    path: string;
    content: string;
    digest: string;
    redacted: boolean;
    readOnly?: boolean;
    sourcePath?: string;
    scope?: string;
    kind?: string;
  }>();
  const [draft, setDraft] = useState('');
  const [aiDirty, setAiDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanView>();
  const [rule, setRule] = useState<Rule>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(project.name);
  const [stacks, setStacks] = useState(project.stacks.join(', '));
  const [savedClassification, setSavedClassification] = useState({
    name: project.name,
    stacks: project.stacks.join(', '),
  });
  const [ruleDirty, setRuleDirty] = useState(false);
  const guardRule = useDraftGuard(ruleDirty, t('Promoted directive'));
  const guard = useDraftGuard(
    aiDirty ||
      name !== savedClassification.name ||
      stacks !== savedClassification.stacks ||
      Boolean(editing && document && draft !== document.content),
    t('Project details'),
  );
  const approved = state.approvals?.find((value) => value.id === project.id)?.enabled || false;
  async function openDocument(file: DocumentChoice | string): Promise<void> {
    setBusy(true);
    try {
      const value = await api<NonNullable<typeof document>>('document', 'POST', {
        projectId: project.id,
        ...(typeof file === 'string'
          ? { path: file }
          : file.id
            ? { documentId: file.id }
            : { path: file.path }),
      });
      setDocument(value);
      setDraft(value.content);
      setEditing(false);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
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
      onClose={() => guard(onClose)}
      wide
    >
      <div className="project-detail-layout">
        <div>
          <p className="eyebrow">{t('PROJECT CLASSIFICATION')}</p>
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
          {project.workspaces?.length ? (
            <div className="workspace-list">
              <p className="eyebrow">{t('WORKSPACES')}</p>
              {project.workspaces.map((workspace) => (
                <p key={workspace.path}>
                  <code>{workspace.path}</code>
                  <span className="muted"> · {workspace.stacks.join(', ')}</span>
                </p>
              ))}
            </div>
          ) : null}
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
                checked={approved}
                onChange={(event) => {
                  void api(`automation/${apiId(project.id)}`, 'PUT', {
                    enabled: event.target.checked,
                  })
                    .then(refresh)
                    .then(() => notify('Project automation preference saved'))
                    .catch((error) => notify(error.message, true));
                }}
              />
              {t('Allow trusted automatic additions')}
            </label>
            <small>
              {t('Active while the local workbench is running. Watcher errors appear in Activity.')}
            </small>
          </div>
        </div>
        <div>
          <ProjectDocuments
            project={project}
            sharedFiles={state.globalAiFiles}
            sharedWarnings={state.globalAiWarnings}
            onOpen={(file) => guard(() => void openDocument(file))}
          />
          {busy && <Spinner text={t('Reading document')} />}
          {document && (
            <>
              {document.readOnly && (
                <Notice>
                  {t(
                    'This file is stored outside the editable project guidance. You can read it or create a reviewed project directive from selected guidance.',
                  )}
                </Notice>
              )}
              <div className="code-toolbar">
                <span title={document.sourcePath}>
                  {document.sourcePath ? shortPath(document.sourcePath) : document.path}
                </span>
                <CopyButton text={document.content} />
              </div>
              {document.redacted && (
                <Notice tone="warning">
                  {t(
                    'Sensitive-looking text is masked. Editing is disabled to preserve the original.',
                  )}
                </Notice>
              )}
              {editing ? (
                <div className="editor-form">
                  <AiAssist
                    onDirtyChange={setAiDirty}
                    settings={state.settings}
                    task="text"
                    label={t('Improve or format with AI')}
                    current={draft}
                    onUse={(proposal) => {
                      if (proposal.kind === 'text') setDraft(proposal.text);
                    }}
                  />
                  <label htmlFor="project-document-content">{t('Document content')}</label>
                  <textarea
                    id="project-document-content"
                    className="code-editor"
                    rows={16}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                  />
                </div>
              ) : (
                <pre className="content-preview document-preview">{document.content}</pre>
              )}
              <div className="button-row">
                <Button
                  variant="secondary"
                  disabled={document.redacted || document.readOnly}
                  onClick={() => {
                    if (editing && (aiDirty || draft !== document.content))
                      guard(() => setEditing(false));
                    else setEditing(!editing);
                  }}
                >
                  {editing ? t('Cancel editing') : t('Edit document')}
                </Button>
                {editing && (
                  <Button
                    disabled={busy || draft === document.content}
                    onClick={() => {
                      setBusy(true);
                      void api<PlanView>('document-plan', 'POST', {
                        projectId: project.id,
                        path: document.path,
                        digest: document.digest,
                        content: draft,
                      })
                        .then(setPlan)
                        .catch((error) => notify(error.message, true))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('Review document changes')}
                  </Button>
                )}
                {!['config', 'plugin', 'hook'].includes(document.kind || '') && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRule({
                        id: '',
                        name: `Guidance from ${document.path}`,
                        scope: project.id,
                        content: draft,
                        enabled: true,
                        priority: 50,
                        provenance: `Promoted from ${project.name}/${document.path}`,
                      })
                    }
                  >
                    {t('Create a reusable directive ')}
                    <ArrowRight size={14} />
                  </Button>
                )}
              </div>
            </>
          )}
          <p className="field-help">
            {t(
              'Files are read on request. Memory never becomes session history or automatic global guidance.',
            )}
          </p>
        </div>
      </div>
      <ModalPresence>
        {rule && (
          <Modal
            title={t('Promote selected guidance')}
            subtitle={t(
              'Starts scoped to this project. Review private details before choosing a broader scope.',
            )}
            onClose={() => guardRule(() => setRule(undefined))}
            wide
          >
            <RuleEditor
              state={state}
              refresh={refresh}
              notify={notify}
              navigate={navigate}
              rule={rule}
              onRemove={() => setRule(undefined)}
              onDirtyChange={setRuleDirty}
            />
          </Modal>
        )}
      </ModalPresence>
      <ModalPresence>
        {plan && (
          <PlanReview
            plan={plan}
            onClose={() => setPlan(undefined)}
            onApplied={() => {
              setEditing(false);
              void openDocument(document!.path);
              void refresh();
            }}
            notify={notify}
          />
        )}
      </ModalPresence>
      <div className="modal-actions">
        <span className="muted">
          {t('Detected ')}
          {formatDate(project.detectedAt)}
        </span>
        <Button
          onClick={() => {
            navigate('setup', project.path);
          }}
        >
          {t('Review project setup ')}
          <ArrowRight size={16} />
        </Button>
      </div>
    </Modal>
  );
}
