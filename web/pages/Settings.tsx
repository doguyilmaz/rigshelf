import { ArrowRight, HardDrive, Save, ShieldCheck, Terminal, Upload } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { defaultDraftModel } from '../../src/core/ai-models';
import type { ImportReview } from '../../src/core/backup';
import type { Provider, Settings as SettingsValue } from '../../src/core/model';
import { AiConfigRootsEditor } from '../AiConfigRootsEditor';
import { AiConnectionEditor } from '../AiConnectionEditor';
import { AiModelPicker } from '../AiModelPicker';
import { accessToken, api, shortPath } from '../api';
import { BackupReviewPanel } from '../BackupReviewPanel';
import { Button, CopyButton, Modal, Notice, PageHeader, Spinner } from '../components';
import { BrowseDirectoryButton, DirectoryPathInput } from '../DirectoryPathInput';
import { useDraftGuard } from '../drafts';
import { countText } from '../format';
import { InventoryHistory } from '../InventoryHistory';
import { languages, setLocale, t, useLocaleState } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { OllamaModelPicker } from '../OllamaModelPicker';
import { Select } from '../Select';

export function Settings({ state, refresh, notify, navigate }: PageProps): ReactNode {
  const localeState = useLocaleState();
  const locale = localeState.locale;
  const [value, setValue] = useState(state.settings);
  const [roots, setRoots] = useState(state.settings.roots.join('\n'));
  useDraftGuard(
    JSON.stringify(value) !== JSON.stringify(state.settings) ||
      roots !== state.settings.roots.join('\n'),
    t('Settings'),
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
      notify(t('Workbench preferences saved'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function exportData(expected: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/library-export?expected=${encodeURIComponent(expected)}`, {
        headers: { 'x-rigshelf-token': accessToken() },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rigshelf-library-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const excluded = Number(response.headers.get('x-rigshelf-excluded') || 0);
      notify(
        excluded
          ? t(
              'Library exported with {{count}} sensitive-looking records excluded. The archive includes their names and reasons.',
              { count: excluded },
            )
          : t('Portable library exported. Treat your custom content as private.'),
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
        throw new Error(t('JSON imports are limited to 512 MiB.'));
      const compressed = selected.name.endsWith('.gz')
        ? selected
        : await new Response(selected.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      if (compressed.size > 128 * 1024 * 1024)
        throw new Error(t('Compressed import exceeds 128 MiB. Use the CLI for larger libraries.'));
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
      headers: { 'x-rigshelf-token': accessToken(), 'content-type': 'application/gzip' },
      body: data,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  return (
    <>
      <PageHeader
        eyebrow={t('ON YOUR TERMS')}
        title={t('Settings')}
        description={t('Local storage, deliberate automation, and no account to manage.')}
      />
      <div className="settings-layout">
        <form onSubmit={(event) => void save(event)} className="settings-main editor-form">
          <section className="settings-section">
            <h2>{t('Language')}</h2>
            <label htmlFor="interface-language">
              {t('Interface language')}
              <Select
                id="interface-language"
                label={t('Interface language')}
                value={locale}
                onValueChange={(next) => void setLocale(next)}
                disabled={Boolean(localeState.loading)}
                options={languages}
              />
            </label>
            <p>
              {localeState.loading
                ? t('Loading language…')
                : t(
                    localeState.error ||
                      'Language changes apply immediately and are remembered in this browser.',
                  )}
            </p>
          </section>
          <section className="settings-section">
            <h2>{t('Where to look')}</h2>
            <p>
              {t(
                'Scan these development folders. Existing project files are read, never changed by scanning.',
              )}
            </p>
            <label>
              {t('Project roots ')}
              <span>{t('One absolute path or ~/ path per line')}</span>
              <textarea
                rows={4}
                className="code-editor"
                value={roots}
                onChange={(event) => setRoots(event.target.value)}
              />
            </label>
            <div className="directory-actions">
              <BrowseDirectoryButton
                label={t('Add project root folder')}
                text={t('Add folder')}
                initialPath={roots
                  .split('\n')
                  .find((path) => path.trim())
                  ?.trim()}
                onSelect={(path) =>
                  setRoots((current) => {
                    const existing = current
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean);
                    return existing.includes(path)
                      ? current
                      : `${current.trimEnd()}${current.trim() ? '\n' : ''}${path}`;
                  })
                }
              />
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.scanGlobals}
                onChange={(event) => update('scanGlobals', event.target.checked)}
              />
              {t('Also discover global skills and MCP definitions')}
            </label>
            <AiConfigRootsEditor
              value={value.aiConfigRoots}
              onChange={(roots) => update('aiConfigRoots', roots)}
              enabled={value.scanGlobals}
            />
          </section>
          <section className="settings-section">
            <h2>{t('Your usual agents')}</h2>
            <p>{t('A starting selection for new project setups.')}</p>
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
            <h2>{t('AI, when you ask')}</h2>
            <p>
              {t(
                'Create and format drafts with Claude Code, Codex or Ollama. Your connected Agent can also answer draft requests through MCP. Generation runs only when you ask; review before saving.',
              )}
            </p>
            <div className="form-two-columns">
              <label htmlFor="review-provider">
                {t('Review provider')}
                <Select
                  label={t('Review provider')}
                  id="review-provider"
                  value={value.aiRunner}
                  onValueChange={(runner) => {
                    setValue((current) => ({
                      ...current,
                      aiRunner: runner as SettingsValue['aiRunner'],
                      aiModel: defaultDraftModel(runner),
                    }));
                  }}
                  options={[
                    { value: 'none', label: t('Choose in AI panels') },
                    { value: 'session', label: t('Current Agent · MCP drafts') },
                    { value: 'compatible', label: t('API connection') },
                    ...['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok', 'ollama'].map(
                      (runner) => ({
                        value: runner,
                        label:
                          runner === 'ollama'
                            ? t('Ollama · local generation')
                            : ['claude', 'codex'].includes(runner)
                              ? t('{{runner}} · direct drafts', { runner })
                              : t('{{runner}} · connected Agent via MCP', { runner }),
                      }),
                    ),
                  ]}
                />
              </label>
              {value.aiRunner === 'ollama' && (
                <div>
                  <label className="field-label" htmlFor="settings-ollama-model">
                    {t('Ollama model')}
                  </label>
                  <OllamaModelPicker
                    id="settings-ollama-model"
                    label={t('Ollama model')}
                    value={value.ollamaModel}
                    onValueChange={(model) => update('ollamaModel', model)}
                  />
                </div>
              )}
              {(value.aiRunner === 'claude' || value.aiRunner === 'codex') && (
                <div>
                  <label className="field-label" htmlFor="settings-ai-model">
                    {t('Model')}
                  </label>
                  <AiModelPicker
                    key={value.aiRunner}
                    id="settings-ai-model"
                    runner={value.aiRunner}
                    value={value.aiModel}
                    onValueChange={(model) => update('aiModel', model)}
                  />
                </div>
              )}
            </div>
            <AiConnectionEditor
              value={value.aiConnections}
              onChange={(connections) => update('aiConnections', connections)}
            />
          </section>
          <section className="settings-section">
            <h2>{t('Keep sources current')}</h2>
            <p>
              {t(
                'Optional source checks run while this workbench is open. They record suggestions and never replace installed snapshots.',
              )}
            </p>
            <label htmlFor="source-check-interval">
              {t('Check known sources every')}
              <Select
                label={t('Check known sources every')}
                id="source-check-interval"
                value={String(value.discoveryDays)}
                onValueChange={(days) => update('discoveryDays', Number(days))}
                options={[
                  { value: '0', label: t('Only when I ask') },
                  { value: '1', label: t('Day') },
                  { value: '7', label: t('Week') },
                  { value: '30', label: t('Month') },
                ]}
              />
            </label>
            <label>
              {t('Optional directory searches')}{' '}
              <span>
                {t(
                  'Public technology terms, one per line. Sent to skills.sh at the interval above.',
                )}
              </span>
              <textarea
                rows={3}
                value={(value.discoveryQueries || []).join('\n')}
                onChange={(event) => update('discoveryQueries', event.target.value.split('\n'))}
                placeholder={t('Expo\nSwiftUI\nKotlin')}
              />
            </label>
            <Notice>
              {t(
                'Automatic project additions are enabled per project, and only for exact snapshots you approve in the library.',
              )}
            </Notice>
          </section>
          <div className="editor-bottom">
            <span className="muted">{t('Everything is stored on this machine.')}</span>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  <Save size={15} />
                  {t('Save preferences')}
                </>
              )}
            </Button>
          </div>
        </form>
        <aside className="settings-aside">
          <section className="settings-card">
            <HardDrive size={22} />
            <h3>{t('Library storage')}</h3>
            <p>{t('The catalog and snapshots live outside your project source.')}</p>
            <code>{shortPath(state.dataDirectory)}</code>
            <div className="button-row">
              <Button onClick={() => navigate('backups')}>{t('Manage backups')}</Button>
              <Button variant="secondary" onClick={() => navigate('machines')}>
                {t('Machines')}
              </Button>
              <BackupReviewPanel disabled={busy} onDownload={exportData} notify={notify} />
              <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
                <Upload size={14} />
                {t('Import')}
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
              {t(
                'Compressed, versioned JSON. Skills, sources, presets and rules. Projects, sessions, and setup preimages are excluded.',
              )}
            </small>
          </section>
          <section className="settings-card">
            <Terminal size={22} />
            <h3>{t('At home in your session.')}</h3>
            <p>
              {t(
                'Connect the stdio MCP server to your agent. Start with read/plan tools; enable writes only for authorized setup.',
              )}
            </p>
            <ConnectionEditor {...{ state, notify }} />
          </section>
          <InventoryHistory notify={notify} />
          <section className="privacy-card">
            <ShieldCheck size={18} />
            <div>
              <strong>{t('No conversations. No telemetry.')}</strong>
              <p>
                {t(
                  'Memory files are viewed on request. No session transcripts or credential stores are collected.',
                )}
              </p>
            </div>
          </section>
        </aside>
      </div>
      <ModalPresence>
        {preview && (
          <Modal
            title={t('Import review')}
            subtitle={t('The import adds to your private library; it does not modify any project.')}
            onClose={() => setPreview(undefined)}
          >
            <p>
              {countText(preview.entries, 'capability', 'capabilities')},{' '}
              {countText(preview.sources, 'source')}, {countText(preview.presets, 'preset')}
              {t(', and')} {countText(preview.rules, 'directive')}
              {t(' in this export.')}
            </p>
            {preview.directives.length > 0 && (
              <details className="advanced">
                <summary>{t('Review directives and scopes')}</summary>
                <p className="field-help">
                  {t(
                    'Enabled directives are included in future reviewed setup plans. Existing project guidance is preserved until a new plan is applied.',
                  )}
                </p>
                {preview.directives.map((rule) => (
                  <div key={rule.id} className="provenance-receipt">
                    <strong>{rule.name}</strong>
                    <code>{rule.scope}</code>
                    <small>
                      {rule.enabled ? t('Enabled') : t('Disabled')}
                      {rule.findings.length ? t(' · Content needs review') : ''}
                    </small>
                  </div>
                ))}
              </details>
            )}
            {preview.conflicts.length ? (
              <Notice tone="warning">
                {t('Resolve these conflicts first: ')}
                {preview.conflicts.join(', ')}
              </Notice>
            ) : (
              <Notice>{t('No conflicting records found.')}</Notice>
            )}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setPreview(undefined)}>
                {t('Cancel')}
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
                {t('Import library ')}
                <ArrowRight size={15} />
              </Button>
            </div>
          </Modal>
        )}
      </ModalPresence>
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
      <label htmlFor="connection-harness">
        {t('Connection harness')}
        <Select
          label={t('Connection harness')}
          id="connection-harness"
          value={provider}
          onValueChange={(next) => {
            setProvider(next as Provider);
            setResult(undefined);
          }}
          options={state.adapters.map((adapter) => ({ value: adapter.id, label: adapter.name }))}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={writable}
          onChange={(event) => {
            setWritable(event.target.checked);
            setResult(undefined);
          }}
        />
        {t('Enable write tools')}
      </label>
      {writable && (
        <div className="directory-input-field">
          <label htmlFor="allowed-project-root">{t('Allowed project root')}</label>
          <DirectoryPathInput
            id="allowed-project-root"
            label={t('Allowed project root')}
            value={projectPath}
            onValueChange={(path) => {
              setProjectPath(path);
              setResult(undefined);
            }}
            placeholder={t('/absolute/project/path')}
          />
        </div>
      )}
      <Button
        variant="secondary"
        disabled={busy || (writable && !projectPath.trim())}
        onClick={() => void prepare()}
      >
        {t('Prepare connection')}
      </Button>
      {result && (
        <>
          <p>
            {t('Merge into ')}
            <code>{result.file}</code>
          </p>
          <pre className="content-preview">{result.content}</pre>
          <CopyButton text={result.content} />
          <small>{result.note}</small>
        </>
      )}
      <small>
        {t('Register the executable with ')}
        <code>{t('bun link')}</code>
        {t(
          ' in this checkout. Preserve existing settings when merging. Writable connections can also edit your private library.',
        )}
      </small>
    </div>
  );
}
