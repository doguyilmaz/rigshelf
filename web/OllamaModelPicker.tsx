import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { OllamaModel } from '../src/platform/ollama-models';
import { api } from './api';
import { t } from './i18n';
import { Select } from './Select';

export function OllamaModelPicker({
  id,
  label,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<OllamaModel[]>();
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError('');
    try {
      const items = await api<OllamaModel[]>('ai/ollama-models', 'GET', undefined, pending.signal);
      if (!pending.signal.aborted) setModels(items);
    } catch (failure) {
      if (!pending.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!pending.signal.aborted) setLoading(false);
    }
  }
  const options = (models || []).map((model) => ({
    value: model.name,
    label: model.name,
    group: model.isRemote ? t('Remote via Ollama') : undefined,
  }));
  if (value && !options.some((item) => item.value === value))
    options.unshift({
      value,
      label: value,
      group: t(models ? 'Saved choice · not listed' : 'Saved choice · not checked'),
    });
  return (
    <div className="ollama-model-picker">
      {manual ? (
        <input
          id={id}
          aria-label={label}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('Your installed model name')}
          disabled={disabled}
          maxLength={100}
        />
      ) : (
        <Select
          {...{ id, label, value, onValueChange, options, disabled, loading }}
          searchable
          placeholder={t('Choose an installed model')}
          emptyText={t(
            error
              ? 'Could not load models. Retry below or enter a name.'
              : models?.length === 0
                ? 'No models found. Add a model in Ollama, then retry.'
                : 'No matching models.',
          )}
          onOpenChange={(open) => {
            if (open && !models && !loading) void load();
            if (!open && loading) {
              controller.current?.abort();
              setLoading(false);
            }
          }}
        />
      )}
      <div className="ollama-model-actions">
        <button
          type="button"
          className="inline-button"
          disabled={disabled || loading}
          onClick={() => setManual((current) => !current)}
        >
          {t(manual ? 'Choose from installed models' : 'Enter model name')}
        </button>
        <button
          type="button"
          className="inline-button"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          <RefreshCw size={11} />
          {t('Refresh models')}
        </button>
      </div>
      {error && (
        <p className="field-help" role="status">
          {t(error)}
        </p>
      )}
      {models?.length === 0 && !error && (
        <p className="field-help" role="status">
          {t('No models found. Add a model in Ollama, then retry.')}
        </p>
      )}
      {models?.find((model) => model.name === value)?.isRemote && (
        <p className="field-help" role="status">
          {t('Ollama reports this as a remote model. Its service controls routing and usage.')}
        </p>
      )}
    </div>
  );
}
