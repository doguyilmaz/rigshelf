import { homedir } from 'node:os';
import { readLocalBytes } from './core/local-files';
import { compareInventories, type SyncReport, type SyncSection } from './core/machine-compare';
import { machineDoctor } from './core/machine-doctor';
import {
  buildMachineInventory,
  inventoryRoots,
  parseMachineInventory,
} from './core/machine-inventory';
import {
  type PreparedSync,
  remoteApply,
  remoteDoctor,
  remoteInventory,
  remotePrepare,
  remoteReadyUrl,
  tunnelArguments,
} from './core/machine-ssh';
import { buildSyncRequest, prepareSync } from './core/machine-sync';
import type { Store } from './core/store';

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_SYNC_INPUT_BYTES = 256 * 1024 * 1024;

export const machineHelp = `
Machines (read-only; uses your ~/.ssh/config and ssh-agent, stores no keys):
  rigshelf machine inventory [--root /dir]      This machine's agent setup as JSON, without file contents
  rigshelf machine compare <ssh-alias> [--root /dir] [--remote-root /dir] [--json]
  rigshelf machine compare --manifest inventory.json   Compare with a saved inventory
  rigshelf machine doctor [ssh-alias]           Rigshelf version and harness CLIs on each machine
  rigshelf machine sync <ssh-alias> [--root /dir] [--remote-root /dir] [--replace-directives]
                        [--memory project,project] [--skip-local-files] [--apply]
                        [--skip-global-guidance] [--global-settings] [--global-skills]
                                                Prepare plans on the server for each applied project kit
  rigshelf machine apply <ssh-alias> <plan-id>...  Apply reviewed plans that machine sync prepared
  rigshelf ui --on <ssh-alias> [--port 47471] [--remote-port 47471]
                                                Open that machine's workbench here through an SSH tunnel
`;

interface MachineOptions {
  root?: string[];
  'remote-root'?: string[];
  manifest?: string;
  json?: boolean;
  apply?: boolean;
  'replace-directives'?: boolean;
  memory?: string;
  'skip-local-files'?: boolean;
  'skip-global-guidance'?: boolean;
  'global-settings'?: boolean;
  'global-skills'?: boolean;
}

const label: Record<string, string> = {
  same: 'same',
  different: 'different',
  'missing-remote': 'missing there',
  'missing-local': 'missing here',
};

function groupLine(section: SyncSection): string {
  return Object.entries(section.groups)
    .map(([group, counts]) => {
      const parts = Object.entries(counts)
        .filter(([status, count]) => count && status !== 'same')
        .map(([status, count]) => `${count} ${label[status]}`);
      return `${group}: ${parts.length ? parts.join(', ') : 'in sync'}`;
    })
    .join(' · ');
}

function manual(section: SyncSection): string[] {
  return section.rows
    .filter((row) => row.action === 'set-up-manually' || row.action === 'remap')
    .slice(0, 5)
    .map((row) => `    ${row.action === 'remap' ? 'remap paths' : 'set up by hand'}: ${row.key}`);
}

const LISTED_NAMES = 8;

function namesLine(label: string, names: string[]): string[] {
  if (!names.length) return [];
  const shown = names.slice(0, LISTED_NAMES).join(', ');
  const more = names.length > LISTED_NAMES ? ` and ${names.length - LISTED_NAMES} more` : '';
  return ['', `${label} (${names.length}): ${shown}${more}`];
}

export function formatSyncReport(report: SyncReport, here: string, there: string): string {
  const lines = [
    `${here} → ${there}`,
    `Global  ${groupLine(report.global) || 'nothing found'}`,
    ...manual(report.global),
  ];
  for (const project of report.projects.filter((value) => value.local && value.remote)) {
    const where = project.matchedBy === 'name' ? 'matched by folder name' : project.repository;
    lines.push(
      '',
      `${project.local}  (${where})`,
      `  ${groupLine(project) || 'nothing found'}`,
      ...manual(project),
    );
  }
  lines.push(
    ...namesLine(
      `Only on ${here}`,
      report.projects.flatMap((value) => (value.local && !value.remote ? [value.local] : [])),
    ),
    ...namesLine(
      `Only on ${there}`,
      report.projects.flatMap((value) => (value.remote && !value.local ? [value.remote] : [])),
    ),
    '',
    'Details for every item: add --json.',
  );
  return `${lines.join('\n')}\n`;
}

function formatSync(
  alias: string,
  sync: Awaited<ReturnType<typeof buildSyncRequest>>,
  prepared: PreparedSync,
): string {
  const lines = [`this machine → ${alias}`, `Library  ${prepared.library.entries} entries sent`];
  for (const value of sync.withheld) lines.push(`  withheld ${value.name}: ${value.reason}`);
  const { added, replaced, kept } = prepared.directives;
  lines.push(`Directives  ${added.length} added, ${replaced.length} replaced, ${kept.length} kept`);
  if (kept.length)
    lines.push(
      `  ${kept.join(', ')} differ on ${alias}; --replace-directives uses this machine's version`,
    );
  for (const project of prepared.projects) {
    lines.push(
      project.planId
        ? `${project.repository} → ${project.path}: ${project.files} file changes, plan ${project.planId}`
        : `${project.repository}: ${project.error}`,
    );
    if (project.localPlanId)
      lines.push(`  local files: ${project.localFiles} files, plan ${project.localPlanId}`);
    else if (project.localError) lines.push(`  local files: ${project.localError}`);
    if (project.memoryPlanId)
      lines.push(`  memory: ${project.memoryFiles} files, plan ${project.memoryPlanId}`);
    else if (project.memoryError) lines.push(`  memory: ${project.memoryError}`);
    else if (project.memoryFiles === 0) lines.push('  memory: already in sync');
  }
  for (const guidance of prepared.global)
    lines.push(
      guidance.planId
        ? `Global ~/${guidance.root}: ${guidance.files} files, plan ${guidance.planId}`
        : `Global ~/${guidance.root}: ${guidance.error ?? 'already in sync'}`,
    );
  for (const value of sync.skipped) lines.push(`Skipped ${value.name}: ${value.reason}`);
  const ids = planIdsOf(prepared);
  if (ids.length)
    lines.push('', `Apply on ${alias}: rigshelf machine apply ${alias} ${ids.join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function planIdsOf(prepared: PreparedSync): string[] {
  return [
    ...prepared.projects.flatMap((project) => [
      project.planId,
      project.localPlanId,
      project.memoryPlanId,
    ]),
    ...prepared.global.map((guidance) => guidance.planId),
  ].filter((id): id is string => Boolean(id));
}

async function applyPlans(alias: string, ids: string[]): Promise<string> {
  const lines = [];
  for (const id of ids) {
    const applied = await remoteApply(alias, id);
    lines.push(
      `${id}: ${applied.status}${applied.fileCount === undefined ? '' : `, ${applied.fileCount} files`}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function runMachineCommand(
  store: Store,
  action: string | undefined,
  alias: string | undefined,
  values: MachineOptions,
  planIds: string[] = [],
): Promise<{ text?: string; result?: unknown }> {
  if (action === 'prepare') {
    const input = await Bun.stdin.text();
    if (input.length > MAX_SYNC_INPUT_BYTES) throw new Error('The sync bundle exceeds 256 MiB.');
    return {
      result: await prepareSync(
        store,
        JSON.parse(input),
        await inventoryRoots(store, values.root),
        {
          replaceDirectives: values['replace-directives'],
        },
      ),
    };
  }
  if (action === 'sync') {
    if (!alias) throw new Error('machine sync needs an SSH host alias.');
    const sync = await buildSyncRequest(store, await inventoryRoots(store, values.root), {
      memory: values.memory
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      localFiles: !values['skip-local-files'],
      globalGuidance: !values['skip-global-guidance'],
      globalSettings: values['global-settings'],
      globalSkills: values['global-skills'],
    });
    if (!sync.request.projects.length)
      return { text: `No project here has an applied Rigshelf kit with a Git origin.\n` };
    const prepared = await remotePrepare(alias, sync.request, {
      roots: values['remote-root'],
      replaceDirectives: values['replace-directives'],
    });
    const text = formatSync(alias, sync, prepared);
    const ids = planIdsOf(prepared);
    if (values.json)
      return { result: { ...prepared, skipped: sync.skipped, withheld: sync.withheld } };
    return { text: values.apply && ids.length ? text + (await applyPlans(alias, ids)) : text };
  }
  if (action === 'apply') {
    if (!alias || !planIds.length)
      throw new Error('machine apply needs an SSH host alias and plan IDs.');
    return { text: await applyPlans(alias, planIds) };
  }
  if (action === 'inventory')
    return {
      result: await buildMachineInventory({
        home: homedir(),
        roots: await inventoryRoots(store, values.root),
      }),
    };
  if (action === 'doctor') {
    const here = machineDoctor();
    if (!alias) return { result: { here } };
    const there = await remoteDoctor(alias);
    return { result: { here, there, sameVersion: here.rigshelf === there.rigshelf } };
  }
  if (action === 'compare') {
    if (!alias && !values.manifest)
      throw new Error('machine compare needs an SSH host alias or --manifest.');
    const [local, remote] = await Promise.all([
      buildMachineInventory({ home: homedir(), roots: await inventoryRoots(store, values.root) }),
      values.manifest
        ? readLocalBytes(values.manifest, MAX_MANIFEST_BYTES).then((bytes) =>
            parseMachineInventory(bytes.toString('utf8')),
          )
        : remoteInventory(alias!, { roots: values['remote-root'] }),
    ]);
    const report = compareInventories(local, remote);
    return values.json
      ? { result: report }
      : { text: formatSyncReport(report, 'this machine', alias || values.manifest!) };
  }
  throw new Error('Use machine inventory, compare, doctor, sync or apply. Run rigshelf --help.');
}

const DEFAULT_PORT = 47471;
const PORT_ATTEMPTS = 8;
const OUTPUT_TAIL = 4096;

function localPortFree(port: number): boolean {
  try {
    Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Opens the remote workbench through `ssh -L`; nothing listens beyond loopback on either machine. */
export async function openRemoteWorkbench(
  alias: string,
  requested?: number,
  remotePort?: number,
): Promise<number> {
  const port =
    requested ??
    Array.from({ length: PORT_ATTEMPTS }, (_, index) => DEFAULT_PORT + index).find(localPortFree);
  if (!port) throw new Error('No free local port near 47471. Choose one with --port.');
  const child = Bun.spawn(tunnelArguments(alias, port, remotePort ?? port), {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const stderr = new Response(child.stderr).text();
  const decoder = new TextDecoder();
  let output = '';
  let ready = false;
  const reader = child.stdout.getReader();
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    output = (output + decoder.decode(part.value, { stream: true })).slice(-OUTPUT_TAIL);
    const url = !ready && remoteReadyUrl(output, port);
    if (url) {
      ready = true;
      process.stdout.write(
        `Rigshelf on ${alias} is ready at ${url}\nCtrl-C closes the tunnel and stops the remote workbench.\n`,
      );
    }
  }
  const code = await child.exited;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  if (!ready) {
    const detail = `${output}\n${await stderr}`.trim().split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(`Could not open Rigshelf on ${alias}: ${detail || `ssh exited with ${code}`}`);
  }
  return code;
}
