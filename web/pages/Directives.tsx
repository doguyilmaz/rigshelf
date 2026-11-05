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
import type { PageProps } from '../main';

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
        eyebrow="YOUR WAY OF WORKING"
        title="Guidance that travels."
        description="Small, scoped instructions. In your voice, in the right projects."
        action={
          <Button onClick={create}>
            <Plus size={16} />
            New directive
          </Button>
        }
      />
      <div className="directive-layout">
        <aside className="directive-sidebar">
          <div className="scope-explainer">
            <Layers2 size={20} />
            <div>
              <strong>Scope, then specificity.</strong>
              <p>
                Global → domain → stack → project.
                <br />
                Only matching guidance is generated.
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
                      <Badge tone="amber">Review</Badge>
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
              title="Write it once."
              text="Add a directive that tells your agents how you like to build."
            >
              <Button onClick={create}>Create a directive</Button>
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
      notify('Directive saved. Apply a new setup plan to refresh project files.');
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
          <p className="eyebrow">DIRECTIVE EDITOR</p>
          <div className="button-row">
            {dirty && <Badge tone="amber">Unsaved</Badge>}
            <label className="switch-label">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span className="switch" />
              Enabled
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
          Title
          <input
            className="title-input"
            value={value.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="A clear, memorable instruction"
            required
          />
        </label>
        <div className="form-two-columns">
          <label>
            Applies to
            <select value={value.scope} onChange={(event) => update('scope', event.target.value)}>
              {scopes.map((scope) => (
                <option key={scope} value={scope}>
                  {scope === 'global' ? 'Every project' : scope}
                </option>
              ))}
              <optgroup label="Only this project">
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Priority <span>Later values are more specific</span>
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
          <span>Markdown</span>
          <Button
            variant="ghost"
            disabled={busy || !value.content.trim()}
            onClick={() => void improve()}
          >
            <Sparkles size={14} />
            {state.settings.aiRunner === 'ollama' ? 'Review with Ollama' : 'Prepare AI review'}
          </Button>
        </div>
        <textarea
          className="code-editor rule-textarea"
          value={value.content}
          onChange={(event) => update('content', event.target.value)}
          rows={16}
          spellCheck={false}
          placeholder="Describe the decisions your agent should make, and when they apply."
          required
        />
        <label>
          Origin / reason
          <input
            value={value.provenance}
            onChange={(event) => update('provenance', event.target.value)}
            placeholder="A user preference, a lesson, or an upstream source"
          />
        </label>
        <Notice>
          Project files update through reviewed setup plans. A library edit does not rewrite every
          existing project.
        </Notice>
        <div className="editor-bottom">
          <div className="button-row">
            {rule.id && (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 size={14} />
                Remove
              </Button>
            )}
            {dirty && (
              <Button variant="ghost" onClick={() => setValue(saved)}>
                <RotateCcw size={14} />
                Revert edits
              </Button>
            )}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                <Save size={15} />
                Save directive
              </>
            )}
          </Button>
        </div>
        {deleting && (
          <Notice tone="warning">
            Remove this directive from the library?
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
                Remove directive
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
            </div>
          </Notice>
        )}
      </form>
      {review && (
        <Modal
          title="A second pair of eyes"
          subtitle={review.note}
          onClose={() => setReview(undefined)}
          wide
        >
          <div className="code-toolbar">
            <span>{review.result ? 'AI proposal' : 'Prompt for your current agent'}</span>
            <CopyButton text={review.result || review.prompt} />
          </div>
          <pre className="content-preview">{review.result || review.prompt}</pre>
          {review.result && (
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setReview(undefined)}>
                Keep my version
              </Button>
              <Button
                onClick={() => {
                  update('content', review.result);
                  setReview(undefined);
                }}
              >
                Use as draft <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
