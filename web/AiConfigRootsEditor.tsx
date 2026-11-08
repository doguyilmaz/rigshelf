import { useState } from 'react';
import type { AiConfigRoot } from '../src/core/inventory-paths';
import type { Settings } from '../src/core/model';
import { api, shortPath } from './api';
import { Button } from './components';
import { DirectoryPathInput } from './DirectoryPathInput';
import { t } from './i18n';
import { Select } from './Select';

export function AiConfigRootsEditor({
  value,
  onChange,
  enabled,
}: {
  value: Settings['aiConfigRoots'];
  onChange: (roots: Settings['aiConfigRoots']) => void;
  enabled: boolean;
}) {
  const [path, setPath] = useState('');
  const [provider, setProvider] = useState<Settings['aiConfigRoots'][number]['provider']>('claude');
  const [observed, setObserved] = useState<{ roots: AiConfigRoot[]; warnings: string[] }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function inspect() {
    setLoading(true);
    setError('');
    try {
      setObserved(await api('ai-config-roots'));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <details className="ai-config-roots">
      <summary>{t('Profiles and custom AI folders')}</summary>
      <p className="field-help">
        {t(
          'Default, environment and Aims folders are discovered automatically. For other managers, add the folder containing native Skills, MCP configuration or guidance. Conversation databases and account stores are excluded.',
        )}
      </p>
      {!enabled && (
        <p role="status">
          {t('Enable global discovery above to include these folders in the next scan.')}
        </p>
      )}
      <div className="editor-form">
        <label htmlFor="ai-config-path">{t('AI configuration folder')}</label>
        <DirectoryPathInput
          id="ai-config-path"
          label={t('AI configuration folder')}
          value={path}
          onValueChange={setPath}
        />
        <label htmlFor="ai-config-format">{t('Native configuration format')}</label>
        <Select
          id="ai-config-format"
          label={t('Native configuration format')}
          value={provider}
          onValueChange={(next) => setProvider(next as typeof provider)}
          options={[
            'claude',
            'codex',
            'kiro',
            'opencode',
            'antigravity',
            'gemini',
            'grok',
            'custom',
          ].map((value) => ({
            value,
            label: value === 'custom' ? t('Shared Skills and Markdown guidance') : value,
          }))}
        />
        <Button
          variant="secondary"
          disabled={!path.trim() || value.length >= 20}
          onClick={() => {
            if (!value.some((root) => root.path === path.trim() && root.provider === provider))
              onChange([...value, { path: path.trim(), provider }]);
            setPath('');
          }}
        >
          {t('Include this folder')}
        </Button>
      </div>
      {!!value.length && (
        <ul className="config-root-list">
          {value.map((root, index) => (
            <li key={`${root.path}:${root.provider}`}>
              <span>
                <code title={root.path}>{shortPath(root.path)}</code>
                <small>{root.provider}</small>
              </span>
              <Button
                variant="ghost"
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                {t('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="field-help">
        {t(
          'Save preferences, then scan. Removing a folder changes discovery only; it never deletes its files.',
        )}
      </p>
      <Button variant="secondary" disabled={loading} onClick={() => void inspect()}>
        {t('Show detected configuration folders')}
      </Button>
      {error && <p role="alert">{error}</p>}
      {observed && (
        <div role="status">
          <ul className="config-root-list">
            {observed.roots.map((root) => (
              <li key={`${root.provider}:${root.path}`}>
                <span>
                  <code title={root.path}>{shortPath(root.path)}</code>
                  <small>
                    {root.provider} · {t(root.origin)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          {observed.warnings.map((warning) => (
            <p key={warning} className="field-help">
              {warning}
            </p>
          ))}
        </div>
      )}
    </details>
  );
}
