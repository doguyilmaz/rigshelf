import { type MachineDoctor, parseMachineDoctor } from './machine-doctor';
import { type MachineInventory, parseMachineInventory } from './machine-inventory';

const HOST_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const REMOTE_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const INSTALL_HINT = 'brew install doguyilmaz/tap/rigshelf, or bunx @doguyilmaz/rigshelf';

export interface RemoteResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type RemoteRunner = (args: string[]) => Promise<RemoteResult>;

const baseOptions = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ForwardAgent=no',
];

function checkedAlias(alias: string): string {
  if (!HOST_ALIAS.test(alias))
    throw new Error(
      'Choose an SSH host alias from ~/.ssh/config (letters, digits, dot, dash or underscore).',
    );
  return alias;
}

/** Runs a fixed Rigshelf command through the remote login shell so Homebrew and Bun installs are on PATH. */
function remoteCommand(command: string): string {
  if (
    !/^rigshelf [a-z -]+(?: --root \/[A-Za-z0-9._/-]{1,255})*$/.test(command) &&
    !/^rigshelf ui --port \d{4,5} --attached --public-port \d{4,5}$/.test(command)
  )
    throw new Error('Unsupported remote command.');
  return `exec "$SHELL" -lc '${command}'`;
}

export function sshArguments(alias: string, command: string): string[] {
  return [
    'ssh',
    ...baseOptions,
    '-o',
    'ClearAllForwardings=yes',
    '--',
    checkedAlias(alias),
    remoteCommand(command),
  ];
}

const MIN_TUNNEL_PORT = 1024;
const MAX_TUNNEL_PORT = 65535;

export function tunnelArguments(
  alias: string,
  localPort: number,
  remotePort = localPort,
): string[] {
  for (const port of [localPort, remotePort])
    if (!Number.isInteger(port) || port < MIN_TUNNEL_PORT || port > MAX_TUNNEL_PORT)
      throw new Error(`Choose a port between ${MIN_TUNNEL_PORT} and ${MAX_TUNNEL_PORT}.`);
  return [
    'ssh',
    ...baseOptions,
    '-o',
    'ExitOnForwardFailure=yes',
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    '--',
    checkedAlias(alias),
    remoteCommand(`rigshelf ui --port ${remotePort} --attached --public-port ${localPort}`),
  ];
}

export function remoteReadyUrl(output: string, port: number): string | undefined {
  const url = output.match(
    /Rigshelf is ready at (http:\/\/rigshelf\.localhost:(\d+)\/#access=[a-f0-9]{64})/,
  );
  return url && Number(url[2]) === port ? url[1] : undefined;
}

async function spawnRemote(args: string[]): Promise<RemoteResult> {
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), REMOTE_TIMEOUT_MS);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (stdout.length > MAX_OUTPUT_BYTES) throw new Error('The remote response is too large.');
    return { code: await child.exited, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function runRigshelf(alias: string, command: string, run: RemoteRunner): Promise<string> {
  const result = await run(sshArguments(alias, command));
  const detail = result.stderr.trim().split('\n').at(-1)?.slice(0, 300) || `exit ${result.code}`;
  if (result.code === 0) return result.stdout;
  if (result.code === 255) throw new Error(`Could not connect to ${alias}: ${detail}`);
  if (result.code === 127 || /command not found|not found: rigshelf/.test(result.stderr))
    throw new Error(`Rigshelf is not installed on ${alias}. Install it there: ${INSTALL_HINT}.`);
  throw new Error(`Rigshelf on ${alias} failed: ${detail}`);
}

const REMOTE_ROOT = /^\/[A-Za-z0-9._/-]{1,255}$/;

export async function remoteInventory(
  alias: string,
  options: { run?: RemoteRunner; roots?: string[] } = {},
): Promise<MachineInventory> {
  const roots = options.roots || [];
  for (const root of roots)
    if (!REMOTE_ROOT.test(root) || root.split('/').includes('..'))
      throw new Error(
        `Remote roots must be absolute paths of letters, digits, ., _, - and /: ${root.slice(0, 80)}`,
      );
  const output = await runRigshelf(
    alias,
    ['rigshelf machine inventory --json', ...roots.map((root) => `--root ${root}`)].join(' '),
    options.run || spawnRemote,
  );
  try {
    return parseMachineInventory(output);
  } catch (error) {
    throw new Error(
      `${alias} returned an inventory this version cannot read. Install the same Rigshelf version on both machines. ${error instanceof Error ? error.message.slice(0, 200) : ''}`,
    );
  }
}

export async function remoteDoctor(
  alias: string,
  options: { run?: RemoteRunner } = {},
): Promise<MachineDoctor> {
  const output = await runRigshelf(
    alias,
    'rigshelf machine doctor --json',
    options.run || spawnRemote,
  );
  try {
    return parseMachineDoctor(output);
  } catch {
    throw new Error(
      `${alias} returned a doctor report this version cannot read. Install the same Rigshelf version on both machines.`,
    );
  }
}
