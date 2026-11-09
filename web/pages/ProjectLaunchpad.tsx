import { ArrowRight, BookOpen, FolderOpen, ScanLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, shortPath } from '../api';
import { Button, Notice, Spinner } from '../components';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { ProjectPathInput } from '../ProjectPathInput';
import { recentProjectIds } from '../recent-projects';
import type { SetupController } from '../useProjectSetup';

export function ProjectLaunchpad({
  setup,
  state,
  notify,
  refresh,
  navigate,
  active,
  onLearn,
}: PageProps & { setup: SetupController; active: boolean }) {
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const projects = useMemo(() => {
    const recent = recentProjectIds();
    return [...state.projects]
      .sort((left, right) => {
        const leftIndex = recent.indexOf(left.id),
          rightIndex = recent.indexOf(right.id);
        if (leftIndex !== -1 || rightIndex !== -1)
          return (
            (leftIndex === -1 ? recent.length : leftIndex) -
            (rightIndex === -1 ? recent.length : rightIndex)
          );
        return left.name.localeCompare(right.name);
      })
      .filter((project) =>
        `${project.name} ${project.path} ${project.stacks.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
  }, [state.projects, query]);
  async function discover() {
    setScanning(true);
    try {
      await api('scan', 'POST', {});
      await refresh();
      notify(t('Finding your projects and existing tools. Nothing is installed or changed.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setScanning(false);
    }
  }
  const changed = setup.candidatePath.trim() !== setup.path;
  return (
    <div className="project-launchpad">
      <div className="launchpad-intro">
        <p className="launchpad-eyebrow">{t('A fresh start for every project')}</p>
        <h1>{t('Set up a project')}</h1>
        <p>{t('The right Skills, MCP and guidance. Ready for the agents you use.')}</p>
      </div>
      {setup.recoveryDraft && (
        <section className="launchpad-recovery" aria-label={t('Unfinished project kit')}>
          <div>
            <strong>{t('Continue your unfinished kit?')}</strong>
            <p>{shortPath(setup.recoveryDraft.path)}</p>
            <small>
              {t(
                'Kept in this tab. We inspect again before you review; permissions are never restored.',
              )}
            </small>
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={setup.discardRecoveryDraft}>
              {t('Discard draft')}
            </Button>
            <Button onClick={setup.resumeDraft}>
              {t('Continue kit')}
              <ArrowRight size={14} />
            </Button>
          </div>
        </section>
      )}
      <section className="launchpad-folder" aria-label={t('Project')}>
        <div className="launchpad-folder-heading">
          <span>
            <FolderOpen size={21} />
          </span>
          <div>
            <h2>{t('Where are you working?')}</h2>
            <p>{t('Choose a folder or type a path for a new project.')}</p>
          </div>
        </div>
        <label className="field-label" htmlFor="project-path">
          {t('Project directory')}
        </label>
        <ProjectPathInput
          value={setup.candidatePath}
          projects={state.projects}
          onValueChange={setup.changeCandidate}
          onCommit={setup.chooseProject}
          active={active}
        />
        <div className="launchpad-folder-footer">
          <p>{t('We inspect first. You review every change before applying.')}</p>
          {!!setup.candidatePath.trim() && (!setup.detected || changed) && (
            <Button disabled={setup.busy} onClick={() => setup.chooseProject(setup.candidatePath)}>
              {setup.busy ? (
                <Spinner text={t('Reading the project')} />
              ) : (
                <>
                  {t('Build my kit')}
                  <ArrowRight size={15} />
                </>
              )}
            </Button>
          )}
        </div>
        {setup.busy && (
          <div role="status">
            <Spinner text={t('Inspecting the selected project…')} />
          </div>
        )}
        {setup.inspectionError && <Notice tone="warning">{setup.inspectionError}</Notice>}
      </section>
      <div className="launchpad-lower">
        <section className="launchpad-projects" aria-label={t('Known projects')}>
          <div className="launchpad-section-heading">
            <h2>{t('Pick up a project')}</h2>
            <button type="button" className="inline-button" onClick={() => navigate('projects')}>
              {t('View all projects')}
              <ArrowRight size={13} />
            </button>
          </div>
          {state.projects.length > 4 && (
            <label className="launchpad-project-search">
              <span className="sr-only">{t('Search recent projects')}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Find by name, folder or stack…')}
              />
            </label>
          )}
          {projects.length ? (
            <div className="setup-known-projects launchpad-project-list">
              {projects.slice(0, 5).map((project) => {
                const last = state.plans
                  .filter((plan) => plan.projectPath === project.path && plan.status === 'applied')
                  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
                return (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => setup.chooseProject(project.path)}
                  >
                    <span className="launchpad-project-icon">
                      <FolderOpen size={18} />
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <small>{shortPath(project.path)}</small>
                    </span>
                    <span className="launchpad-project-state">
                      {t(last ? 'Previously prepared' : 'Not prepared here')}
                    </span>
                    <ArrowRight size={14} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="launchpad-empty">
              <p>
                {t(
                  query
                    ? 'No projects match. Try a folder or stack name.'
                    : 'Your projects will appear here as you prepare them.',
                )}
              </p>
              {onLearn && (
                <button type="button" className="inline-button" onClick={() => onLearn('example')}>
                  {t('Try with a safe example')}
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          )}
        </section>
        <aside className="launchpad-side">
          <div className="launchpad-import">
            <ScanLine size={21} />
            <h2>{t('Bring what you already use')}</h2>
            <p>
              {t(
                'Find existing Skills, MCP and Plugins in your development folders and agent settings. They stay private in Library until you choose them for a project.',
              )}
            </p>
            <Button
              variant="secondary"
              disabled={scanning || state.scan.state === 'running'}
              onClick={() => void discover()}
            >
              {state.scan.state === 'running' ? (
                <Spinner text={t('Scanning your folders…')} />
              ) : (
                t('Find my projects & tools')
              )}
            </Button>
            <button type="button" className="inline-button" onClick={() => navigate('settings')}>
              {t('Choose folders to scan')}
            </button>
          </div>
          <div className="launchpad-how">
            <BookOpen size={18} />
            <div>
              <strong>{t('A kit, not a global install')}</strong>
              <p>
                {t(
                  'Keep everything in Library. Give each project only what it needs, in each agent’s own format.',
                )}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
