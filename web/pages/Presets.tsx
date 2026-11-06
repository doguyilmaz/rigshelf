import { ArrowRight, Check, Copy, GitBranch, Plus, Settings2, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { Preset } from '../../src/core/model';
import { AiAssist } from '../AiAssist';
import { api, apiId } from '../api';
import { Badge, Button, Empty, Modal, Notice, PageHeader, SearchBox, Spinner } from '../components';
import { definitionId } from '../definition-id';
import { useDraftGuard } from '../drafts';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';
import { setupAdditions } from '../setup-selection';
import { useMountedRef } from '../useMountedRef';

const PRESET_PICK_PAGE_SIZE = 60;

function chain(presets: Preset[], preset: Preset, seen = new Set<string>()): Preset[] {
  if (seen.has(preset.id)) return [];
  seen.add(preset.id);
  const parent = presets.find((value) => value.id === preset.parentId);
  return [...(parent ? chain(presets, parent, seen) : []), preset];
}
export function Presets(props: PageProps): ReactNode {
  const { state } = props;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Preset>();
  const matchingPresets = state.presets.filter((preset) =>
    `${preset.name} ${preset.description} ${preset.stacks.join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const fresh = (): Preset => ({
    id: '',
    name: '',
    description: '',
    parentId: 'base',
    stacks: [],
    selectors: [],
    entryIds: [],
    excludedIds: [],
    providers: state.settings.defaultProviders,
  });
  return (
    <>
      <PageHeader
        eyebrow={t('GOOD DEFAULTS, ON REPEAT')}
        title={t('Presets')}
        description={t('Build a small foundation once. Adapt it for every kind of project.')}
        action={
          <Button onClick={() => setEditing(fresh())}>
            <Plus size={16} />
            {t('New preset')}
          </Button>
        }
      />
      <div className="library-toolbar">
        <SearchBox
          value={query}
          onChange={setQuery}
          label={t('Find a preset…')}
          placeholder={t('Find a preset…')}
        />
        <span className="muted">{t('Presets inherit. Your choices stay editable.')}</span>
      </div>
      <div className="preset-grid">
        {matchingPresets.map((preset) => {
          const parents = chain(state.presets, preset);
          const selectors = [...new Set(parents.flatMap((value) => value.selectors))];
          return (
            <button
              type="button"
              key={preset.id}
              className="preset-card"
              onClick={() => setEditing(preset)}
            >
              <div className="preset-card-top">
                <span className="preset-glyph large">
                  {preset.stacks.includes('expo')
                    ? '◈'
                    : preset.stacks.includes('swift')
                      ? '⌘'
                      : preset.stacks.includes('web')
                        ? '◎'
                        : preset.stacks.includes('backend')
                          ? '{ }'
                          : '◇'}
                </span>
                <ArrowRight size={17} />
              </div>
              <h2>{preset.name}</h2>
              <p>{preset.description}</p>
              <div className="project-tags">
                {preset.stacks.slice(-3).map((value) => (
                  <Badge key={value}>{value}</Badge>
                ))}
              </div>
              <div className="preset-inheritance">
                <GitBranch size={13} />
                <span>{parents.map((value) => value.name).join(' / ')}</span>
              </div>
              <div className="preset-card-bottom">
                <span>
                  {selectors.length + parents.flatMap((value) => value.entryIds).length}
                  {t(' selectors / explicit picks')}
                </span>
                <Settings2 size={14} />
              </div>
            </button>
          );
        })}
      </div>
      {!matchingPresets.length && (
        <Empty
          title={t('No matching Presets')}
          text={t('Try a project type, technology or part of a Preset name.')}
        >
          <Button variant="secondary" onClick={() => setQuery('')}>
            {t('Clear search')}
          </Button>
        </Empty>
      )}
      <ModalPresence>
        {editing && (
          <PresetEditor {...props} preset={editing} onClose={() => setEditing(undefined)} />
        )}
      </ModalPresence>
    </>
  );
}

function PresetEditor({
  state,
  preset,
  onClose,
  refresh,
  notify,
}: PageProps & { preset: Preset; onClose: () => void }): ReactNode {
  const [value, setValue] = useState(preset);
  const mounted = useMountedRef();
  const [selectors, setSelectors] = useState(preset.selectors.join('\n'));
  const [stacks, setStacks] = useState(preset.stacks.join(', '));
  const [busy, setBusy] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isNew = !preset.id;
  const [advanced, setAdvanced] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [visiblePicks, setVisiblePicks] = useState(PRESET_PICK_PAGE_SIZE);
  const matchingEntries = state.entries.filter(
    (entry) =>
      (!entry.archived ||
        value.entryIds.includes(entry.id) ||
        value.excludedIds.includes(entry.id)) &&
      (entry.kind === 'skill' || entry.kind === 'mcp') &&
      `${entry.name} ${entry.tags.join(' ')}`.toLowerCase().includes(pickQuery.toLowerCase()),
  );
  const guardClose = useDraftGuard(
    busy ||
      aiDirty ||
      JSON.stringify(value) !== JSON.stringify(preset) ||
      selectors !== preset.selectors.join('\n') ||
      stacks !== preset.stacks.join(', '),
    'Preset',
  );
  const change = <Key extends keyof Preset>(key: Key, next: Preset[Key]) =>
    setValue((current) => ({ ...current, [key]: next }));
  function editedPreset(): Preset {
    return {
      ...value,
      selectors: selectors
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      stacks: stacks
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (isNew && value.id && state.presets.some((preset) => preset.id === value.id))
        throw new Error(t('That preset ID already exists. Choose another ID.'));
      await api('presets', isNew ? 'POST' : 'PUT', {
        ...editedPreset(),
        id: value.id || definitionId(value.name, state.presets),
      });
      await refresh();
      notify(t('Preset saved'));
      if (mounted.current) onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate(): Promise<void> {
    setBusy(true);
    try {
      await api('presets', 'POST', {
        ...editedPreset(),
        id: `${value.id.slice(0, 52)}-${crypto.randomUUID().slice(0, 6)}`,
        name: `${value.name.slice(0, 90)} copy`,
      });
      await refresh();
      notify(t('Preset duplicated'));
      if (mounted.current) onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await api(`presets/${apiId(preset.id)}`, 'DELETE');
      await refresh();
      if (mounted.current) onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const inherited = value.parentId
    ? state.presets.find((item) => item.id === value.parentId)
    : undefined;
  return (
    <Modal
      title={isNew ? t('A new starting point') : value.name}
      subtitle={t('Combine inherited guidance with a focused selection.')}
      onClose={() => guardClose(onClose)}
      closeDisabled={busy}
    >
      <form className="editor-form" onSubmit={(event) => void save(event)}>
        <fieldset className="editor-fields" disabled={busy} aria-label={t('Preset fields')}>
          <AiAssist
            onDirtyChange={setAiDirty}
            settings={state.settings}
            entries={state.entries}
            task="preset"
            label={t('Build this Preset with AI')}
            current={JSON.stringify({ ...value, selectors, stacks })}
            onUse={(draft) => {
              if (draft.kind !== 'preset') return;
              setValue((current) => ({
                ...current,
                name: draft.name,
                description: draft.description,
                providers: draft.providers,
                entryIds: [
                  ...current.entryIds,
                  ...setupAdditions(current.entryIds, draft.entryIds, state.entries),
                ],
              }));
              setSelectors(draft.selectors.join('\n'));
              setStacks(draft.stacks.join(', '));
            }}
          />
          <div className="form-two-columns">
            <label>
              {t('Name')}
              <input
                value={value.name}
                onChange={(event) => change('name', event.target.value)}
                required
              />
            </label>
            <label>
              {t('Preset ID')}
              <input
                value={value.id}
                onChange={(event) => change('id', event.target.value)}
                disabled={!isNew}
                placeholder={t('generated-from-name')}
              />
            </label>
          </div>
          <label>
            {t('Description')}
            <textarea
              rows={2}
              value={value.description}
              onChange={(event) => change('description', event.target.value)}
            />
          </label>
          <div className="form-two-columns">
            <label htmlFor="preset-parent">
              {t('Inherit from')}
              <Select
                label={t('Inherit from')}
                id="preset-parent"
                value={value.parentId || ''}
                onValueChange={(parentId) => change('parentId', parentId || null)}
                searchable
                options={[
                  { value: '', label: t('No parent') },
                  ...state.presets
                    .filter((item) => item.id !== value.id)
                    .map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            </label>
            <label>
              {t('Stack tags')}
              <input
                value={stacks}
                onChange={(event) => setStacks(event.target.value)}
                placeholder={t('mobile, expo')}
              />
            </label>
          </div>
          {inherited && (
            <Notice>
              <GitBranch size={14} />
              {t('Inherits')}{' '}
              {chain(state.presets, inherited)
                .map((item) => item.name)
                .join(' → ')}
              {t('. Cycles are rejected.')}
            </Notice>
          )}
          <label>
            {t('Skill name selectors ')}
            <span>{t('One per line. Missing matches are reported during setup.')}</span>
            <textarea
              rows={6}
              className="code-editor"
              value={selectors}
              onChange={(event) => setSelectors(event.target.value)}
              placeholder={t('react-native-best-practices')}
            />
          </label>
          <p className="field-label">{t('Default agents')}</p>
          <div className="agent-checks">
            {state.adapters.map((agent) => (
              <label key={agent.id} className="check-label">
                <input
                  type="checkbox"
                  checked={value.providers.includes(agent.id)}
                  onChange={(event) =>
                    change(
                      'providers',
                      event.target.checked
                        ? [...value.providers, agent.id]
                        : value.providers.filter((item) => item !== agent.id),
                    )
                  }
                />
                {agent.name}
              </label>
            ))}
          </div>
          <details className="advanced" onToggle={(event) => setAdvanced(event.currentTarget.open)}>
            <summary>{t('Explicit library picks and exclusions')}</summary>
            {advanced && (
              <>
                <SearchBox
                  value={pickQuery}
                  label={t('Find a skill or MCP snapshot…')}
                  onChange={(query) => {
                    setPickQuery(query);
                    setVisiblePicks(PRESET_PICK_PAGE_SIZE);
                  }}
                  placeholder={t('Find a skill or MCP snapshot…')}
                />
                <p className="field-help">
                  {t(
                    'Included and excluded pins stay selected when hidden. Use Show more to browse the complete matching list.',
                  )}
                </p>
                <div className="explicit-picks">
                  {matchingEntries.slice(0, visiblePicks).map((entry) => (
                    <div key={entry.id}>
                      <span>
                        {entry.name}
                        <small className="muted"> · {entry.digest.slice(0, 8)}</small>
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          checked={value.entryIds.includes(entry.id)}
                          onChange={(event) =>
                            change(
                              'entryIds',
                              event.target.checked
                                ? [...value.entryIds, entry.id]
                                : value.entryIds.filter((item) => item !== entry.id),
                            )
                          }
                        />
                        {t('Include')}
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={value.excludedIds.includes(entry.id)}
                          onChange={(event) =>
                            change(
                              'excludedIds',
                              event.target.checked
                                ? [...value.excludedIds, entry.id]
                                : value.excludedIds.filter((item) => item !== entry.id),
                            )
                          }
                        />
                        {t('Exclude')}
                      </label>
                    </div>
                  ))}
                </div>
                {!matchingEntries.length && (
                  <p className="field-help" role="status">
                    {t('No matching Skills or MCP servers.')}
                  </p>
                )}
                {matchingEntries.length > visiblePicks && (
                  <Button
                    variant="secondary"
                    onClick={() => setVisiblePicks((count) => count + PRESET_PICK_PAGE_SIZE)}
                  >
                    {t('Show more')}
                  </Button>
                )}
              </>
            )}
          </details>
          <div className="modal-actions">
            <div className="button-row">
              {!isNew && (
                <>
                  <Button variant="ghost" onClick={() => void duplicate()}>
                    <Copy size={14} />
                    {t('Duplicate')}
                  </Button>
                  <Button variant="ghost" onClick={() => setDeleting(true)}>
                    <Trash2 size={14} />
                    {t('Remove')}
                  </Button>
                </>
              )}
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {t('Save preset ')}
                  <Check size={15} />
                </>
              )}
            </Button>
          </div>
          {deleting && (
            <Notice tone="warning">
              {t('Remove this preset? Child presets must be reassigned first.')}
              <div className="button-row">
                <Button variant="danger" onClick={() => void remove()}>
                  {t('Remove preset')}
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(false)}>
                  {t('Keep it')}
                </Button>
              </div>
            </Notice>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
