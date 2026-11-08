import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { readLocalBytes } from './core/local-files';
import { compareInventories, type SyncReport, type SyncSection } from './core/machine-compare';
import { machineDoctor } from './core/machine-doctor';
import { buildMachineInventory, parseMachineInventory } from './core/machine-inventory';
import { remoteDoctor, remoteInventory, remoteReadyUrl, tunnelArguments } from './core/machine-ssh';
import type { Store } from './core/store';

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

export const machineHelp = `
Machines (read-only; uses your ~/.ssh/config and ssh-agent, stores no keys):
  rigshelf machine inventory [--root /dir]      This machine's agent setup as JSON, without file contents
  rigshelf machine compare <ssh-alias> [--root /dir] [--remote-root /dir] [--json]
  rigshelf machine compare --manifest inventory.json   Compare with a saved inventory
  rigshelf machine doctor [ssh-alias]           Rigshelf version and harness CLIs on each machine
  rigshelf ui --on <ssh-alias> [--port 47471] [--remote-port 47471]
                                                Open that machine's workbench here through an SSH tunnel
`;

interface MachineOptions {
  root?: string[];
  'remote-root'?: string[];
  manifest?: string;
  json?: boolean;
}

async function localRoots(store: Store, roots?: string[]): Promise<string[]> {
  const candidates = roots?.length ? roots : store.settings().roots;
  const existing = [];
  for (const root of candidates)
    if ((await lstat(root).catch(() => undefined))?.isDirectory()) existing.push(root);
  return existing.length ? existing : [homedir()];
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

export function formatSyncReport(report: SyncReport, here: string, there: string): string {
  const lines = [
    `${here} → ${there}`,
    `Global  ${groupLine(report.global) || 'nothing found'}`,
    ...manual(report.global),
  ];
  for (const project of report.projects) {
    const name = project.local ?? project.remote;
    const where = !project.remote
      ? `only on ${here}`
      : !project.local
        ? `only on ${there}`
        : project.matchedBy === 'name'
          ? 'matched by folder name'
          : project.repository;
    lines.push('', `${name}  (${where})`);
    if (project.local && project.remote)
      lines.push(`  ${groupLine(project) || 'nothing found'}`, ...manual(project));
  }
  lines.push('', 'Details for every item: add --json.');
  return `${lines.join('\n')}\n`;
}

export async function runMachineCommand(
  store: Store,
  action: string | undefined,
  alias: string | undefined,
  values: MachineOptions,
): Promise<{ text?: string; result?: unknown }> {
  if (action === 'inventory')
    return {
      result: await buildMachineInventory({
        home: homedir(),
        roots: await localRoots(store, values.root),
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
      buildMachineInventory({ home: homedir(), roots: await localRoots(store, values.root) }),
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
  throw new Error('Use machine inventory, compare or doctor. Run rigshelf --help.');
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
