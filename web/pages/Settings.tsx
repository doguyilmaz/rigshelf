import { ArrowRight, Download, HardDrive, Save, ShieldCheck, Terminal, Upload } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import type { ImportReview } from '../../src/core/backup';
import type { Provider, Settings as SettingsValue } from '../../src/core/model';
import { accessToken, api, shortPath } from '../api';
import { Button, CopyButton, Modal, Notice, PageHeader, Spinner } from '../components';
import { useDraftGuard } from '../drafts';
import { countText } from '../format';
import type { PageProps } from '../main';

export function Settings({ state, refresh, notify }: PageProps): ReactNode {
  const [value, setValue] = useState(state.settings);
  const [roots, setRoots] = useState(state.settings.roots.join('\n'));
  useDraftGuard(
    JSON.stringify(value) !== JSON.stringify(state.settings) ||
      roots !== state.settings.roots.join('\n'),
    'Settings',
  );
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState<Blob>();
  const [preview, setPreview] = useState<ImportReview>();
  const file = useRef<HTMLInputElement>(null);
  const update = <Key extends keyof SettingsValue>(key: Key, next: SettingsValue[Key]) =>
    setValue((current) => ({ ...current, [key]: next }));
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api<SettingsValue>('settings', 'PUT', {
        ...value,
        discoveryQueries: (value.discoveryQueries || [])
          .map((query) => query.trim())
          .filter(Boolean),
        roots: roots
          .split('\n')
          .map((path) => path.trim())
          .filter(Boolean),
      });
      setValue(saved);
      setRoots(saved.roots.join('\n'));
      await refresh();
      notify('Workbench preferences saved');
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function exportData(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch('/api/library-export', {
        headers: { 'x-kitfold-token': accessToken() },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kitfold-library-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const excluded = Number(response.headers.get('x-kitfold-excluded') || 0);
      notify(
        excluded
          ? `Library exported with ${excluded} sensitive-looking records excluded. The archive includes their names and reasons.`
          : 'Portable library exported. Treat your custom content as private.',
      );
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(selected: File): Promise<void> {
    setBusy(true);
    try {
      if (selected.size > 512 * 1024 * 1024)
        throw new Error('JSON imports are limited to 512 MiB.');
      const compressed = selected.name.endsWith('.gz')
        ? selected
        : await new Response(selected.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      if (compressed.size > 128 * 1024 * 1024)
        throw new Error('Compressed import exceeds 128 MiB. Use the CLI for larger libraries.');
      setBundle(compressed);
      setPreview(await upload(compressed, false));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  async function upload(data: Blob, apply: boolean): Promise<NonNullable<typeof preview>> {
    const response = await fetch(`/api/library-import?apply=${apply ? '1' : '0'}`, {
      method: 'POST',
      headers: { 'x-kitfold-token': accessToken(), 'content-type': 'application/gzip' },
      body: data,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  return (
    <>
      <PageHeader
        eyebrow="ON YOUR TERMS"
        title="Make yourself at home."
        description="Local storage, deliberate automation, and no account to manage."
      />
      <div className="settings-layout">
        <form onSubmit={(event) => void save(event)} className="settings-main editor-form">
          <section className="settings-section">
            <h2>Where to look</h2>
            <p>
              Scan these development folders. Existing project files are read, never changed by
              scanning.
            </p>
            <label>
              Project roots <span>One absolute path or ~/ path per line</span>
              <textarea
                rows={4}
                className="code-editor"
                value={roots}
                onChange={(event) => setRoots(event.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.scanGlobals}
                onChange={(event) => update('scanGlobals', event.target.checked)}
              />
              Also discover global skills and MCP definitions
            </label>
          </section>
          <section className="settings-section">
            <h2>Your usual agents</h2>
            <p>A starting selection for new project setups.</p>
            <div className="agent-checks">
              {state.adapters.map((agent) => (
                <label className="check-label" key={agent.id}>
                  <input
                    type="checkbox"
                    checked={value.defaultProviders.includes(agent.id)}
                    onChange={(event) =>
                      update(
                        'defaultProviders',
                        event.target.checked
                          ? [...value.defaultProviders, agent.id]
                          : value.defaultProviders.filter((item) => item !== agent.id),
                      )
                    }
                  />
                  {agent.name}
                </label>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h2>AI, when you ask</h2>
            <p>
              Use the MCP tools in an active agent session. For CLI selections, the review button
              prepares a prompt. Ollama can produce a proposal locally.
            </p>
            <div className="form-two-columns">
              <label>
                Review provider
                <select
                  value={value.aiRunner}
                  onChange={(event) =>
                    update('aiRunner', event.target.value as SettingsValue['aiRunner'])
                  }
                >
                  <option value="none">Current agent / MCP handoff</option>
                  {['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok', 'ollama'].map(
                    (runner) => (
                      <option value={runner} key={runner}>
                        {runner === 'ollama'
                          ? 'Ollama · local generation'
                          : `${runner} · prompt handoff`}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {value.aiRunner === 'ollama' && (
                <label>
                  Ollama model
                  <input
                    value={value.ollamaModel}
                    onChange={(event) => update('ollamaModel', event.target.value)}
                    placeholder="Your installed model name"
                  />
                </label>
              )}
            </div>
          </section>
          <section className="settings-section">
            <h2>Keep sources current</h2>
            <p>
              Optional source checks run while this workbench is open. They record suggestions and
              never replace installed snapshots.
            </p>
            <label>
              Check known sources every
              <select
                value={value.discoveryDays}
                onChange={(event) => update('discoveryDays', Number(event.target.value))}
              >
                <option value={0}>Only when I ask</option>
                <option value={1}>Day</option>
                <option value={7}>Week</option>
                <option value={30}>Month</option>
              </select>
            </label>
            <label>
              Optional directory searches{' '}
              <span>
                Public technology terms, one per line. Sent to skills.sh at the interval above.
              </span>
              <textarea
                rows={3}
                value={(value.discoveryQueries || []).join('\n')}
                onChange={(event) => update('discoveryQueries', event.target.value.split('\n'))}
                placeholder="Expo\nSwiftUI\nKotlin"
              />
            </label>
            <Notice>
              Automatic project additions are enabled per project, and only for exact snapshots you
              approve in the library.
            </Notice>
          </section>
          <div className="editor-bottom">
            <span className="muted">Everything is stored on this machine.</span>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  <Save size={15} />
                  Save preferences
                </>
              )}
            </Button>
          </div>
        </form>
        <aside className="settings-aside">
          <section className="settings-card">
            <HardDrive size={22} />
            <h3>Yours to keep.</h3>
            <p>The catalog and snapshots live outside your project source.</p>
            <code>{shortPath(state.dataDirectory)}</code>
            <div className="button-row">
              <Button variant="secondary" onClick={() => void exportData()} disabled={busy}>
                <Download size={14} />
                Export library
              </Button>
              <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
                <Upload size={14} />
                Import
              </Button>
              <input
                ref={file}
                type="file"
                accept="application/json,application/gzip,.json,.gz"
                hidden
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) void importFile(selected);
                }}
              />
            </div>
            <small>
              Compressed, versioned JSON. Skills, sources, presets and rules. Projects, sessions,
              and setup preimages are excluded.
            </small>
          </section>
          <section className="settings-card">
            <Terminal size={22} />
            <h3>At home in your session.</h3>
            <p>
              Connect the stdio MCP server to your agent. Start with read/plan tools; enable writes
              only for authorized setup.
            </p>
            <ConnectionEditor {...{ state, notify }} />
          </section>
          <section className="privacy-card">
            <ShieldCheck size={18} />
            <div>
              <strong>No conversations. No telemetry.</strong>
              <p>
                Memory files are viewed on request. No session transcripts or credential stores are
                collected.
              </p>
            </div>
          </section>
        </aside>
      </div>
      {preview && (
        <Modal
          title="Import review"
          subtitle="The import adds to your private library; it does not modify any project."
          onClose={() => setPreview(undefined)}
        >
          <p>
            {countText(preview.entries, 'capability', 'capabilities')},{' '}
            {countText(preview.sources, 'source')}, {countText(preview.presets, 'preset')}, and{' '}
            {countText(preview.rules, 'directive')} in this export.
          </p>
          {preview.directives.length > 0 && (
            <details className="advanced">
              <summary>Review directives and scopes</summary>
              <p className="field-help">
                Enabled directives are included in future reviewed setup plans. Existing project
                guidance is preserved until a new plan is applied.
              </p>
              {preview.directives.map((rule) => (
                <div key={rule.id} className="provenance-receipt">
                  <strong>{rule.name}</strong>
                  <code>{rule.scope}</code>
                  <small>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                    {rule.findings.length ? ' · Content needs review' : ''}
                  </small>
                </div>
              ))}
            </details>
          )}
          {preview.conflicts.length ? (
            <Notice tone="warning">
              Resolve these conflicts first: {preview.conflicts.join(', ')}
            </Notice>
          ) : (
            <Notice>No conflicting records found.</Notice>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setPreview(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={preview.conflicts.length > 0 || busy}
              onClick={() => {
                setBusy(true);
                void (
                  bundle
                    ? upload(bundle, true)
                    : Promise.reject(new Error('Choose an archive first.'))
                )
                  .then(refresh)
                  .then(() => {
                    notify('Library imported');
                    setPreview(undefined);
                  })
                  .catch((error) => notify(error.message, true))
                  .finally(() => setBusy(false));
              }}
            >
              Import library <ArrowRight size={15} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ConnectionEditor({ state, notify }: Pick<PageProps, 'state' | 'notify'>): ReactNode {
  const [provider, setProvider] = useState<Provider>('claude');
  const [writable, setWritable] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [result, setResult] = useState<{ file: string; content: string; note: string }>();
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    try {
      setResult(await api('connection', 'POST', { provider, writable, projectPath }));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor-form">
      <label>
        Connection harness
        <select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as Provider);
            setResult(undefined);
          }}
        >
          {state.adapters.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.name}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={writable}
          onChange={(event) => {
            setWritable(event.target.checked);
            setResult(undefined);
          }}
        />
        Enable write tools
      </label>
      {writable && (
        <label>
          Allowed project root
          <input
            value={projectPath}
            onChange={(event) => {
              setProjectPath(event.target.value);
              setResult(undefined);
            }}
            placeholder="/absolute/project/path"
          />
        </label>
      )}
      <Button
        variant="secondary"
        disabled={busy || (writable && !projectPath.trim())}
        onClick={() => void prepare()}
      >
        Prepare connection
      </Button>
      {result && (
        <>
          <p>
            Merge into <code>{result.file}</code>
          </p>
          <pre className="content-preview">{result.content}</pre>
          <CopyButton text={result.content} />
          <small>{result.note}</small>
        </>
      )}
      <small>
        Register the executable with <code>bun link</code> in this checkout. Preserve existing
        settings when merging. Writable connections can also edit your private library.
      </small>
    </div>
  );
}
