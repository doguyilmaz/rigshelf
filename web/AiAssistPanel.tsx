import { PenLine, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { AiDraftView } from '../src/core/ai-assistance';
import type { AiDraft, AiProposal, AiRequest } from '../src/core/ai-drafts';
import { defaultDraftModel } from '../src/core/ai-models';
import { AiDraftPreview } from './AiDraftPreview';
import { AiModelPicker } from './AiModelPicker';
import { AiSessionConnection } from './AiSessionConnection';
import { api, apiId } from './api';
import { Button, CopyButton, Notice, Spinner } from './components';
import { useDraftGuard } from './drafts';
import { getLocale, t } from './i18n';
import type { PageProps } from './main';
import { OllamaModelPicker } from './OllamaModelPicker';
import { Select } from './Select';

interface ProviderOption {
  id: AiRequest['runner'];
  name: string;
  available: boolean;
}
export interface AiAssistProps {
  settings: PageProps['state']['settings'];
  task: AiRequest['task'];
  current?: string;
  onUse: (draft: AiDraft) => void;
  label?: string;
  defaultOpen?: boolean;
  onClose?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  entries?: { id: string; name: string }[];
  initialText?: string;
  defaultIntent?: AiRequest['intent'];
  compact?: boolean;
  onSourceInput?: (input: string) => void;
}
const PREFERENCE_KEY = 'rigshelf:ai-provider:v1';
function remembered(): {
  runner?: AiRequest['runner'];
  model?: string;
  connectionId?: string;
  models?: Record<string, string>;
} {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const item = value as Record<string, unknown>;
    return {
      runner: typeof item.runner === 'string' && isRunner(item.runner) ? item.runner : undefined,
      model: typeof item.model === 'string' && item.model.length <= 100 ? item.model : undefined,
      models:
        item.models && typeof item.models === 'object' && !Array.isArray(item.models)
          ? (Object.fromEntries(
              Object.entries(item.models).filter(
                ([key, model]) => isRunner(key) && typeof model === 'string' && model.length <= 100,
              ),
            ) as Record<string, string>)
          : {},
      connectionId:
        typeof item.connectionId === 'string' && item.connectionId.length <= 64
          ? item.connectionId
          : undefined,
    };
  } catch {
    return {};
  }
}
const isRunner = (value: string): value is AiRequest['runner'] =>
  ['claude', 'codex', 'ollama', 'session', 'compatible'].includes(value);
function draftText(draft: AiDraft): string {
  if (draft.kind === 'rule') return draft.content;
  if (draft.kind === 'skill') return draft.body;
  if (draft.kind === 'text' || draft.kind === 'requirements') return draft.text;
  return JSON.stringify(draft.kind === 'mcp' ? draft.mcp : draft, null, 2);
}
export function AiAssistPanel({
  settings,
  task,
  current = '',
  onUse,
  label = t('Help me with AI'),
  onClose,
  onDirtyChange,
  entries,
  initialText = '',
  defaultIntent = 'create',
  compact = false,
  onSourceInput,
}: AiAssistProps) {
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [intent, setIntent] = useState<AiRequest['intent']>(defaultIntent);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [runner, setRunner] = useState<AiRequest['runner']>(
    () => remembered().runner || (isRunner(settings.aiRunner) ? settings.aiRunner : 'session'),
  );
  const [model, setModel] = useState(
    () =>
      remembered().models?.[runner] ??
      (remembered().runner === runner ? remembered().model || undefined : undefined) ??
      (runner === settings.aiRunner
        ? runner === 'ollama'
          ? settings.ollamaModel
          : settings.aiModel
        : defaultDraftModel(runner)),
  );
  const models = useRef(remembered().models || {});
  const [job, setJob] = useState<AiDraftView>();
  const [connectionId, setConnectionId] = useState(
    () =>
      settings.aiConnections.find((item) => item.id === remembered().connectionId)?.id ||
      settings.aiConnections[0]?.id ||
      '',
  );
  const connection = settings.aiConnections.find((item) => item.id === connectionId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [requestOpen, setRequestOpen] = useState(true);
  const basis = useRef('');
  const ownedJob = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const signature = JSON.stringify({ task, current, text, intent, runner, model, connection });
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const proposal: AiProposal | undefined = job?.state === 'ready' ? job.proposal : undefined;
  const working = starting || job?.state === 'running' || job?.state === 'waiting';
  const hasProposal = Boolean(proposal);
  useEffect(() => {
    setRequestOpen(!hasProposal);
  }, [hasProposal]);
  const stale = !!proposal && basis.current !== signature;
  const unavailable =
    !!proposal &&
    !!entries &&
    'entryIds' in proposal.draft &&
    proposal.draft.entryIds.some((id) => !entries.some((entry) => entry.id === id));
  const dirty = Boolean(text.trim() || proposal || working);
  const guard = useDraftGuard(dirty, t('AI draft'));
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const provider = providers.find((item) => item.id === runner)?.name || runner;
  const providerUnavailable =
    providers.length > 0 && !providers.some((item) => item.id === runner && item.available);
  const hasConnections = settings.aiConnections.length > 0;
  useEffect(() => {
    let live = true;
    void api<ProviderOption[]>('ai/providers')
      .then((items) => {
        if (!live) return;
        setProviders(
          items.map((item) =>
            item.id === 'compatible' ? { ...item, available: hasConnections } : item,
          ),
        );
        if (!remembered().runner && settings.aiRunner === 'none') {
          const next =
            items.find((item) => item.available && ['claude', 'codex'].includes(item.id))?.id ||
            'session';
          setRunner(next);
          setModel(defaultDraftModel(next));
        }
      })
      .catch(() => {
        if (live) setError(t('Could not load AI Providers. Try again.'));
      });
    return () => {
      live = false;
    };
  }, [settings.aiRunner, hasConnections]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      if (ownedJob.current)
        void api(`ai/drafts/${apiId(ownedJob.current)}/cancel`, 'POST', {}).catch(() => undefined);
    },
    [],
  );
  const jobId = job?.id;
  const jobState = job?.state;
  useEffect(() => {
    if (!jobId || !jobState || !['running', 'waiting'].includes(jobState)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<AiDraftView>(`ai/drafts/${apiId(jobId)}`);
        if (!live) return;
        setJob(next);
        if (['running', 'waiting'].includes(next.state))
          timer = setTimeout(() => void poll(), 1000);
      } catch {
        if (live) {
          setError(t('Could not retrieve the AI draft. Retry or cancel the request.'));
          timer = setTimeout(() => void poll(), 2500);
        }
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, jobState]);
  async function cancel() {
    generation.current++;
    controller.current?.abort();
    setStarting(false);
    if (ownedJob.current) {
      try {
        setJob(await api<AiDraftView>(`ai/drafts/${apiId(ownedJob.current)}/cancel`, 'POST', {}));
      } catch {
        setError(t('Could not cancel the request. Try again.'));
      }
    }
  }
  async function generate() {
    const version = ++generation.current;
    const pending = new AbortController();
    controller.current = pending;
    basis.current = signatureRef.current;
    setStarting(true);
    setError('');
    ownedJob.current = undefined;
    setJob(undefined);
    try {
      const next = await api<AiDraftView>('ai/drafts', 'POST', {
        task,
        intent,
        text:
          text.trim() ||
          `Please ${intent} the existing fields while preserving the author's intent.`,
        current,
        runner,
        model: runner === 'session' ? '' : model,
        connectionId: runner === 'compatible' ? connectionId : '',
        language: getLocale(),
      });
      if (version !== generation.current) {
        void api(`ai/drafts/${apiId(next.id)}/cancel`, 'POST', {}).catch(() => undefined);
        return;
      }
      ownedJob.current = next.id;
      setJob(next);
      try {
        localStorage.setItem(
          PREFERENCE_KEY,
          JSON.stringify({
            runner,
            model,
            connectionId,
            models: { ...models.current, [runner]: model },
          }),
        );
      } catch {
        /* Optional preference. */
      }
    } catch (failure) {
      if (version === generation.current && !pending.signal.aborted)
        setError(failure instanceof Error ? failure.message : t('AI generation failed.'));
    } finally {
      if (version === generation.current) setStarting(false);
    }
  }
  return (
    <section className="ai-assist" aria-label={t('AI assistance')}>
      <div className="ai-assist-heading">
        <div>
          <strong>{label}</strong>
          <p>
            {t(
              compact
                ? 'Start with your rough brief. AI can clarify it and match items already in your Library.'
                : 'Describe the result. AI prepares the fields; you review before saving.',
            )}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('Close AI assistance')}
            onClick={() => {
              guard(onClose);
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <details
        className="ai-request"
        data-preview={hasProposal || undefined}
        open={requestOpen}
        onToggle={(event) => setRequestOpen(event.currentTarget.open)}
      >
        <summary>{t('Request & Provider')}</summary>
        <div>
          {!compact && (
            <fieldset className="ai-intents" aria-label={t('AI action')}>
              {(['create', 'improve', 'format', 'suggest'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={intent === value}
                  disabled={working}
                  onClick={() => setIntent(value)}
                >
                  {t(
                    {
                      create: 'Create',
                      improve: 'Improve',
                      format: 'Convert to format',
                      suggest: 'Suggest',
                    }[value],
                  )}
                </button>
              ))}
            </fieldset>
          )}
          <label className="field-label" htmlFor={`${fieldId}-brief`}>
            {t('What should AI prepare?')}
          </label>
          <textarea
            id={`${fieldId}-brief`}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(
              compact
                ? 'An Expo app with email sign-in, a Hono API and clear error handling…'
                : 'Paste a link, installation command or rough notes. Or describe what you want.',
            )}
            disabled={working}
          />
          <div className={`ai-provider-row ${runner === 'session' ? 'single' : ''}`}>
            <div>
              <label className="field-label" htmlFor={`${fieldId}-provider`}>
                Provider
              </label>
              <Select
                id={`${fieldId}-provider`}
                label={t('AI Provider')}
                value={runner}
                disabled={working}
                onValueChange={(value) => {
                  if (isRunner(value)) {
                    models.current[runner] = model;
                    setRunner(value);
                    setModel(
                      models.current[value] ??
                        (value === 'ollama'
                          ? settings.ollamaModel
                          : value === settings.aiRunner
                            ? settings.aiModel
                            : defaultDraftModel(value)),
                    );
                  }
                }}
                options={providers.map((item) => ({
                  value: item.id,
                  label: !item.available
                    ? item.id === 'compatible'
                      ? t('API connection · configure in Settings')
                      : t('{{provider}} · not installed', { provider: item.name })
                    : item.id === 'session'
                      ? t('Current Agent · MCP drafts')
                      : item.name,
                  disabled: !item.available,
                }))}
              />
            </div>
            {runner !== 'session' && (
              <div>
                <label className="field-label" htmlFor={`${fieldId}-model`}>
                  {t('Model')} <span>{runner !== 'ollama' && t('Optional')}</span>
                </label>
                {runner === 'ollama' ? (
                  <OllamaModelPicker
                    id={`${fieldId}-model`}
                    label={t('Model')}
                    value={model}
                    onValueChange={setModel}
                    disabled={working}
                  />
                ) : runner === 'claude' || runner === 'codex' ? (
                  <AiModelPicker
                    key={runner}
                    showHelp={false}
                    id={`${fieldId}-model`}
                    runner={runner}
                    value={model}
                    onValueChange={setModel}
                    disabled={working}
                  />
                ) : (
                  <input
                    id={`${fieldId}-model`}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={t('Provider default')}
                    disabled={working}
                    maxLength={100}
                  />
                )}
              </div>
            )}
          </div>
          {(runner === 'claude' || runner === 'codex') && (
            <p className="field-help">
              {t(
                'Suggestions are not an account model list. Availability and usage depend on your CLI login. No automatic fallback to a larger model.',
              )}
            </p>
          )}
          {runner === 'compatible' && (
            <div className="editor-form">
              <label htmlFor={`${fieldId}-connection`}>
                {t('API connection')}
                <Select
                  id={`${fieldId}-connection`}
                  label={t('API connection')}
                  value={connectionId}
                  disabled={working}
                  onValueChange={(value) => {
                    setConnectionId(value);
                    setModel('');
                  }}
                  options={settings.aiConnections.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              </label>
              {connection && (
                <p className="field-help">
                  <code translate="no">{connection.baseUrl}</code>
                  {' · '}
                  {connection.model}
                </p>
              )}
            </div>
          )}
          {runner === 'session' && <AiSessionConnection initialProvider={settings.aiRunner} />}
          <p className="field-help">
            {runner === 'session'
              ? t(
                  'Uses a draft request in your connected Rigshelf MCP session. Ask the agent to answer the pending request.',
                )
              : runner === 'compatible'
                ? t(
                    'Sends this request and the current fields to the selected API connection. The service may route models remotely. Credentials are resolved only by the local server; generation starts only when you ask.',
                  )
                : runner === 'ollama'
                  ? t(
                      'Sends this request to your Ollama service at 127.0.0.1:11434. Model routing is controlled by that service.',
                    )
                  : t(
                      'Sends this request and the current fields to {{provider}}. CLI login and usage limits apply.',
                      { provider },
                    )}{' '}
            {['preset', 'requirements'].includes(task) &&
              t('Includes up to 80 library names, tags and descriptions for matching suggestions.')}
          </p>
          {error && <Notice tone="warning">{t(error)}</Notice>}
          {providerUnavailable && (
            <Notice>
              {t(
                'Your saved AI Provider is unavailable. Choose an available Provider to prepare this draft.',
              )}
            </Notice>
          )}
          {(job?.state === 'failed' || (job?.state === 'canceled' && job.error)) && (
            <Notice tone="warning">{t(job.error || 'AI generation failed.')}</Notice>
          )}
          {job?.state === 'waiting' && (
            <Notice>
              {t(
                'Waiting for your connected agent. Use rigshelf_pending_drafts and rigshelf_propose_draft in that session.',
              )}{' '}
              <CopyButton
                text={`Prepare the pending Rigshelf draft ${job.id}. Read rigshelf_draft_request, follow its output schema, and submit with rigshelf_propose_draft. Do not save or apply anything.`}
                label={t('Copy agent request')}
              />
            </Notice>
          )}
          <div className="button-row">
            {onSourceInput &&
              !working &&
              /^(?:https:\/\/\S+|[\w.-]+\/[\w.-]+|(?:bunx|npx|npm|bun|curl|\/plugin)\s+.+)$/s.test(
                text.trim(),
              ) && (
                <Button variant="secondary" onClick={() => onSourceInput(text.trim())}>
                  {t('Preview source without AI')}
                </Button>
              )}
            {working ? (
              <>
                <Spinner
                  text={
                    job?.state === 'waiting' ? t('Waiting for Agent') : t('Preparing your draft…')
                  }
                />
                <Button variant="secondary" onClick={() => void cancel()}>
                  {t('Cancel generation')}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void generate()}
                disabled={
                  !providers.length ||
                  providerUnavailable ||
                  (!text.trim() && !current.trim()) ||
                  (runner === 'ollama' && !model.trim()) ||
                  (runner === 'compatible' && !connection)
                }
              >
                <PenLine size={14} />
                {runner === 'session'
                  ? t('Ask connected Agent')
                  : t('Generate with {{provider}}', { provider })}
              </Button>
            )}
          </div>
        </div>
      </details>
      {proposal && (
        <div className="ai-proposal">
          <strong>{t('Draft preview')}</strong>
          <div className="button-row">
            <Button
              variant="secondary"
              onClick={() => {
                setJob(undefined);
                ownedJob.current = undefined;
              }}
            >
              {t('Keep my version')}
            </Button>
            <Button
              disabled={stale || unavailable}
              onClick={() => {
                onUse(proposal.draft);
                setJob(undefined);
                ownedJob.current = undefined;
                setText('');
              }}
            >
              {t('Use draft')}
            </Button>
            <CopyButton text={draftText(proposal.draft)} />
          </div>
          <p>{proposal.summary}</p>
          {proposal.questions.map((question) => (
            <Notice key={question} tone="warning">
              {question}
            </Notice>
          ))}
          {proposal.warnings.map((warning) => (
            <Notice key={warning} tone="warning">
              {warning}
            </Notice>
          ))}
          <div className="ai-draft-compare">
            {current && (
              <details>
                <summary>{t('Current fields')}</summary>
                <pre>{current}</pre>
              </details>
            )}
            <AiDraftPreview draft={proposal.draft} entries={entries} />
          </div>
          {unavailable && (
            <Notice tone="warning">
              {t(
                'A suggested Snapshot is no longer available. Generate again before using this draft.',
              )}
            </Notice>
          )}
          {stale && (
            <Notice tone="warning">
              {t(
                'The editor changed after this request. Generate again to avoid replacing newer edits.',
              )}
            </Notice>
          )}
        </div>
      )}
    </section>
  );
}
