import { Layers2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import type { Rule } from '../../src/core/model';
import { AiAssist } from '../AiAssist';
import { api, apiId } from '../api';
import { Badge, Button, Empty, Notice, PageHeader, Spinner } from '../components';
import { definitionId } from '../definition-id';
import { requestDiscard, useDraftGuard } from '../drafts';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { useMountedRef } from '../useMountedRef';

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
  const mounted = useMountedRef();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(rule);
  const [deleting, setDeleting] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const dirty = busy || aiDirty || JSON.stringify(value) !== JSON.stringify(saved);
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
      const next = await api<Rule>('rules', saved.id ? 'PUT' : 'POST', {
        ...value,
        id: value.id || definitionId(value.name, state.rules),
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
  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await api(`rules/${apiId(value.id)}`, 'DELETE');
      await refresh();
      if (mounted.current) onRemove();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="editor-form" onSubmit={(event) => void save(event)}>
      <fieldset className="editor-fields" disabled={busy} aria-label={t('Directive fields')}>
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
                  label: scope === 'global' ? t('Every project') : scope,
                  group: t('Scope'),
                })),
                ...state.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  group: t('Only this project'),
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
        <AiAssist
          onDirtyChange={setAiDirty}
          settings={state.settings}
          task="rule"
          label={t('Create, improve or format this directive')}
          current={JSON.stringify({
            name: value.name,
            scope: value.scope,
            content: value.content,
            priority: value.priority,
            provenance: value.provenance,
          })}
          onUse={(draft) => {
            if (draft.kind === 'rule')
              setValue((current) => ({
                ...current,
                name: draft.name,
                scope: draft.scope,
                content: draft.content,
                priority: draft.priority,
                provenance: draft.provenance,
              }));
          }}
        />
        <label htmlFor="directive-content">{t('Directive content')}</label>
        <textarea
          id="directive-content"
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
              <Button variant="danger" onClick={() => void remove()}>
                {t('Remove directive')}
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t('Keep it')}
              </Button>
            </div>
          </Notice>
        )}
      </fieldset>
    </form>
  );
}
