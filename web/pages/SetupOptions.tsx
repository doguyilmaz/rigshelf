import { Check } from 'lucide-react';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { Select } from '../Select';
import type { SetupController } from '../useProjectSetup';

export function SetupOptions({
  setup,
  state,
}: {
  setup: SetupController;
  state: PageProps['state'];
}) {
  const agentNames = state.adapters
    .filter((agent) => setup.providers.includes(agent.id))
    .map((agent) => agent.name);
  return (
    <div className="setup-options">
      <details
        className="setup-disclosure"
        open={setup.agentsOpen || !setup.providers.length}
        onToggle={(event) => setup.setAgentsOpen(event.currentTarget.open)}
      >
        <summary>
          <span>{t('Agents')}</span>
          <span className="setup-summary-value">
            {agentNames.join(' · ') || t('Choose at least one agent')}
          </span>
        </summary>
        <div className="setup-disclosure-body">
          <p className="field-help">{t('One kit. Written in each agent’s own format.')}</p>
          <div className="agent-grid">
            {state.adapters.map((agent) => (
              <button
                type="button"
                key={agent.id}
                className={`agent-choice ${setup.providers.includes(agent.id) ? 'chosen' : ''}`}
                onClick={() => setup.toggleProvider(agent.id)}
                aria-pressed={setup.providers.includes(agent.id)}
              >
                <span>{agent.name}</span>
                <span className="checkbox">
                  {setup.providers.includes(agent.id) && <Check size={11} />}
                </span>
              </button>
            ))}
          </div>
          <p className="field-help">
            {t(
              'Using T3? Select its underlying agent harness. Model choice and skill discovery are separate.',
            )}
          </p>
        </div>
      </details>
      <details
        className="setup-disclosure"
        open={setup.optionsOpen}
        onToggle={(event) => setup.setOptionsOpen(event.currentTarget.open)}
      >
        <summary>
          <span>{t('Requirements & preset')}</span>
          <span className="setup-summary-value">
            {setup.preset === 'auto'
              ? t('Detected automatically')
              : state.presets.find((item) => item.id === setup.preset)?.name}
          </span>
        </summary>
        <div className="setup-disclosure-body">
          <label className="field-label" htmlFor="requirements">
            {t('What are you making? ')}
            <span>{t('Optional')}</span>
          </label>
          <textarea
            id="requirements"
            rows={2}
            value={setup.requirements}
            onChange={(event) => setup.changeRequirements(event.target.value)}
            placeholder={t('An Expo app with Better Auth and a Hono API…')}
          />
          <label className="field-label" htmlFor="preset-choice">
            {t('Starting preset')}
          </label>
          <Select
            id="preset-choice"
            label={t('Starting preset')}
            searchable
            value={setup.preset}
            onValueChange={setup.changePreset}
            options={[
              { value: 'auto', label: t('Detect from the project') },
              ...state.presets.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
          <p className="field-help">
            {t(
              'A preset guides suggestions. Your agent choices and manual kit selections stay yours.',
            )}
          </p>
        </div>
      </details>
      <details className="setup-disclosure">
        <summary>{t('Existing installations')}</summary>
        <div className="setup-disclosure-body">
          <label className="check-label">
            <input
              type="checkbox"
              checked={setup.replaceExisting}
              onChange={(event) => setup.changeReplacement(event.target.checked)}
            />
            {t('Replace differing skill files in this reviewed plan')}
          </label>
          <p className="field-help">
            {t(
              'Original bytes are retained for rollback. Symbolic links outside this project are protected. Keep this off for automatic additions.',
            )}
          </p>
        </div>
      </details>
    </div>
  );
}
