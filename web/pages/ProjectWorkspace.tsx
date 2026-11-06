import { ArrowRight, Check, FileText, FolderOpen, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { MAX_PROJECT_KIT_ENTRIES } from '../../src/core/kit-limits';
import type { Entry, Rule } from '../../src/core/model';
import { AiAssist } from '../AiAssist';
import { shortPath } from '../api';
import { Badge, Button, Modal, Notice, Spinner } from '../components';
import { countText } from '../format';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { ProjectPathInput } from '../ProjectPathInput';
import { Select } from '../Select';
import { setupAdditions } from '../setup-selection';
import type { SetupController } from '../useProjectSetup';
import { KitRow } from './KitRows';

type Metadata = Omit<Entry, 'body'>;
type WorkspaceProps = PageProps & {
  setup: SetupController;
  active: boolean;
  add: (kind?: 'skill' | 'mcp') => void;
  inspect: (id: string) => void;
};

function WorkspaceBrief({
  setup,
  state,
  active,
}: Pick<WorkspaceProps, 'setup' | 'state' | 'active'>) {
  return (
    <section className="workspace-brief" aria-labelledby="workspace-brief-heading">
      <div className="workspace-section-title">
        <div>
          <h2 id="workspace-brief-heading">{t('What are you building?')}</h2>
          <p>{t('A short brief helps us choose a focused kit. You can leave it blank.')}</p>
        </div>
        <span className="workspace-optional">{t('Optional')}</span>
      </div>
      <textarea
        id="requirements"
        aria-label={t('What are you making?')}
        rows={2}
        maxLength={10000}
        value={setup.requirements}
        onChange={(event) => setup.changeRequirements(event.target.value)}
        placeholder={t('An Expo app with Better Auth and a Hono API…')}
      />
      <div className="workspace-brief-actions">
        {active && (
          <AiAssist
            settings={state.settings}
            entries={state.entries}
            task="requirements"
            initialText={setup.requirements}
            defaultIntent="suggest"
            compact
            label={t('Describe the project to AI')}
            current={JSON.stringify({
              requirements: setup.requirements,
              stacks: setup.detected!.project.stacks,
              agents: setup.providers,
              selected: setup.selected,
            })}
            onUse={(draft) => {
              if (draft.kind !== 'requirements') return;
              setup.changeRequirements(draft.text);
              for (const id of setupAdditions(setup.selected, draft.entryIds, state.entries))
                setup.toggleEntry(id);
              void setup.inspect(setup.path, draft.text, setup.preset);
            }}
          />
        )}
        {setup.needsInspection && (
          <Button variant="secondary" disabled={setup.busy} onClick={() => void setup.inspect()}>
            {setup.busy ? <Spinner text={t('Updating suggestions…')} /> : t('Update kit')}
          </Button>
        )}
      </div>
      {setup.needsInspection && (
        <p className="field-help" role="status">
          {t('Setup details changed. Update the kit before reviewing setup.')}
        </p>
      )}
    </section>
  );
}

function WorkspaceAgents({ setup, state }: Pick<WorkspaceProps, 'setup' | 'state'>) {
  return (
    <section className="workspace-agents" aria-labelledby="workspace-agents-heading">
      <div className="workspace-section-title">
        <div>
          <h2 id="workspace-agents-heading">{t('Choose your agents')}</h2>
          <p>{t('One kit. Written in each agent’s own format.')}</p>
        </div>
      </div>
      <div className="agent-grid">
        {state.adapters.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={`agent-choice ${setup.providers.includes(agent.id) ? 'chosen' : ''}`}
            aria-pressed={setup.providers.includes(agent.id)}
            onClick={() => setup.toggleProvider(agent.id)}
          >
            <span className="agent-monogram" aria-hidden="true">
              {agent.name.slice(0, 1)}
            </span>
            <span>{agent.name}</span>
            <span className="checkbox">
              {setup.providers.includes(agent.id) && <Check size={12} />}
            </span>
          </button>
        ))}
      </div>
      <details className="workspace-help">
        <summary>{t('Using T3 or a local model?')}</summary>
        <p>
          {t(
            'In T3, choose the Harness running your session. Ollama and other models are AI Providers, separate from the agents that read project files.',
          )}
        </p>
      </details>
    </section>
  );
}

function WorkspaceKit({
  entries,
  recommendations,
  setup,
  add,
  inspect,
}: {
  entries: Metadata[];
  recommendations: NonNullable<SetupController['detected']>['recommendations'];
  setup: SetupController;
  add: (kind?: 'skill' | 'mcp') => void;
  inspect: (id: string) => void;
}) {
  const extra = recommendations.filter((item) => !setup.selected.includes(item.entry.id));
  return (
    <section className="workspace-kit" aria-labelledby="project-kit-heading">
      <div className="workspace-section-title">
        <div>
          <h2 id="project-kit-heading">{t('Project kit')}</h2>
          <p>{t('Only these selected items go into this project’s setup.')}</p>
        </div>
        <Button variant="secondary" onClick={() => add()}>
          <Plus size={14} />
          {t('Add from library')}
        </Button>
      </div>
      {(['skill', 'mcp'] as const).map((kind) => {
        const items = entries.filter((entry) => entry.kind === kind);
        return (
          <div className="workspace-kit-kind" key={kind}>
            <div className="workspace-kit-kind-heading">
              <strong>{kind === 'skill' ? 'Skills' : 'MCP'}</strong>
              <span>{items.length}</span>
              <p>
                {t(
                  kind === 'skill'
                    ? 'Instructions your agents can use when the task needs them.'
                    : 'Tool connections, configured for the agents you choose.',
                )}
              </p>
            </div>
            {items.length ? (
              <div className="kit-results">
                {items.map((entry) => (
                  <KitRow
                    key={entry.id}
                    entry={entry}
                    selected
                    toggle={() => setup.toggleEntry(entry.id)}
                    inspect={() => inspect(entry.id)}
                    reason={recommendations.find((item) => item.entry.id === entry.id)?.reasons[0]}
                  />
                ))}
              </div>
            ) : (
              <div className="workspace-kit-empty">
                <span>
                  {t(kind === 'skill' ? 'No Skills selected yet.' : 'No MCP servers selected yet.')}
                </span>
                <button type="button" className="inline-button" onClick={() => add(kind)}>
                  {t('Choose from Library')}
                  <Plus size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {extra.length > 0 && (
        <details className="setup-other-suggestions">
          <summary>{t('More suggestions ({{count}})', { count: extra.length })}</summary>
          <div className="kit-results">
            {extra.map((item) => (
              <KitRow
                key={item.entry.id}
                entry={item.entry}
                selected={false}
                toggle={() => setup.toggleEntry(item.entry.id)}
                inspect={() => inspect(item.entry.id)}
                reason={item.reasons[0]}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function WorkspaceGuidance({
  rules,
  onRead,
  onManage,
}: {
  rules: Rule[];
  onRead: (rule: Rule) => void;
  onManage: () => void;
}) {
  return (
    <section className="workspace-guidance" aria-labelledby="workspace-guidance-heading">
      <div className="workspace-section-title">
        <div>
          <h2 id="workspace-guidance-heading">{t('How your agents should work')}</h2>
          <p>
            {t(
              'Your applicable Directives become project guidance. Existing authored instructions are preserved.',
            )}
          </p>
        </div>
        <button type="button" className="inline-button" onClick={onManage}>
          {t('Manage Directives')}
        </button>
      </div>
      {rules.length ? (
        <div className="workspace-rule-list">
          {rules.map((rule) => (
            <button type="button" key={rule.id} onClick={() => onRead(rule)}>
              <FileText size={16} />
              <span>{rule.name}</span>
              <small>{rule.scope}</small>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      ) : (
        <p className="field-help">
          {t('No shared Directives apply. Existing project guidance stays in place.')}
        </p>
      )}
    </section>
  );
}

export function ProjectWorkspace({ setup, state, navigate, active, add, inspect }: WorkspaceProps) {
  const [reading, setReading] = useState<Rule>();
  const detected = setup.detected!;
  const current = setup.path === setup.candidatePath.trim();
  const selected = state.entries.filter((entry) => setup.selected.includes(entry.id));
  const missing = setup.selected.filter((id) => !state.entries.some((entry) => entry.id === id));
  const rules = state.rules.filter((rule) => detected.applicableRuleIds?.includes(rule.id));
  const flagged = selected.find((entry) =>
    entry.findings.some((finding) => finding.level !== 'info'),
  );
  const blocked =
    selected.some((entry) => entry.findings.some((finding) => finding.level === 'block')) ||
    detected.guidanceIssues?.some((rule) =>
      rule.findings.some((finding) => finding.level === 'block'),
    );
  const needsReview =
    selected.some((entry) => entry.findings.some((finding) => finding.level === 'review')) ||
    detected.guidanceIssues?.some((rule) =>
      rule.findings.some((finding) => finding.level === 'review'),
    );
  const canReview =
    current &&
    !setup.needsInspection &&
    !setup.busy &&
    !!setup.providers.length &&
    !missing.length &&
    !blocked &&
    (!needsReview || setup.reviewed) &&
    setup.selected.length <= MAX_PROJECT_KIT_ENTRIES;
  return (
    <div className="project-workspace">
      <div className="workspace-heading">
        <div className="detection-result workspace-project-identity">
          <span className="workspace-project-icon">
            <FolderOpen size={24} />
          </span>
          <div>
            <p>{t('Project workspace')}</p>
            <h1>
              <strong>{detected.project.name}</strong>
            </h1>
          </div>
        </div>
        <button type="button" className="inline-button" onClick={setup.startNewProject}>
          {t('Start another project')}
          <Plus size={14} />
        </button>
      </div>
      <div className="workspace-path">
        <label className="sr-only" htmlFor="project-path">
          {t('Project directory')}
        </label>
        <ProjectPathInput
          value={setup.candidatePath}
          projects={state.projects}
          onValueChange={setup.changeCandidate}
          onCommit={setup.chooseProject}
          active={active}
        />
        {!current && (
          <Button disabled={setup.busy} onClick={() => setup.chooseProject(setup.candidatePath)}>
            {t('Build my kit')}
            <ArrowRight size={14} />
          </Button>
        )}
      </div>
      <div className="workspace-stack">
        <span>{t('Detected')}</span>
        {detected.project.stacks.length ? (
          detected.project.stacks.slice(0, 6).map((stack) => <Badge key={stack}>{stack}</Badge>)
        ) : (
          <span>{t('No stack detected — your preset will guide setup')}</span>
        )}
      </div>
      {setup.inspectionError && <Notice tone="warning">{setup.inspectionError}</Notice>}
      {!current && (
        <Notice>
          {t(
            'Choose this folder to switch projects. Review is paused while the folder differs from the inspected project.',
          )}
        </Notice>
      )}
      {detected.previousSetup && !detected.previousSetup.manifestMatches && (
        <Notice tone="warning">
          {t(
            'The setup manifest changed since your last review. Your previously reviewed choices are shown; a new plan is required before writing.',
          )}
        </Notice>
      )}
      {[...new Set([...(detected.project.warnings || []), ...(detected.warnings || [])])].map(
        (warning) => (
          <Notice key={warning} tone="warning">
            {warning}
          </Notice>
        ),
      )}
      <WorkspaceAgents {...{ setup, state }} />
      <div className="workspace-columns">
        <div className="workspace-main">
          <WorkspaceBrief {...{ setup, state, active: active && current }} />
          <WorkspaceKit
            entries={selected}
            recommendations={detected.recommendations}
            {...{ setup, add, inspect }}
          />
          {missing.length > 0 && (
            <Notice tone="warning">
              {t(
                'A selected snapshot is no longer in Library. Review is paused until you remove the unavailable selection.',
              )}{' '}
              <button
                type="button"
                className="inline-button"
                onClick={() => {
                  for (const id of missing) setup.toggleEntry(id);
                }}
              >
                {t('Remove unavailable selections')}
              </button>
            </Notice>
          )}
          <WorkspaceGuidance
            rules={rules}
            onRead={setReading}
            onManage={() => navigate('directives')}
          />
          {detected.guidanceIssues?.map((rule) => (
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
          {blocked && (
            <Notice tone="warning">
              {t(
                'Blocked content is selected. Remove it or resolve the findings in a custom revision before reviewing setup.',
              )}{' '}
              {flagged && (
                <button type="button" className="inline-button" onClick={() => inspect(flagged.id)}>
                  {t('Inspect findings')}
                </button>
              )}
            </Notice>
          )}
          {!!needsReview && !blocked && (
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
                <button type="button" className="inline-button" onClick={() => inspect(flagged.id)}>
                  {t('Inspect findings')}
                </button>
              )}
            </div>
          )}
        </div>
        <aside className="workspace-sidebar">
          <section className="workspace-preset">
            <div className="workspace-section-title">
              <div>
                <h2>{t('Starting preset')}</h2>
                <p>{t('A reusable starting point. Your manual choices stay yours.')}</p>
              </div>
            </div>
            <Select
              id="preset-choice"
              label={t('Starting preset')}
              searchable
              value={setup.preset}
              onValueChange={setup.changePreset}
              options={[
                {
                  value: 'auto',
                  label: t('Automatic · {{preset}}', {
                    preset:
                      state.presets.find((preset) => preset.id === detected.presetId)?.name ||
                      detected.presetId,
                  }),
                },
                ...state.presets.map((preset) => ({ value: preset.id, label: preset.name })),
              ]}
            />
          </section>
          {detected.missing.length > 0 && (
            <details className="workspace-missing">
              <summary>
                {t('Preset references outside Library ({{count}})', {
                  count: detected.missing.length,
                })}
              </summary>
              <p>
                {t(
                  'These suggestions are not in your Library yet. They are not installed by selecting this Preset.',
                )}
              </p>
              <p>{detected.missing.join(', ')}</p>
              <Button variant="secondary" onClick={() => navigate('library')}>
                {t('Find or import skills')}
              </Button>
            </details>
          )}
          <details className="workspace-replacement">
            <summary>
              <SlidersHorizontal size={14} />
              {t('Existing installations')}
            </summary>
            <label className="check-label">
              <input
                type="checkbox"
                checked={setup.replaceExisting}
                onChange={(event) => setup.changeReplacement(event.target.checked)}
              />
              {t('Replace differing skill files in this reviewed plan')}
            </label>
            <p>
              {t(
                'Original bytes are retained for rollback. Symbolic links outside this project are protected. Keep this off for automatic additions.',
              )}
            </p>
          </details>
          <div className="workspace-review">
            <div className="workspace-review-counts">
              <span>
                {countText(selected.filter((entry) => entry.kind === 'skill').length, 'Skill')}
              </span>
              <span>
                {countText(selected.filter((entry) => entry.kind === 'mcp').length, 'MCP server')}
              </span>
              <span>{countText(rules.length, 'Directive')}</span>
            </div>
            {!setup.providers.length && <p role="status">{t('Choose at least one agent')}</p>}
            {setup.selected.length > MAX_PROJECT_KIT_ENTRIES && (
              <p role="status">
                {t(
                  'Project kits support up to 100 selected items. Keep this kit focused before reviewing.',
                )}
              </p>
            )}
            <Button disabled={!canReview} onClick={() => void setup.prepare()}>
              {setup.busy ? (
                <Spinner text={t('Building your plan…')} />
              ) : (
                <>
                  {t('Review setup')}
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
            <p>{t('Next: inspect the exact file changes, then choose Apply.')}</p>
          </div>
        </aside>
      </div>
      <ModalPresence>
        {active && reading && (
          <Modal
            title={reading.name}
            subtitle={`${t('Directive')} · ${reading.scope}`}
            onClose={() => setReading(undefined)}
            wide
          >
            <pre className="content-preview">{reading.content}</pre>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setReading(undefined)}>
                {t('Done')}
              </Button>
              <Button
                onClick={() => {
                  setReading(undefined);
                  navigate('directives');
                }}
              >
                {t('Manage Directives')}
              </Button>
            </div>
          </Modal>
        )}
      </ModalPresence>
      <p className="workspace-private-note">
        {t('This kit is scoped to ')}
        <code>{shortPath(setup.path)}</code>
        {t('. Nothing is added to global agent context.')}
      </p>
    </div>
  );
}
