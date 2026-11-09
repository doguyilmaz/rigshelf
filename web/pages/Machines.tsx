import { Server } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type {
  ProjectSync,
  SyncReport,
  SyncSection,
  SyncStatus,
} from '../../src/core/machine-compare';
import type { MachineDoctor } from '../../src/core/machine-doctor';
import type { AppliedPlan, PreparedSync } from '../../src/core/machine-ssh';
import { api } from '../api';
import { Badge, Button, Empty, Modal, Notice, PageHeader, Spinner } from '../components';
import { t } from '../i18n';
import { ModalPresence } from '../ModalPresence';
import type { PageProps } from '../main';
import { Select } from '../Select';

interface Compared {
  doctor: { here: MachineDoctor; there: MachineDoctor; sameVersion: boolean; issues: string[] };
  report: SyncReport;
}
interface Prepared {
  prepared: PreparedSync;
  skipped: { name: string; reason: string }[];
  withheld: { name: string; reason: string }[];
}

const LISTED_NAMES = 8;
const groupLabels: Record<string, string> = {
  skill: 'Skills',
  guidance: 'Guidance',
  mcp: 'MCP',
  settings: 'Settings',
  rules: 'Rules',
  memory: 'Memory',
};
const statusLabels: Record<SyncStatus, string> = {
  same: 'in sync',
  different: 'different',
  'missing-remote': 'missing there',
  'missing-local': 'missing here',
};
const actionLabels: Record<string, string> = {
  copy: 'copy',
  review: 'review',
  remap: 'remap paths',
  'set-up-manually': 'set up by hand',
};

function GroupBadges({ section }: { section: SyncSection }): ReactNode {
  const groups = Object.entries(section.groups);
  if (!groups.length) return <p className="machine-muted">{t('Nothing found')}</p>;
  return (
    <div className="machine-badges">
      {groups.map(([group, counts]) => {
        const open = Object.entries(counts).filter(([status, count]) => count && status !== 'same');
        return (
          <Badge key={group} tone={open.length ? 'amber' : 'green'}>
            {t(groupLabels[group] ?? group)}:{' '}
            {open.length
              ? open
                  .map(([status, count]) => `${count} ${t(statusLabels[status as SyncStatus])}`)
                  .join(', ')
              : t('in sync')}
          </Badge>
        );
      })}
    </div>
  );
}

function Differences({ section }: { section: SyncSection }): ReactNode {
  const rows = section.rows.filter((row) => row.status !== 'same');
  if (!rows.length) return null;
  return (
    <details className="machine-details">
      <summary>{t('{{count}} differences', { count: rows.length })}</summary>
      <ul>
        {rows.map((row) => (
          <li key={`${row.status}:${row.key}`}>
            <code>{row.key}</code>
            <span>
              {row.group === 'skill' && `${row.harness} · `}
              {t(statusLabels[row.status])} · {t(actionLabels[row.action] ?? row.action)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function names(projects: ProjectSync[], side: 'local' | 'remote'): string[] {
  return projects.flatMap((project) =>
    project[side] && !project[side === 'local' ? 'remote' : 'local'] ? [project[side]!] : [],
  );
}

function NameLine({ label, values }: { label: string; values: string[] }): ReactNode {
  if (!values.length) return null;
  const more = values.length - LISTED_NAMES;
  return (
    <p className="machine-muted">
      {label} ({values.length}): {values.slice(0, LISTED_NAMES).join(', ')}
      {more > 0 ? ` ${t('and {{count}} more', { count: more })}` : ''}
    </p>
  );
}

export function Machines({ notify }: PageProps): ReactNode {
  const [hosts, setHosts] = useState<string[]>();
  const [alias, setAlias] = useState('');
  const [compared, setCompared] = useState<Compared>();
  const [scope, setScope] = useState({
    localFiles: true,
    memory: true,
    global: true,
    commands: false,
  });
  const [prepared, setPrepared] = useState<Prepared>();
  const [applied, setApplied] = useState<string[]>([]);
  const [busy, setBusy] = useState<'check' | 'sync' | 'apply'>();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void api<{ hosts: string[] }>('machines', 'GET', undefined, abort.signal)
      .then((value) => {
        setHosts(value.hosts);
        setAlias((current) => current || value.hosts[0] || '');
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setHosts([]);
          notify((failure as Error).message, true);
        }
      });
    return () => abort.abort();
  }, [notify]);

  async function run<T>(
    kind: 'check' | 'sync' | 'apply',
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(kind);
    try {
      return await work();
    } catch (failure) {
      notify((failure as Error).message, true);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }
  const check = () =>
    run('check', async () => {
      reset();
      setCompared(await api<Compared>('machines/compare', 'POST', { alias }));
    });
  const prepare = () =>
    run('sync', async () => {
      setApplied([]);
      setPrepared(await api<Prepared>('machines/sync', 'POST', { alias, ...scope }));
    });
  const planIds = prepared
    ? [
        ...prepared.prepared.projects.flatMap((project) => [
          project.planId,
          project.localPlanId,
          project.memoryPlanId,
        ]),
        ...prepared.prepared.global.map((guidance) => guidance.planId),
      ].filter((id): id is string => id !== undefined && !applied.includes(id))
    : undefined;
  const reset = () => {
    setPrepared(undefined);
    setApplied([]);
  };
  const apply = () =>
    run('apply', async () => {
      const { results } = await api<{ results: AppliedPlan[] }>('machines/apply', 'POST', {
        alias,
        planIds,
      });
      setConfirm(false);
      const failed = results.filter((value) => value.error);
      if (failed.length) {
        setApplied((current) => [
          ...current,
          ...results.filter((value) => !value.error).map((value) => value.planId),
        ]);
        notify(
          t('Plans that failed on {{alias}}: {{count}}. {{error}}', {
            count: failed.length,
            alias,
            error: failed[0]!.error ?? '',
          }),
          true,
        );
        return;
      }
      notify(t('Applied on {{alias}}', { alias }));
      setCompared(await api<Compared>('machines/compare', 'POST', { alias }));
      reset();
    });

  const matched =
    compared?.report.projects.filter((project) => project.local && project.remote) ?? [];
  return (
    <>
      <PageHeader
        eyebrow={t('YOUR SERVERS')}
        title={t('Machines')}
        description={t(
          'Compare and sync project kits with a server over your own SSH. Nothing changes there until you apply a reviewed plan.',
        )}
      />
      {hosts === undefined ? (
        <Spinner />
      ) : !hosts.length ? (
        <Empty
          title={t('No SSH hosts found')}
          text={t('Add a Host entry to ~/.ssh/config, then open this page again.')}
        />
      ) : (
        <div className="machine-page">
          <div className="machine-toolbar">
            <Select
              label={t('SSH host')}
              value={alias}
              onValueChange={(value) => {
                setAlias(value);
                setCompared(undefined);
                reset();
              }}
              options={hosts.map((host) => ({ value: host, label: host }))}
            />
            <Button onClick={() => void check()} disabled={!alias || Boolean(busy)}>
              <Server size={14} />
              {busy === 'check' ? t('Checking…') : t('Check')}
            </Button>
          </div>
          {compared && (
            <>
              {!compared.doctor.sameVersion && (
                <Notice tone="warning">
                  {t(
                    'Rigshelf {{here}} here and {{there}} on {{alias}}. Install the same version on both machines.',
                    {
                      here: compared.doctor.here.rigshelf,
                      there: compared.doctor.there.rigshelf,
                      alias,
                    },
                  )}
                </Notice>
              )}
              <p className="machine-muted">
                {t('On {{alias}}: {{platform}} · agents: {{agents}}', {
                  alias,
                  platform: compared.doctor.there.platform,
                  agents:
                    Object.entries(compared.doctor.there.harnesses)
                      .filter(([, installed]) => installed)
                      .map(([harness]) => harness)
                      .join(', ') || t('none'),
                })}
              </p>
              {compared.doctor.issues.length > 0 && (
                <Notice tone="warning">
                  <ul className="machine-issues">
                    {compared.doctor.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <section className="machine-card">
                <h3>{t('Global')}</h3>
                <GroupBadges section={compared.report.global} />
                {compared.report.global.otherAgents && (
                  <p className="machine-muted">
                    {t('Agents not installed on {{alias}} are left out: {{agents}}', {
                      alias,
                      agents: compared.report.global.otherAgents.join(', '),
                    })}
                  </p>
                )}
                <Differences section={compared.report.global} />
              </section>
              {matched.map((project) => (
                <section className="machine-card" key={`${project.repository}:${project.local}`}>
                  <h3>
                    {project.local}
                    <small>
                      {project.matchedBy === 'name'
                        ? t('matched by folder name')
                        : project.repository}
                    </small>
                  </h3>
                  <GroupBadges section={project} />
                  <Differences section={project} />
                </section>
              ))}
              <NameLine
                label={t('Only on this machine')}
                values={names(compared.report.projects, 'local')}
              />
              <NameLine
                label={t('Only on {{alias}}', { alias })}
                values={names(compared.report.projects, 'remote')}
              />
              <fieldset className="machine-scope">
                <legend>{t('Send')}</legend>
                {(
                  [
                    ['localFiles', 'Local agent files that Git does not track'],
                    ['memory', 'Claude memory of each matched project'],
                    ['global', 'Global guidance, Claude settings and Skills'],
                    ['commands', 'Hooks and status line commands (they run on the server)'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="machine-memory" key={key}>
                    <input
                      type="checkbox"
                      checked={scope[key]}
                      onChange={(event) => {
                        reset();
                        setScope((current) => ({ ...current, [key]: event.target.checked }));
                      }}
                    />
                    {t(label)}
                  </label>
                ))}
              </fieldset>
              <p className="machine-muted">
                {t(
                  'Skills go to the agents installed on {{alias}}. Private local settings, account files and credentials stay on this machine.',
                  { alias },
                )}
              </p>
              <div className="button-row">
                <Button onClick={() => void prepare()} disabled={Boolean(busy)}>
                  {busy === 'sync' ? t('Preparing…') : t('Prepare sync')}
                </Button>
              </div>
            </>
          )}
          {prepared && (
            <section className="machine-card">
              <h3>{t('Plans prepared on {{alias}}', { alias })}</h3>
              <ul className="machine-plans">
                {prepared.prepared.projects.map((project) => (
                  <li key={project.repository}>
                    <strong>{project.repository}</strong>
                    <span>
                      {project.planId
                        ? t('{{count}} file changes', { count: project.files ?? 0 })
                        : project.error}
                    </span>
                    {project.localPlanId && (
                      <span>{t('local files: {{count}}', { count: project.localFiles ?? 0 })}</span>
                    )}
                    {project.localError && <span>{project.localError}</span>}
                    {project.memoryPlanId && (
                      <span>
                        {t('memory: {{count}} files', { count: project.memoryFiles ?? 0 })}
                      </span>
                    )}
                    {project.memoryError && <span>{project.memoryError}</span>}
                    {project.skipped?.map((value) => (
                      <span key={value}>{t('skipped {{value}}', { value })}</span>
                    ))}
                  </li>
                ))}
                {prepared.prepared.global.map((guidance) => (
                  <li key={guidance.root}>
                    <strong>~/{guidance.root}</strong>
                    <span>
                      {guidance.planId
                        ? t('{{count}} file changes', { count: guidance.files ?? 0 })
                        : (guidance.error ?? t('in sync'))}
                    </span>
                    {guidance.skipped?.map((value) => (
                      <span key={value}>{t('skipped {{value}}', { value })}</span>
                    ))}
                  </li>
                ))}
              </ul>
              {prepared.prepared.directives.kept.length > 0 && (
                <Notice tone="warning">
                  {t('Directives that differ on {{alias}} were kept: {{names}}', {
                    alias,
                    names: prepared.prepared.directives.kept.join(', '),
                  })}
                </Notice>
              )}
              {[...prepared.withheld, ...prepared.skipped].map((value) => (
                <p className="machine-muted" key={`${value.name}:${value.reason}`}>
                  {value.name}: {value.reason}
                </p>
              ))}
              {planIds?.length ? (
                <div className="button-row">
                  <Button onClick={() => setConfirm(true)} disabled={Boolean(busy)}>
                    {t('Apply on {{alias}}', { alias })}
                  </Button>
                </div>
              ) : (
                <p className="machine-muted">{t('Nothing to apply.')}</p>
              )}
            </section>
          )}
          <p className="machine-muted">
            {t("Open this server's workbench here:")} <code>rigshelf ui {alias}</code>
          </p>
        </div>
      )}
      <ModalPresence>
        {confirm && (
          <Modal
            title={t('Apply {{count}} plans on {{alias}}?', { count: planIds?.length ?? 0, alias })}
            onClose={() => setConfirm(false)}
            closeDisabled={busy === 'apply'}
          >
            <p>
              {t(
                'Each plan checks that files have not changed since it was prepared and can be rolled back on that machine.',
              )}
            </p>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() => setConfirm(false)}
                disabled={busy === 'apply'}
              >
                {t('Cancel')}
              </Button>
              <Button onClick={() => void apply()} disabled={busy === 'apply'}>
                {busy === 'apply' ? t('Applying…') : t('Apply')}
              </Button>
            </div>
          </Modal>
        )}
      </ModalPresence>
    </>
  );
}
