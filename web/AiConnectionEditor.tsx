import { Plus, Trash2 } from 'lucide-react';
import type { AiConnection } from '../src/core/ai-connections';
import { Button, Notice } from './components';
import { t } from './i18n';

export function AiConnectionEditor({
  value,
  onChange,
}: {
  value: AiConnection[];
  onChange: (next: AiConnection[]) => void;
}) {
  const update = (id: string, patch: Partial<AiConnection>) =>
    onChange(value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="editor-form ai-connections">
      <h3>{t('Your API connections')}</h3>
      <p>
        {t(
          'Connect a local or remote service that supports Chat Completions. No account is required by Rigshelf.',
        )}
      </p>
      {value.map((connection, index) => (
        <fieldset className="ai-connection" key={connection.id}>
          <legend>{connection.name || t('API connection')}</legend>
          <div className="form-two-columns">
            <label htmlFor={`connection-name-${index}`}>
              {t('Connection name')}
              <input
                id={`connection-name-${index}`}
                name={`connection-name-${index}`}
                autoComplete="off"
                maxLength={80}
                value={connection.name}
                onChange={(event) => update(connection.id, { name: event.target.value })}
              />
            </label>
            <label htmlFor={`connection-model-${index}`}>
              {t('Default model')}
              <input
                id={`connection-model-${index}`}
                name={`connection-model-${index}`}
                autoComplete="off"
                spellCheck={false}
                maxLength={100}
                value={connection.model}
                onChange={(event) => update(connection.id, { model: event.target.value })}
              />
            </label>
          </div>
          <label htmlFor={`connection-url-${index}`}>
            {t('API base URL')}
            <input
              id={`connection-url-${index}`}
              name={`connection-url-${index}`}
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="http://127.0.0.1:1234/v1"
              value={connection.baseUrl}
              onChange={(event) => update(connection.id, { baseUrl: event.target.value })}
            />
          </label>
          <p className="field-help">
            {t(
              'Include the API prefix, such as /v1. Remote connections require HTTPS. HTTP is allowed only on loopback.',
            )}
          </p>
          <label htmlFor={`connection-key-${index}`}>
            {t('API key environment variable')}
            <input
              id={`connection-key-${index}`}
              name={`connection-key-${index}`}
              autoComplete="off"
              spellCheck={false}
              placeholder="RIGSHELF_AI_TOKEN"
              value={connection.apiKeyEnv}
              onChange={(event) => update(connection.id, { apiKeyEnv: event.target.value })}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() => onChange(value.filter((item) => item.id !== connection.id))}
          >
            <Trash2 size={14} />
            {t('Remove connection')}
          </Button>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        disabled={value.length >= 12}
        onClick={() =>
          onChange([
            ...value,
            {
              id: `api-${crypto.randomUUID()}`,
              name: t('API connection'),
              baseUrl: 'http://127.0.0.1:1234/v1',
              model: '',
              apiKeyEnv: '',
            },
          ])
        }
      >
        <Plus size={14} />
        {t('Add API connection')}
      </Button>
      <Notice>
        {t(
          'Store only the environment variable name here, never the key. Use a RIGSHELF_AI_ prefix, set its value before starting Rigshelf, then restart. Connection profiles stay on this machine and are excluded from library exports.',
        )}
      </Notice>
    </div>
  );
}
