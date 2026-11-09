import { useId, useState } from 'react';
import type { Provider } from '../src/core/model';
import { api } from './api';
import { Button, CopyButton } from './components';
import { t } from './i18n';
import { Select } from './Select';

export function AiSessionConnection({ initialProvider }: { initialProvider?: string }) {
  const fieldId = useId();
  const options = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex / T3 Code' },
    { value: 'kiro', label: 'Kiro CLI' },
    { value: 'opencode', label: 'OpenCode' },
    { value: 'antigravity', label: 'Antigravity / agy' },
    { value: 'grok', label: 'Grok' },
  ];
  const [provider, setProvider] = useState(
    options.some((item) => item.value === initialProvider) ? initialProvider! : 'codex',
  );
  const [result, setResult] = useState<{ file: string; content: string; note: string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      setResult(
        await api('connection', 'POST', { provider: provider as Provider, writable: false }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="ai-session-connection">
      <summary>{t('Connect Claude, Codex, Kiro, OpenCode, agy or Grok')}</summary>
      <p className="field-help">
        {t(
          'Choose the model in that Agent: Haiku/Sonnet, Luna/Terra, Flash or an available free model. Rigshelf receives its proposal through MCP; this panel cannot switch a running session’s model or send it a message automatically.',
        )}
      </p>
      <label className="field-label" htmlFor={fieldId}>
        {t('Connection harness')}
      </label>
      <Select
        id={fieldId}
        label={t('Connection harness')}
        value={provider}
        options={options}
        onValueChange={(next) => {
          setProvider(next);
          setResult(undefined);
        }}
        disabled={busy}
      />
      <Button variant="secondary" disabled={busy} onClick={() => void prepare()}>
        {t('Prepare read-only connection')}
      </Button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>
            {t('Merge into ')}
            <code>{result.file}</code>
          </p>
          <pre className="content-preview">{result.content}</pre>
          <CopyButton text={result.content} />
          <p className="field-help">{result.note}</p>
          <p className="field-help">
            {t(
              'The rigshelf command must be on PATH. Restart or reconnect MCP in your Agent, then choose Ask connected Agent and copy the pending request. Draft proposals require no project write permission.',
            )}
          </p>
        </div>
      )}
    </details>
  );
}
