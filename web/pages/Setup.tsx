import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  Layers2,
  Plus,
  ScanLine,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Entry, Finding, Project, Provider } from '../../src/core/model';
import { slug } from '../../src/core/names';
import type { FilePreview, PlanView } from '../../src/core/plan-view';
import type { Recommendation } from '../../src/core/recommend';
import { api, apiId, shortPath } from '../api';
import { Badge, Button, Modal, Notice, SearchBox, Spinner } from '../components';
import { useDraftGuard } from '../drafts';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { ProjectPathInput } from '../ProjectPathInput';
import { Select } from '../Select';
import { EntryDetail } from './EntryDetail';

interface Detection {
  project: Project;
  presetId: string;
  recommendations: Recommendation[];
  missing: string[];
  warnings?: string[];
  guidanceIssues?: { id: string; name: string; findings: Finding[] }[];
}
const presetGlyphs: Record<string, string> = {
  expo: '◈',
  'react-native': '✳',
  ios: '⌘',
  android: '◉',
  macos: '▣',
  web: '◎',
  next: 'N',
  'bun-hono': '↯',
  go: 'Go',
  backend: '{ }',
  mobile: '▯',
  base: '◇',
};

export function Setup({
  state,
  refresh,
  notify,
  navigate,
  initialPath,
}: PageProps & { initialPath: string }): ReactNode {
  const [path, setPath] = useState(initialPath);
  const [requirements, setRequirements] = useState('');
  const [preset, setPreset] = useState('auto');
  const [providers, setProviders] = useState<Provider[]>(state.settings.defaultProviders);
  const [detected, setDetected] = useState<Detection>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [browse, setBrowse] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [inspecting, setInspecting] = useState<string>();
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [plan, setPlan] = useState<PlanView>();
  const detectionRequest = useRef<{ generation: number; controller?: AbortController }>({
    generation: 0,
  });
  const resetDetection = useCallback(() => {
    detectionRequest.current.generation++;
    detectionRequest.current.controller?.abort();
    setDetected(undefined);
    setSelected([]);
    setReviewed(false);
    setBusy(false);
  }, []);
  const signature = JSON.stringify({ path, requirements, preset, providers, selected });
  const currentDraft = useRef(signature);
  currentDraft.current = signature;
  const [savedDraft, setSavedDraft] = useState(signature);
  useDraftGuard(!plan && signature !== savedDraft, t('Project setup'));
  useEffect(() => {
    if (initialPath) {
      setPath(initialPath);
      resetDetection();
    }
  }, [initialPath, resetDetection]);
  useEffect(
    () => () => {
      detectionRequest.current.generation++;
      detectionRequest.current.controller?.abort();
    },
    [],
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      const entry = state.entries.find((value) => value.id === id)!;
      return [
        ...current.filter((value) => {
          const other = state.entries.find((item) => item.id === value);
          return other?.kind !== entry.kind || slug(other?.name || '') !== slug(entry.name);
        }),
        id,
      ];
    });
  const selectedEntries = state.entries.filter((entry) => selected.includes(entry.id));
  async function detect(): Promise<void> {
    detectionRequest.current.controller?.abort();
    const controller = new AbortController();
    const generation = ++detectionRequest.current.generation;
    detectionRequest.current.controller = controller;
    setBusy(true);
    try {
      const result = await api<Detection>(
        'detect',
        'POST',
        {
          projectPath: path,
          requirements,
          ...(preset !== 'auto' ? { presetId: preset } : {}),
        },
        controller.signal,
      );
      if (generation !== detectionRequest.current.generation || controller.signal.aborted) return;
      setDetected(result);
      setSelected(
        result.recommendations.filter((value) => value.selected).map((value) => value.entry.id),
      );
    } catch (error) {
      if (generation !== detectionRequest.current.generation || controller.signal.aborted) return;
      notify(error instanceof Error ? error.message : t('Could not inspect project'), true);
    } finally {
      if (generation === detectionRequest.current.generation) setBusy(false);
    }
  }
  async function prepare(): Promise<void> {
    const generation = detectionRequest.current.generation;
    const requestedDraft = signature;
    setBusy(true);
    try {
      const prepared = await api<PlanView>('plans', 'POST', {
        projectPath: path,
        requirements,
        presetId: detected?.presetId || (preset !== 'auto' ? preset : undefined),
        providers,
        entryIds: selected,
        includeRules: true,
        allowReviewed: reviewed,
        replaceExisting,
      });
      if (
        generation === detectionRequest.current.generation &&
        requestedDraft === currentDraft.current
      )
        setPlan(prepared);
    } catch (error) {
      if (generation !== detectionRequest.current.generation) return;
      notify(error instanceof Error ? error.message : t('Could not prepare setup'), true);
    } finally {
      if (generation === detectionRequest.current.generation) setBusy(false);
    }
  }
  return (
    <>
      <div className="setup-heading">
        <div>
          <h1>{t('Set up a project')}</h1>
          <p>{t('Choose a folder, a kit and your agents. Review the files before applying.')}</p>
        </div>
      </div>
      <div className="setup-layout">
        <div className="setup-form">
          <section className="form-section">
            <SectionTitle
              number="01"
              title={t('Project')}
              detail={t('New or existing project directory.')}
            />
            <div className="setup-project-fields">
              <div>
                <label className="field-label" htmlFor="project-path">
                  {t('Project directory')}
                </label>
                <ProjectPathInput
                  value={path}
                  projects={state.projects}
                  onValueChange={(next) => {
                    setPath(next);
                    resetDetection();
                  }}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="preset-choice">
                  {t('Starting preset')}
                </label>
                <Select
                  id="preset-choice"
                  label={t('Starting preset')}
                  searchable
                  value={preset}
                  onValueChange={(next) => {
                    setPreset(next);
                    const chosen = state.presets.find((value) => value.id === next);
                    if (chosen) setProviders(chosen.providers);
                    resetDetection();
                  }}
                  options={[
                    { value: 'auto', label: t('Detect from the project') },
                    ...state.presets.map((value) => ({ value: value.id, label: value.name })),
                  ]}
                />
              </div>
            </div>
            <label className="field-label" htmlFor="requirements">
              {t('What are you making? ')}
              <span>{t('Optional')}</span>
            </label>
            <textarea
              id="requirements"
              rows={2}
              value={requirements}
              onChange={(event) => {
                setRequirements(event.target.value);
                resetDetection();
              }}
              placeholder={t('An Expo app with Better Auth and a Hono API…')}
            />
            <Button
              disabled={!path.trim() || busy}
              onClick={() => void detect()}
              variant={detected ? 'secondary' : 'primary'}
            >
              {busy && !detected ? (
                <Spinner text={t('Reading the project')} />
              ) : (
                <>
                  <ScanLine size={16} />
                  {detected ? t('Inspect again') : t('Build my kit')}
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
            {detected && (
              <div className="detection-result">
                <CheckCircle2 size={17} />
                <div>
                  <strong>{detected.project.name}</strong>
                  <span>
                    {detected.project.stacks.length
                      ? detected.project.stacks.join(' · ')
                      : t('No stack detected — your preset will guide setup')}
                  </span>
                </div>
                <Badge tone="green">
                  {state.presets.find((value) => value.id === detected.presetId)?.name}
                </Badge>
              </div>
            )}
            {detected?.project.warnings?.map((warning) => (
              <Notice key={warning} tone="warning">
                {warning}
              </Notice>
            ))}
            {detected?.warnings?.map((warning) => (
              <Notice key={warning} tone="warning">
                {warning}
              </Notice>
            ))}
            {Boolean(detected?.project.workspaces?.length) && (
              <p className="field-help">
                {detected?.project.workspaces?.length}
                {t(' workspaces included in this project’s recommendations.')}
              </p>
            )}
          </section>
          <section className="form-section">
            <SectionTitle
              number="02"
              title={t('Choose your agents')}
              detail="One kit. Written in each agent’s own format."
            />
            <div className="agent-grid">
              {state.adapters.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  className={`agent-choice ${providers.includes(agent.id) ? 'chosen' : ''}`}
                  onClick={() =>
                    setProviders((current) =>
                      current.includes(agent.id)
                        ? current.filter((value) => value !== agent.id)
                        : [...current, agent.id],
                    )
                  }
                  aria-pressed={providers.includes(agent.id)}
                >
                  <span className={`agent-symbol ${agent.id}`}>
                    {agent.id === 'claude'
                      ? '✳'
                      : agent.id === 'codex'
                        ? '◉'
                        : agent.id === 'kiro'
                          ? '◒'
                          : agent.id === 'opencode'
                            ? '◧'
                            : agent.id === 'grok'
                              ? '𝕏'
                              : '△'}
                  </span>
                  <span>{agent.name}</span>
                  <span className="checkbox">
                    {providers.includes(agent.id) && <Check size={11} />}
                  </span>
                </button>
              ))}
            </div>
            <p className="field-help">
              {t(
                'Using T3? Select its underlying agent harness. Model choice and skill discovery are separate.',
              )}
            </p>
          </section>
          <section className="form-section">
            <SectionTitle
              number="03"
              title={t('Project kit')}
              detail="A focused kit, with room for your own choices."
            />
            {!detected ? (
              <div className="kit-placeholder">
                <Layers2 size={20} strokeWidth={1.4} />
                <p role="status">
                  {busy
                    ? t('Inspecting the selected project…')
                    : path.trim()
                      ? t(
                          'Project selected. Use Build my kit to inspect its stack and see recommendations. Nothing will be written.',
                        )
                      : t('Choose a project to see recommendations from your library.')}
                </p>
              </div>
            ) : (
              <>
                <div className="kit-results">
                  {detected.recommendations.length ? (
                    detected.recommendations.map((value) => (
                      <CapabilityRow
                        key={value.entry.id}
                        entry={value.entry}
                        selected={selected.includes(value.entry.id)}
                        toggle={() => toggle(value.entry.id)}
                        reason={value.reasons[0]}
                      />
                    ))
                  ) : (
                    <Notice>
                      {t(
                        'No matching skills yet. Browse the library or add a source. Your scoped directives can still be applied.',
                      )}
                    </Notice>
                  )}
                </div>
                {detected.missing.length > 0 && (
                  <p className="field-help">
                    {t('Not in your library: ')}
                    {detected.missing.join(', ')}.{' '}
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => navigate('library')}
                    >
                      {t('Find or import skills ')}
                      <ArrowRight size={12} />
                    </button>
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              className="browse-toggle"
              onClick={() => setBrowse((value) => !value)}
              aria-expanded={browse}
            >
              <Plus size={15} />
              {t(' Add from library')} <ChevronDown size={15} className={browse ? 'rotated' : ''} />
            </button>
            {browse && (
              <div className="browse-library">
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder={t('Search skills and MCP servers…')}
                />
                <div className="browse-results">
                  {state.entries
                    .filter(
                      (entry) =>
                        !entry.archived &&
                        ['skill', 'mcp'].includes(entry.kind) &&
                        `${entry.name} ${entry.tags.join(' ')}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .slice(0, 40)
                    .map((entry) => (
                      <CapabilityRow
                        key={entry.id}
                        entry={entry}
                        selected={selected.includes(entry.id)}
                        toggle={() => toggle(entry.id)}
                      />
                    ))}
                </div>
              </div>
            )}
            {detected?.guidanceIssues?.map((rule) => (
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
            {(selectedEntries.some((entry) =>
              entry.findings.some((finding) => finding.level === 'review'),
            ) ||
              detected?.guidanceIssues?.some((rule) =>
                rule.findings.some((finding) => finding.level === 'review'),
              )) && (
              <label className="check-label review-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />{' '}
                {t('I reviewed the selected content’s flagged instructions.')}{' '}
                {selectedEntries.some((entry) =>
                  entry.findings.some((finding) => finding.level !== 'info'),
                ) && (
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() =>
                      setInspecting(
                        selectedEntries.find((entry) =>
                          entry.findings.some((finding) => finding.level !== 'info'),
                        )?.id,
                      )
                    }
                  >
                    {t('Inspect findings')}
                  </button>
                )}
              </label>
            )}
          </section>
          <details className="advanced-setup">
            <summary>{t('Existing installations')}</summary>
            <label className="check-label">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              {t('Replace differing skill files in this reviewed plan')}
            </label>
            <p className="field-help">
              {t(
                'Original bytes are retained for rollback. Symbolic links outside this project are protected. Keep this off for automatic additions.',
              )}
            </p>
          </details>
          <div className="setup-submit">
            <div>
              <strong>
                {selected.length}
                {t(' capabilities')}
              </strong>
              <span>{t('+ scoped project guidance')}</span>
            </div>
            <Button
              disabled={!path.trim() || !detected || !providers.length || busy}
              onClick={() => void prepare()}
            >
              {busy && detected ? (
                <Spinner text={t('Preparing changes')} />
              ) : (
                <>
                  {t('Review setup ')}
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </div>
        </div>
        <aside className="setup-aside">
          <div className="kit-note">
            <h2>{t('What gets added')}</h2>
            <ul>
              <li>
                <Check size={14} />
                {t('Selected skills')}
              </li>
              <li>
                <Check size={14} />
                {t('MCP configuration')}
              </li>
              <li>
                <Check size={14} />
                {t('Project guidance')}
              </li>
            </ul>
            <p>{t('Nothing is written until you review and apply the plan.')}</p>
          </div>
          <div className="preset-shortcuts">
            <div className="section-caption">
              <span>{t('Presets')}</span>
              <button
                type="button"
                onClick={() => navigate('presets')}
                aria-label={t('View all presets')}
              >
                <ArrowRight size={16} />
              </button>
            </div>
            {state.presets
              .filter((value) => ['expo', 'ios', 'web', 'bun-hono'].includes(value.id))
              .map((value) => (
                <button
                  type="button"
                  key={value.id}
                  onClick={() => {
                    setPreset(value.id);
                    setProviders(value.providers);
                    resetDetection();
                  }}
                  className={preset === value.id ? 'selected' : ''}
                >
                  <span className="preset-glyph">{presetGlyphs[value.id] || '◇'}</span>
                  <span>
                    {value.name}
                    <small>{value.stacks.slice(-2).join(' · ')}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
          </div>
          {!state.entries.length && (
            <div className="library-nudge">
              <p>{t('Your library is waiting.')}</p>
              <span>{t('Find skills already on this machine, or add your first source.')}</span>
              <Button variant="secondary" onClick={() => navigate('library')}>
                {t('Build your library ')}
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
        </aside>
      </div>
      <ModalPresence>
        {inspecting && (
          <EntryDetail
            state={state}
            refresh={refresh}
            notify={notify}
            navigate={navigate}
            id={inspecting}
            onClose={() => setInspecting(undefined)}
          />
        )}
      </ModalPresence>
      <ModalPresence>
        {plan && (
          <PlanReview
            plan={plan}
            onClose={() => setPlan(undefined)}
            onApplied={() => {
              setSavedDraft(signature);
              void refresh();
            }}
            notify={notify}
          />
        )}
      </ModalPresence>
    </>
  );
}

function SectionTitle({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}): ReactNode {
  return (
    <div className="section-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function CapabilityRow({
  entry,
  selected,
  toggle,
  reason,
}: {
  entry: Omit<Entry, 'body'>;
  selected: boolean;
  toggle: () => void;
  reason?: string;
}): ReactNode {
  const flagged = entry.findings.some((finding) => finding.level !== 'info');
  return (
    <button
      type="button"
      className={`capability-row ${selected ? 'selected' : ''}`}
      onClick={toggle}
      aria-pressed={selected}
    >
      <span className="checkbox">{selected && <Check size={12} />}</span>
      <div>
        <strong>{entry.name}</strong>
        <span>{reason || entry.description.slice(0, 105)}</span>
      </div>
      {flagged && (
        <Badge tone={entry.findings.some((finding) => finding.level === 'block') ? 'red' : 'amber'}>
          {t('Review')}
        </Badge>
      )}
      <Badge>{entry.kind}</Badge>
    </button>
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
