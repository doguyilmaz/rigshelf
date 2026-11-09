import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../../src/core/model';
import { api, apiId, formatDate } from '../api';
import { Badge, Button, Spinner } from '../components';
import { countText } from '../format';
import { t } from '../i18n';
import type { PageProps } from '../main';

export function ProjectMaintenance({
  project,
  state,
  refresh,
  notify,
  onPrepare,
}: Pick<PageProps, 'state' | 'refresh' | 'notify'> & { project: Project; onPrepare: () => void }) {
  const [busy, setBusy] = useState(false);
  const suggestion = state.suggestions?.find((item) => item.id === project.id);
  const installed = new Set(
    state.installations.filter((item) => item.projectId === project.id).map((item) => item.entryId),
  );
  const additions = suggestion?.additions.filter((item) => !installed.has(item.entry.id)) || [];
  const observed = state.entries.filter((item) => installed.has(item.id));
  const lastSetup = state.plans
    .filter((plan) => plan.projectPath === project.path && plan.status === 'applied')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  async function check() {
    setBusy(true);
    try {
      await api(`projects/${apiId(project.id)}/check`, 'POST', {});
      await refresh();
      notify(t('Project checked. Suggestions do not install or change files.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="project-maintenance" aria-label={t('Project setup overview')}>
      <div className="project-maintenance-heading">
        <div>
          <h3>{t('Ready for your next session')}</h3>
          <p>
            {lastSetup
              ? t('Last applied {{date}}. Inspect the kit before making changes.', {
                  date: formatDate(lastSetup.createdAt),
                })
              : t('Prepare a focused kit for this folder and the Agents you use.')}
          </p>
        </div>
        <Button onClick={onPrepare}>
          {t('Prepare this project')}
          <ArrowRight size={14} />
        </Button>
      </div>
      <div className="project-observations">
        <span>{countText(observed.filter((item) => item.kind === 'skill').length, 'Skill')}</span>
        <span>
          {countText(observed.filter((item) => item.kind === 'mcp').length, 'MCP server')}
        </span>
        <span>{countText(observed.filter((item) => item.kind === 'plugin').length, 'Plugin')}</span>
        <small>{t('Observed at the last scan or Apply. Not a live-session status.')}</small>
      </div>
      <div className="project-maintenance-check">
        <div>
          <strong>{t('Changed dependencies?')}</strong>
          <p>
            {t(
              'Check this project against the tools already in your Library. This only prepares suggestions.',
            )}
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void check()}>
          {busy ? (
            <Spinner text={t('Checking project…')} />
          ) : (
            <>
              <RefreshCw size={14} />
              {t('Check for tools')}
            </>
          )}
        </Button>
      </div>
      {suggestion && (
        <div className="project-check-result" role="status">
          <div>
            <Check size={15} />
            <strong>
              {additions.length
                ? t(
                    additions.length === 1
                      ? '1 tool you can review'
                      : '{{count}} tools you can review',
                    { count: additions.length },
                  )
                : t('No new Library tools suggested.')}
            </strong>
            <small>{formatDate(suggestion.createdAt)}</small>
          </div>
          {!!additions.length && (
            <>
              <p>
                {t(
                  'These are optional. Prepare the project to inspect suggestions and keep your exact existing choices.',
                )}
              </p>
              <div className="project-suggestion-names">
                {additions.slice(0, 8).map((item) => (
                  <Badge key={item.entry.id}>{item.entry.name}</Badge>
                ))}
                {additions.length > 8 && (
                  <span>{t('and {{count}} more', { count: additions.length - 8 })}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
