import { ArrowRight, Check, Copy, GitBranch, Plus, Settings2, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { Preset } from '../../src/core/model';
import { api, apiId } from '../api';
import { Badge, Button, Modal, Notice, PageHeader, SearchBox, Spinner } from '../components';
import { useDraftGuard } from '../drafts';
import type { PageProps } from '../main';
import { Select } from '../Select';

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
        eyebrow="GOOD DEFAULTS, ON REPEAT"
        title="A head start, saved."
        description="Build a small foundation once. Adapt it for every kind of project."
        action={
          <Button onClick={() => setEditing(fresh())}>
            <Plus size={16} />
            New preset
          </Button>
        }
      />
      <div className="library-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Find a preset…" />
        <span className="muted">Presets inherit. Your choices stay editable.</span>
      </div>
      <div className="preset-grid">
        {state.presets
          .filter((preset) =>
            `${preset.name} ${preset.stacks.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((preset) => {
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
                    {selectors.length + parents.flatMap((value) => value.entryIds).length} selectors
                    / explicit picks
                  </span>
                  <Settings2 size={14} />
                </div>
              </button>
            );
          })}
      </div>
      {editing && (
        <PresetEditor {...props} preset={editing} onClose={() => setEditing(undefined)} />
      )}
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
  const [selectors, setSelectors] = useState(preset.selectors.join('\n'));
  const [stacks, setStacks] = useState(preset.stacks.join(', '));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isNew = !preset.id;
  const [advanced, setAdvanced] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const guardClose = useDraftGuard(
    JSON.stringify(value) !== JSON.stringify(preset) ||
      selectors !== preset.selectors.join('\n') ||
      stacks !== preset.stacks.join(', '),
    'Preset',
  );
  const change = <Key extends keyof Preset>(key: Key, next: Preset[Key]) =>
    setValue((current) => ({ ...current, [key]: next }));
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (isNew && value.id && state.presets.some((preset) => preset.id === value.id))
        throw new Error('That preset ID already exists. Choose another ID.');
      await api('presets', 'PUT', {
        ...value,
        id:
          value.id ||
          value.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        selectors: selectors
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        stacks: stacks
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      await refresh();
      notify('Preset saved');
      onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate(): Promise<void> {
    try {
      await api('presets', 'PUT', {
        ...value,
        id: `${value.id.slice(0, 52)}-${crypto.randomUUID().slice(0, 6)}`,
        name: `${value.name} copy`,
      });
      await refresh();
      notify('Preset duplicated');
      onClose();
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  const inherited = value.parentId
    ? state.presets.find((item) => item.id === value.parentId)
    : undefined;
  return (
    <Modal
      title={isNew ? 'A new starting point' : value.name}
      subtitle="Combine inherited guidance with a focused selection."
      onClose={() => guardClose(onClose)}
    >
      <form className="editor-form" onSubmit={(event) => void save(event)}>
        <div className="form-two-columns">
          <label>
            Name
            <input
              value={value.name}
              onChange={(event) => change('name', event.target.value)}
              required
            />
          </label>
          <label>
            Preset ID
            <input
              value={value.id}
              onChange={(event) => change('id', event.target.value)}
              disabled={!isNew}
              placeholder="generated-from-name"
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            rows={2}
            value={value.description}
            onChange={(event) => change('description', event.target.value)}
          />
        </label>
        <div className="form-two-columns">
          <label htmlFor="preset-parent">
            Inherit from
            <Select
              label="Inherit from"
              id="preset-parent"
              value={value.parentId || ''}
              onValueChange={(parentId) => change('parentId', parentId || null)}
              searchable
              options={[
                { value: '', label: 'No parent' },
                ...state.presets
                  .filter((item) => item.id !== value.id)
                  .map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </label>
          <label>
            Stack tags
            <input
              value={stacks}
              onChange={(event) => setStacks(event.target.value)}
              placeholder="mobile, expo"
            />
          </label>
        </div>
        {inherited && (
          <Notice>
            <GitBranch size={14} />
            Inherits{' '}
            {chain(state.presets, inherited)
              .map((item) => item.name)
              .join(' → ')}
            . Cycles are rejected.
          </Notice>
        )}
        <label>
          Skill name selectors <span>One per line. Missing matches are reported during setup.</span>
          <textarea
            rows={6}
            className="code-editor"
            value={selectors}
            onChange={(event) => setSelectors(event.target.value)}
            placeholder="react-native-best-practices"
          />
        </label>
        <p className="field-label">Default agents</p>
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
          <summary>Explicit library picks and exclusions</summary>
          {advanced && (
            <>
              <SearchBox
                value={pickQuery}
                onChange={setPickQuery}
                placeholder="Find a skill or MCP snapshot…"
              />
              <p className="field-help">
                Showing up to 60 matching snapshots. Included and excluded pins stay selected when
                hidden.
              </p>
              <div className="explicit-picks">
                {state.entries
                  .filter(
                    (entry) =>
                      (!entry.archived ||
                        value.entryIds.includes(entry.id) ||
                        value.excludedIds.includes(entry.id)) &&
                      (entry.kind === 'skill' || entry.kind === 'mcp') &&
                      `${entry.name} ${entry.tags.join(' ')}`
                        .toLowerCase()
                        .includes(pickQuery.toLowerCase()),
                  )
                  .slice(0, 60)
                  .map((entry) => (
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
                        Include
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
                        Exclude
                      </label>
                    </div>
                  ))}
              </div>
            </>
          )}
        </details>
        <div className="modal-actions">
          <div className="button-row">
            {!isNew && (
              <>
                <Button variant="ghost" onClick={() => void duplicate()}>
                  <Copy size={14} />
                  Duplicate
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(true)}>
                  <Trash2 size={14} />
                  Remove
                </Button>
              </>
            )}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                Save preset <Check size={15} />
              </>
            )}
          </Button>
        </div>
        {deleting && (
          <Notice tone="warning">
            Remove this preset? Child presets must be reassigned first.
            <div className="button-row">
              <Button
                variant="danger"
                onClick={() => {
                  void api(`presets/${apiId(preset.id)}`, 'DELETE')
                    .then(refresh)
                    .then(onClose)
                    .catch((error) => notify(error.message, true));
                }}
              >
                Remove preset
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
            </div>
          </Notice>
        )}
      </form>
    </Modal>
  );
}
