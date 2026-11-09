import { ArrowRight, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project, Rule } from '../../src/core/model';
import type { PlanView } from '../../src/core/plan-view';
import { AiAssist } from '../AiAssist';
import { api, shortPath } from '../api';
import { Button, CopyButton, Modal, Notice, Spinner } from '../components';
import { useDraftGuard } from '../drafts';
import { type FilePane, FileScrollArea, FileWorkspace } from '../FileWorkspace';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { RuleEditor } from './Directives';
import { PlanReview } from './PlanReview';
import { type DocumentChoice, ProjectDocuments } from './ProjectDocuments';

interface ProjectDocument {
  path: string;
  content: string;
  digest: string;
  redacted: boolean;
  readOnly?: boolean;
  sourcePath?: string;
  scope?: string;
  kind?: string;
}

export function ProjectFileBrowser({
  state,
  project,
  refresh,
  notify,
  navigate,
}: Pick<PageProps, 'state' | 'refresh' | 'notify' | 'navigate'> & {
  project: Project;
}) {
  const [selection, setSelection] = useState<DocumentChoice>();
  const [document, setDocument] = useState<ProjectDocument>();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<FilePane>('files');
  const [plan, setPlan] = useState<PlanView>();
  const [rule, setRule] = useState<Rule>();
  const [ruleDirty, setRuleDirty] = useState(false);
  const request = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const dirty = aiDirty || Boolean(editing && document && draft !== document.content);
  const guard = useDraftGuard(dirty, t('Document content'));
  const guardRule = useDraftGuard(ruleDirty, t('Promoted directive'));
  useEffect(
    () => () => {
      requestVersion.current++;
      request.current?.abort();
    },
    [],
  );

  async function openDocument(file: DocumentChoice, reload = false): Promise<void> {
    setPane('reader');
    if (!reload && document && selection?.sourcePath === file.sourcePath) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++requestVersion.current;
    setSelection(file);
    setDocument(undefined);
    setEditing(false);
    setAiDirty(false);
    setBusy(false);
    setLoading(true);
    setError('');
    try {
      const value = await api<ProjectDocument>(
        'document',
        'POST',
        {
          projectId: project.id,
          ...(file.id ? { documentId: file.id } : { path: file.path }),
        },
        controller.signal,
      );
      if (version !== requestVersion.current) return;
      setDocument(value);
      setDraft(value.content);
    } catch (failure) {
      if (!controller.signal.aborted && version === requestVersion.current)
        setError(failure instanceof Error ? failure.message : t('Could not read this file.'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  async function review(): Promise<void> {
    if (!document) return;
    const version = requestVersion.current;
    setBusy(true);
    try {
      const next = await api<PlanView>('document-plan', 'POST', {
        projectId: project.id,
        path: document.path,
        digest: document.digest,
        content: draft,
      });
      if (version === requestVersion.current) setPlan(next);
    } catch (failure) {
      if (version === requestVersion.current) notify((failure as Error).message, true);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  return (
    <>
      <FileWorkspace
        pane={pane}
        onPaneChange={setPane}
        selectionKey={selection?.id || selection?.sourcePath}
        sidebar={
          <>
            <ProjectDocuments
              project={project}
              sharedFiles={state.globalAiFiles}
              sharedWarnings={state.globalAiWarnings}
              selectedKey={selection?.id || selection?.sourcePath}
              onOpen={(file) => {
                if (selection?.sourcePath === file.sourcePath && document) setPane('reader');
                else guard(() => void openDocument(file));
              }}
            />
            <p className="file-sidebar-help">
              {t(
                'Files are read on request. Memory never becomes session history or automatic global guidance.',
              )}
            </p>
          </>
        }
      >
        {selection ? (
          <>
            <div className="file-reader-header">
              <div>
                <h3 className="file-reader-heading" tabIndex={-1}>
                  {selection.path}
                </h3>
                <small title={selection.sourcePath}>{shortPath(selection.sourcePath)}</small>
              </div>
              {document && <CopyButton text={document.content} />}
            </div>
            <FileScrollArea className="file-reader-scroll" label={t('File reading area')}>
              {loading && <Spinner text={t('Reading document')} />}
              {error && (
                <div className="file-reader-error" role="alert">
                  <p>{error}</p>
                  <Button variant="secondary" onClick={() => void openDocument(selection, true)}>
                    {t('Try again')}
                  </Button>
                </div>
              )}
              {document && (
                <>
                  {document.readOnly && (
                    <p className="file-reader-note">
                      {t('Read-only source. The original file is preserved.')}
                    </p>
                  )}
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
                </>
              )}
            </FileScrollArea>
            {document && (
              <div className="file-reader-footer button-row">
                <Button
                  variant="secondary"
                  disabled={document.redacted || document.readOnly || busy}
                  onClick={() => {
                    if (editing && dirty)
                      guard(() => {
                        setEditing(false);
                        setAiDirty(false);
                        setDraft(document.content);
                      });
                    else setEditing(!editing);
                  }}
                >
                  {editing ? t('Cancel editing') : t('Edit document')}
                </Button>
                {editing && (
                  <Button
                    disabled={busy || draft === document.content}
                    onClick={() => void review()}
                  >
                    {t('Review document changes')}
                  </Button>
                )}
                {!['config', 'plugin', 'hook'].includes(document.kind || '') && (
                  <Button
                    variant="ghost"
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
            )}
          </>
        ) : (
          <div className="file-reader-empty">
            <FileText size={30} strokeWidth={1.2} />
            <h3>{t('Choose a file to read')}</h3>
            <p>{t('Search or browse the files on the left. Selected content opens here.')}</p>
          </div>
        )}
      </FileWorkspace>
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
              {...{ state, refresh, notify, navigate, rule }}
              onRemove={() => setRule(undefined)}
              onDirtyChange={setRuleDirty}
            />
          </Modal>
        )}
      </ModalPresence>
      <ModalPresence>
        {plan && (
          <PlanReview
            {...{ plan, notify, state, navigate }}
            onClose={() => setPlan(undefined)}
            onApplied={() => {
              setEditing(false);
              if (selection) void openDocument(selection, true);
              void refresh();
            }}
          />
        )}
      </ModalPresence>
    </>
  );
}
