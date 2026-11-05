import { ArrowRight, FileCode2, FolderOpen, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { FilePreview, PlanView } from '../../src/core/plan-view';
import { api, apiId, shortPath } from '../api';
import { Badge, Button, Modal, Notice, Spinner } from '../components';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { ProjectPathInput } from '../ProjectPathInput';
import { type SetupProps, useProjectSetup } from '../useProjectSetup';
import { EntryDetail } from './EntryDetail';
import { KitRow } from './KitRows';
import { SetupKitPicker } from './SetupKitPicker';
import { SetupOptions } from './SetupOptions';

export function Setup(props: SetupProps): ReactNode {
  const { state, navigate, active = true } = props;
  const setup = useProjectSetup(props);
  const [picker, setPicker] = useState(false);
  const [inspecting, setInspecting] = useState<string>();
  useEffect(() => {
    if (!active) {
      setPicker(false);
      setInspecting(undefined);
    }
  }, [active]);
  const current = setup.path === setup.candidatePath.trim();
  const selectedEntries = state.entries.filter((entry) => setup.selected.includes(entry.id));
  const unavailable = setup.selected.filter(
    (id) => !state.entries.some((entry) => entry.id === id),
  );
  const recommendations = setup.detected?.recommendations || [];
  const extra = recommendations.filter((item) => !setup.selected.includes(item.entry.id));
  const flagged = selectedEntries.find((entry) =>
    entry.findings.some((finding) => finding.level !== 'info'),
  );
  const needsReview =
    selectedEntries.some((entry) => entry.findings.some((finding) => finding.level === 'review')) ||
    setup.detected?.guidanceIssues?.some((rule) =>
      rule.findings.some((finding) => finding.level === 'review'),
    );
  const canReview =
    current &&
    !!setup.detected &&
    !setup.needsInspection &&
    !setup.busy &&
    !!setup.providers.length &&
    !unavailable.length;
  const refreshKit = () => {
    if (current) void setup.inspect();
    else setup.chooseProject(setup.candidatePath);
  };
  return (
    <>
      <div className="setup-heading">
        <div>
          <h1>{t('Set up a project')}</h1>
          <p>{t('Choose a folder. We’ll suggest a focused kit.')}</p>
        </div>
      </div>
      <div className="setup-workspace">
        <section className="setup-project-section" aria-label={t('Project')}>
          <label className="field-label" htmlFor="project-path">
            {t('Project directory')}
          </label>
          <ProjectPathInput
            value={setup.candidatePath}
            projects={state.projects}
            onValueChange={setup.changeCandidate}
            onCommit={setup.chooseProject}
            active={active}
          />
          <p className="field-help">
            {t('Choose a known project or browse to a folder. Inspection only reads files.')}
          </p>
          {!!setup.candidatePath.trim() &&
            (!current || (setup.needsInspection && !setup.detected)) && (
              <Button disabled={setup.busy} onClick={refreshKit}>
                {setup.busy ? (
                  <Spinner text={t('Reading the project')} />
                ) : (
                  <>
                    {current && setup.detected ? t('Update kit') : t('Build my kit')}
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            )}
          {setup.busy && !setup.detected && current && (
            <p role="status">
              <Spinner text={t('Inspecting the selected project…')} />
            </p>
          )}
          {setup.inspectionError && <Notice tone="warning">{setup.inspectionError}</Notice>}
          {!setup.path && !setup.candidatePath && (
            <>
              {state.projects.length > 0 && (
                <div className="setup-known-projects">
                  <h2>{t('Known projects')}</h2>
                  {state.projects.slice(0, 6).map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => setup.chooseProject(project.path)}
                    >
                      <FolderOpen size={17} />
                      <span>
                        <strong>{project.name}</strong>
                        <small>{shortPath(project.path)}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              <p className="field-help">
                {t('Nothing is written until you review and apply the plan.')}
              </p>
            </>
          )}
          {setup.detected && current && (
            <div className="detection-result">
              <div>
                <strong>{setup.detected.project.name}</strong>
                <span>
                  {setup.detected.project.stacks.length
                    ? setup.detected.project.stacks.join(' · ')
                    : t('No stack detected — your preset will guide setup')}
                </span>
              </div>
              <Badge>
                {state.presets.find((item) => item.id === setup.detected?.presetId)?.name}
              </Badge>
            </div>
          )}
        </section>
        {setup.path && (
          <>
            {current && setup.detected && (
              <>
                {[
                  ...new Set([
                    ...(setup.detected.project.warnings || []),
                    ...(setup.detected.warnings || []),
                  ]),
                ].map((warning) => (
                  <Notice key={warning} tone="warning">
                    {warning}
                  </Notice>
                ))}
                <section className="setup-kit-section" aria-labelledby="project-kit-heading">
                  <div className="setup-kit-heading">
                    <div>
                      <h2 id="project-kit-heading">{t('Project kit')}</h2>
                      <p>{t('Only selected items go into the plan.')}</p>
                    </div>
                    <Button variant="secondary" onClick={() => setPicker(true)}>
                      <Plus size={15} />
                      {t('Add from library')}
                    </Button>
                  </div>
                  {setup.needsInspection && (
                    <Notice>
                      {t('Setup details changed. Update the kit before reviewing setup.')}{' '}
                      <button
                        type="button"
                        className="inline-button"
                        disabled={setup.busy}
                        onClick={() => void setup.inspect()}
                      >
                        {t('Update kit')}
                      </button>
                    </Notice>
                  )}
                  {unavailable.length > 0 && (
                    <Notice tone="warning">
                      {t(
                        'A selected snapshot is no longer in Library. Review is paused until you remove the unavailable selection.',
                      )}{' '}
                      <button
                        type="button"
                        className="inline-button"
                        onClick={() => {
                          for (const id of unavailable) setup.toggleEntry(id);
                        }}
                      >
                        {t('Remove unavailable selections')}
                      </button>
                    </Notice>
                  )}
                  <div className="kit-results">
                    {selectedEntries.map((entry) => (
                      <KitRow
                        key={entry.id}
                        entry={entry}
                        selected
                        toggle={() => setup.toggleEntry(entry.id)}
                        inspect={() => setInspecting(entry.id)}
                        reason={
                          recommendations.find((item) => item.entry.id === entry.id)?.reasons[0]
                        }
                      />
                    ))}
                  </div>
                  {!selectedEntries.length && (
                    <Notice>
                      {t(
                        'No Skills or MCP servers selected. Add from Library, or continue with your scoped directives.',
                      )}
                    </Notice>
                  )}
                  {extra.length > 0 && (
                    <details className="setup-other-suggestions">
                      <summary>
                        {t('More suggestions ({{count}})', { count: extra.length })}
                      </summary>
                      <div className="kit-results">
                        {extra.map((item) => (
                          <KitRow
                            key={item.entry.id}
                            entry={item.entry}
                            selected={false}
                            toggle={() => setup.toggleEntry(item.entry.id)}
                            inspect={() => setInspecting(item.entry.id)}
                            reason={item.reasons[0]}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                  {setup.detected.missing.length > 0 && (
                    <details className="setup-other-suggestions">
                      <summary>
                        {t('Preset references outside Library ({{count}})', {
                          count: setup.detected.missing.length,
                        })}
                      </summary>
                      <p className="field-help">
                        {t(
                          'These references are not installed. Review your preset if a pinned snapshot is missing; you can import other suggestions later.',
                        )}
                      </p>
                      <p className="field-help">
                        {setup.detected.missing.join(', ')}.{' '}
                        <button
                          type="button"
                          className="inline-button"
                          onClick={() => navigate('library')}
                        >
                          {t('Find or import skills')}
                        </button>
                      </p>
                    </details>
                  )}
                  {setup.detected.guidanceIssues?.map((rule) => (
                    <details className="guidance-finding" key={rule.id}>
                      <summary>
                        {t('Directive: ')}
                        {rule.name}
                      </summary>
                      {rule.findings.map((finding) => (
                        <Notice tone="warning" key={finding.code}>
                          {finding.message}
                        </Notice>
                      ))}
                      <p className="field-help">
                        {t(
                          'Review this directive in Directives. Credential findings cannot be overridden.',
                        )}
                      </p>
                    </details>
                  ))}
                  {needsReview && (
                    <div className="review-check">
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={setup.reviewed}
                          onChange={(event) => setup.setReviewed(event.target.checked)}
                        />
                        {t('I reviewed the selected content’s flagged instructions.')}
                      </label>
                      {flagged && (
                        <button
                          type="button"
                          className="inline-button"
                          onClick={() => setInspecting(flagged.id)}
                        >
                          {t('Inspect findings')}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
            {current && active && <SetupOptions setup={setup} state={state} />}
            {current && setup.detected && (
              <div className="setup-submit">
                <div>
                  <strong>
                    {t('{{skills}} Skills · {{mcp}} MCP', {
                      skills: selectedEntries.filter((entry) => entry.kind === 'skill').length,
                      mcp: selectedEntries.filter((entry) => entry.kind === 'mcp').length,
                    })}
                  </strong>
                  <span>{t('+ scoped project guidance')}</span>
                </div>
                <Button disabled={!canReview} onClick={() => void setup.prepare()}>
                  {setup.busy ? (
                    <Spinner text={t('Working…')} />
                  ) : (
                    <>
                      {t('Review setup')}
                      <ArrowRight size={16} />
                    </>
                  )}
                </Button>
              </div>
            )}
            {current && setup.detected && (
              <p className="field-help">
                {t('Next: inspect the exact file changes, then choose Apply.')}
              </p>
            )}
          </>
        )}
      </div>
      <ModalPresence>
        {active && picker && (
          <SetupKitPicker
            state={state}
            selected={setup.selected}
            toggle={setup.toggleEntry}
            inspect={setInspecting}
            onClose={() => setPicker(false)}
            openLibrary={() => {
              setPicker(false);
              navigate('library');
            }}
          />
        )}
      </ModalPresence>
      <ModalPresence>
        {active && inspecting && (
          <EntryDetail {...props} id={inspecting} onClose={() => setInspecting(undefined)} />
        )}
      </ModalPresence>
      <ModalPresence>
        {active && setup.plan && (
          <PlanReview
            plan={setup.plan}
            onClose={() => setup.setPlan(undefined)}
            onApplied={setup.applied}
            notify={props.notify}
          />
        )}
      </ModalPresence>
    </>
  );
}

export function PlanReview({
  plan: initial,
  onClose,
  onApplied,
  notify,
}: {
  plan: PlanView;
  onClose: () => void;
  onApplied: () => void;
  notify: PageProps['notify'];
}): ReactNode {
  const [plan, setPlan] = useState(initial);
  const [file, setFile] = useState(0);
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState(false);
  const change = plan.changes[file];
  const [preview, setPreview] = useState<FilePreview>();
  useEffect(() => {
    let live = true;
    setPreview(undefined);
    if (change)
      void api<FilePreview>(`plans/${apiId(plan.id)}/changes/${change.index}`)
        .then((value) => {
          if (live) setPreview(value);
        })
        .catch((error) => notify(error.message, true));
    return () => {
      live = false;
    };
  }, [plan.id, change, notify]);
  const content = !change
    ? t('Your project already matches this kit.')
    : !preview
      ? t('Loading file preview…')
      : before
        ? preview.before
        : preview.after;
  async function apply(): Promise<void> {
    setBusy(true);
    try {
      setPlan(await api<PlanView>(`plans/${apiId(plan.id)}/apply`, 'POST', {}));
      onApplied();
      notify(t('Project kit applied. Start or reload your agent session.'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('Setup failed'), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        plan.purpose === 'document'
          ? plan.status === 'applied'
            ? t('Document updated.')
            : t('Review document changes')
          : plan.status === 'applied'
            ? t('Your project is ready.')
            : t('Review your setup')
      }
      subtitle={`${shortPath(plan.projectPath)} · ${plan.providers.join(', ')}`}
      onClose={onClose}
      wide
    >
      {plan.status === 'applied' && (
        <Notice>
          <strong>{t('Kit installed.')}</strong>
          {t(
            ' Start a new agent session or use its reload command to discover the new capabilities.',
          )}
        </Notice>
      )}
      <div className="plan-layout">
        <div className="plan-files">
          <p className="eyebrow">
            {plan.changes.length}
            {t(' FILE CHANGES')}
          </p>
          {plan.changes.map((value, index) => (
            <button
              type="button"
              key={value.path}
              className={file === index ? 'active' : ''}
              onClick={() => setFile(index)}
            >
              <FileCode2 size={14} />
              <span>{value.path}</span>
              <Badge
                tone={
                  value.operation === 'remove'
                    ? 'red'
                    : value.operation === 'modify'
                      ? 'amber'
                      : 'green'
                }
              >
                {value.operation === 'remove' ? '−' : value.operation === 'modify' ? 'M' : '+'}
              </Badge>
            </button>
          ))}
        </div>
        <div className="plan-content">
          <div className="code-toolbar">
            <span>{change?.reason || t('No file selected')}</span>
            <div className="segmented">
              <button
                type="button"
                className={before ? 'active' : ''}
                onClick={() => setBefore(true)}
              >
                {t('Before')}
              </button>
              <button
                type="button"
                className={!before ? 'active' : ''}
                onClick={() => setBefore(false)}
              >
                {t('After')}
              </button>
            </div>
          </div>
          {preview && (preview.redacted || preview.truncated) && (
            <Notice>
              {preview.redacted ? t('Sensitive-looking text is masked. ') : ''}
              {preview.truncated
                ? t('Preview is truncated; full bytes remain in the private plan.')
                : ''}
            </Notice>
          )}
          <pre>{content}</pre>
        </div>
      </div>
      <details className="warnings">
        <summary>
          {plan.warnings.length}
          {t(' compatibility notes')}
        </summary>
        {plan.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </details>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          {plan.status === 'applied' ? 'Done' : t('Back to kit')}
        </Button>
        {plan.status === 'planned' && (
          <Button
            onClick={() => void apply()}
            disabled={busy || (plan.changes.length === 0 && !plan.requiresAdoption)}
          >
            {busy ? (
              <Spinner text={t('Applying kit')} />
            ) : (
              <>
                {plan.changes.length
                  ? t('Apply {{count}} changes', { count: plan.changes.length })
                  : t('Confirm reviewed kit')}{' '}
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        )}
      </div>
    </Modal>
  );
}
