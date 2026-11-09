import { useState } from 'react';
import { draftModels } from '../src/core/ai-models';
import { t } from './i18n';
import { Select } from './Select';

export function AiModelPicker({
  id,
  runner,
  value,
  onValueChange,
  disabled,
  showHelp = true,
}: {
  id: string;
  runner: 'claude' | 'codex';
  value: string;
  onValueChange: (model: string) => void;
  disabled?: boolean;
  showHelp?: boolean;
}) {
  const [manual, setManual] = useState(false);
  const options = [
    ...draftModels[runner].map((item) => ({ value: item.value, label: t(item.label) })),
    { value: '', label: t('Provider default') },
  ];
  if (value && !options.some((item) => item.value === value)) options.push({ value, label: value });
  return (
    <div className="ai-model-picker">
      {manual ? (
        <input
          id={id}
          aria-label={t('Model')}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          maxLength={100}
          disabled={disabled}
          placeholder={t('Exact model ID')}
        />
      ) : (
        <Select
          id={id}
          label={t('Model')}
          value={value}
          options={options}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      )}
      <button
        type="button"
        className="inline-button"
        disabled={disabled}
        onClick={() => setManual((current) => !current)}
      >
        {t(manual ? 'Choose a suggested model' : 'Enter model ID')}
      </button>
      {showHelp && (
        <p className="field-help">
          {t(
            'Suggestions are not an account model list. Availability and usage depend on your CLI login. No automatic fallback to a larger model.',
          )}
        </p>
      )}
    </div>
  );
}
