import { ArrowRight, Layers2, Plus, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import type { Rule } from '../../src/core/model';
import { api, apiId } from '../api';
import {
  Badge,
  Button,
  CopyButton,
  Empty,
  Modal,
  Notice,
  PageHeader,
  Spinner,
} from '../components';
import { requestDiscard, useDraftGuard } from '../drafts';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';

export function Directives(props: PageProps): ReactNode {
  const { state } = props;
  const [selected, setSelected] = useState<Rule | undefined>(state.rules[0]);
  const [newKey, setNewKey] = useState(0);
  const create = () =>
    requestDiscard(() => {
      setNewKey((value) => value + 1);
      setSelected({
        id: '',
        name: '',
        scope: 'global',
        content: '',
        enabled: true,
        priority: 50,
        provenance: 'Custom',
      });
    });
  const groups = [
    'global',
    ...new Set(state.rules.map((rule) => rule.scope).filter((scope) => scope !== 'global')),
  ];
  return (
    <>
      <PageHeader
        eyebrow={t('YOUR WAY OF WORKING')}
        title={t('Directives')}
        description={t('Small, scoped instructions. In your voice, in the right projects.')}
        action={
          <Button onClick={create}>
            <Plus size={16} />
            {t('New directive')}
          </Button>
        }
      />
      <div className="directive-layout">
        <aside className="directive-sidebar">
          <div className="scope-explainer">
            <Layers2 size={20} />
            <div>
              <strong>{t('Scope, then specificity.')}</strong>
              <p>
                {t('Global → domain → stack → project.')}
                <br />
                {t('Only matching guidance is generated.')}
              </p>
            </div>
          </div>
          {groups.map((scope) => (
            <div className="directive-group" key={scope}>
              <p className="eyebrow">
                {state.projects.find((project) => project.id === scope)?.name || scope}
              </p>
              {state.rules
                .filter((rule) => rule.scope === scope)
                .sort((left, right) => left.priority - right.priority)
                .map((rule) => (
                  <button
                    type="button"
                    key={rule.id}
                    className={selected?.id === rule.id ? 'active' : ''}
                    onClick={() => requestDiscard(() => setSelected(rule))}
                  >
                    <span className={`rule-status ${rule.enabled ? 'enabled' : ''}`} />
                    <span>{rule.name}</span>
                    {state.ruleFindings?.some((value) => value.id === rule.id) && (
                      <Badge tone="amber">{t('Review')}</Badge>
                    )}
                    <small>{rule.priority}</small>
                  </button>
                ))}
            </div>
          ))}
        </aside>
        <div className="directive-editor">
          {selected ? (
            <RuleEditor
              {...props}
              key={`${selected.id}-${newKey}`}
              rule={selected}
              onRemove={() => setSelected(state.rules.find((rule) => rule.id !== selected.id))}
            />
          ) : (
            <Empty
              title={t('Write it once.')}
              text={t('Add a directive that tells your agents how you like to build.')}
            >
              <Button onClick={create}>{t('Create a directive')}</Button>
            </Empty>
          )}
        </div>
      </div>
    </>
  );
}

export function RuleEditor({
  state,
  rule,
  refresh,
  notify,
  onRemove,
  onDirtyChange,
}: PageProps & {
  rule: Rule;
  onRemove: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactNode {
  const [value, setValue] = useState(rule);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(rule);
  const [review, setReview] = useState<{ prompt: string; result: string; note: string }>();
  const [deleting, setDeleting] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useDraftGuard(dirty && !onDirtyChange, 'Directive');
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const scopes = [
    'global',
    'mobile',
    'web',
    'backend',
    'react-native',
    'expo',
    'ios',
    'swift',
    'android',
    'kotlin',
    'macos',
    'typescript',
    'javascript',
    'go',
    'bun',
    'hono',
    'nextjs',
  ];
  const update = <Key extends keyof Rule>(key: Key, next: Rule[Key]) =>
    setValue((current) => ({ ...current, [key]: next }));
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await api<Rule>('rules', 'PUT', {
        ...value,
        id:
          value.id ||
          (() => {
            const base = value.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 56);
            return state.rules.some((rule) => rule.id === base)
              ? `${base}-${crypto.randomUUID().slice(0, 6)}`
              : base;
          })(),
      });
      setValue(next);
      setSaved(next);
      await refresh();
      notify(t('Directive saved. Apply a new setup plan to refresh project files.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function improve(): Promise<void> {
    setBusy(true);
    try {
      setReview(await api('ai-review', 'POST', { text: value.content, task: 'rule' }));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="editor-form" onSubmit={(event) => void save(event)}>
        <div className="editor-heading">
          <p className="eyebrow">{t('DIRECTIVE EDITOR')}</p>
          <div className="button-row">
            {dirty && <Badge tone="amber">{t('Unsaved')}</Badge>}
            <label className="switch-label">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span className="switch" />
              {t('Enabled')}
            </label>
          </div>
        </div>
        {state.ruleFindings
          ?.find((rule) => rule.id === value.id)
          ?.findings.map((finding) => (
            <Notice key={finding.code} tone="warning">
              {finding.message}
            </Notice>
          ))}
        <label>
          {t('Title')}
          <input
            className="title-input"
            value={value.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder={t('A clear, memorable instruction')}
            required
          />
        </label>
        <div className="form-two-columns">
          <label htmlFor="directive-scope">
            {t('Applies to')}
            <Select
              label={t('Applies to')}
              id="directive-scope"
              value={value.scope}
              onValueChange={(scope) => update('scope', scope)}
              searchable
              options={[
                ...scopes.map((scope) => ({
                  value: scope,
                  label: scope === 'global' ? 'Every project' : scope,
                  group: 'Scope',
                })),
                ...state.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  group: 'Only this project',
                })),
              ]}
            />
          </label>
          <label>
            {t('Priority ')}
            <span>{t('Later values are more specific')}</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={value.priority}
              onChange={(event) => update('priority', Number(event.target.value))}
            />
          </label>
        </div>
        <div className="editor-toolbar">
          <span>{t('Markdown')}</span>
          <Button
            variant="ghost"
            disabled={busy || !value.content.trim()}
            onClick={() => void improve()}
          >
            <Sparkles size={14} />
            {state.settings.aiRunner === 'ollama'
              ? t('Review with Ollama')
              : t('Prepare AI review')}
          </Button>
        </div>
        <textarea
          className="code-editor rule-textarea"
          value={value.content}
          onChange={(event) => update('content', event.target.value)}
          rows={16}
          spellCheck={false}
          placeholder={t('Describe the decisions your agent should make, and when they apply.')}
          required
        />
        <label>
          {t('Origin / reason')}
          <input
            value={value.provenance}
            onChange={(event) => update('provenance', event.target.value)}
            placeholder={t('A user preference, a lesson, or an upstream source')}
          />
        </label>
        <Notice>
          {t(
            'Project files update through reviewed setup plans. A library edit does not rewrite every existing project.',
          )}
        </Notice>
        <div className="editor-bottom">
          <div className="button-row">
            {rule.id && (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 size={14} />
                {t('Remove')}
              </Button>
            )}
            {dirty && (
              <Button variant="ghost" onClick={() => setValue(saved)}>
                <RotateCcw size={14} />
                {t('Revert edits')}
              </Button>
            )}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                <Save size={15} />
                {t('Save directive')}
              </>
            )}
          </Button>
        </div>
        {deleting && (
          <Notice tone="warning">
            {t('Remove this directive from the library?')}
            <div className="button-row">
              <Button
                variant="danger"
                onClick={() => {
                  void api(`rules/${apiId(value.id)}`, 'DELETE')
                    .then(refresh)
                    .then(onRemove)
                    .catch((error) => notify(error.message, true));
                }}
              >
                {t('Remove directive')}
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t('Keep it')}
              </Button>
            </div>
          </Notice>
        )}
      </form>
      <ModalPresence>
        {review && (
          <Modal
            title={t('A second pair of eyes')}
            subtitle={review.note}
            onClose={() => setReview(undefined)}
            wide
          >
            <div className="code-toolbar">
              <span>{review.result ? t('AI proposal') : t('Prompt for your current agent')}</span>
              <CopyButton text={review.result || review.prompt} />
            </div>
            <pre className="content-preview">{review.result || review.prompt}</pre>
            {review.result && (
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setReview(undefined)}>
                  {t('Keep my version')}
                </Button>
                <Button
                  onClick={() => {
                    update('content', review.result);
                    setReview(undefined);
                  }}
                >
                  {t('Use as draft ')}
                  <ArrowRight size={15} />
                </Button>
              </div>
            )}
          </Modal>
        )}
      </ModalPresence>
    </>
  );
}
