import { ArrowRight, Check, FolderOpen } from 'lucide-react';
import type { PlanView } from '../../src/core/plan-view';
import { shortPath } from '../api';
import { Button, CopyButton } from '../components';
import { t } from '../i18n';
import type { PageProps } from '../main';

export function SetupHandoff({
  plan,
  state,
  onHistory,
}: {
  plan: PlanView;
  state: PageProps['state'];
  onHistory: () => void;
}) {
  const agents = state.adapters.filter((agent) => plan.providers.includes(agent.id));
  const selected = state.entries.filter((entry) => plan.entries.includes(entry.id));
  const guidance = [
    ...new Set(agents.flatMap((agent) => (agent.instructions ? [agent.instructions] : []))),
  ];
  const brief = `Work in ${plan.projectPath}. Read this project's guidance (${guidance.join(', ')}), then use the project's Skills when relevant. Rigshelf has applied a reviewed project kit. Inspect the current project before making changes. Ask me what we should build next.`;
  return (
    <section className="setup-handoff" aria-label={t('Start working with your kit')}>
      <div className="handoff-heading">
        <span>
          <Check size={19} />
        </span>
        <div>
          <h3>{t('The kit is in your project.')}</h3>
          <p>{t('Open this folder in your Agent and start a fresh session.')}</p>
        </div>
      </div>
      <div className="handoff-project">
        <FolderOpen size={16} />
        <code>{shortPath(plan.projectPath)}</code>
        <CopyButton text={plan.projectPath} label={t('Copy project path')} />
      </div>
      <div className="handoff-agents">
        {agents.map((agent) => (
          <div key={agent.id}>
            <strong>{agent.name}</strong>
            <p>
              {t(
                'Start a new session in this project. Accept any trust or MCP prompts in the Agent.',
              )}
            </p>
            <details>
              <summary>{t('Project discovery paths')}</summary>
              <code>
                {[
                  agent.instructions,
                  selected.some((entry) => entry.kind === 'skill') ? agent.skills : null,
                  selected.some((entry) => entry.kind === 'mcp') ? agent.mcpFile : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </code>
              <small>{t(agent.note)}</small>
            </details>
          </div>
        ))}
      </div>
      <div className="handoff-next">
        <CopyButton text={brief} label={t('Copy a starting prompt')} />
        <Button variant="ghost" onClick={onHistory}>
          {t('View history & recovery')}
          <ArrowRight size={14} />
        </Button>
      </div>
      <p className="field-help">
        {t('This setup belongs to this folder. Your global agent installations stay in place.')}
      </p>
    </section>
  );
}
