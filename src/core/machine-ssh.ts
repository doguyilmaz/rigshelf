import { z } from 'zod';
import { type MachineDoctor, parseMachineDoctor } from './machine-doctor';
import { type MachineInventory, parseMachineInventory } from './machine-inventory';

export const HOST_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const REMOTE_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const INSTALL_HINT = 'brew install doguyilmaz/tap/rigshelf, or bunx @doguyilmaz/rigshelf';

export interface RemoteResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type RemoteRunner = (args: string[], input?: string) => Promise<RemoteResult>;

const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAN_COMMAND =
  /^rigshelf apply [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

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
    !PLAN_COMMAND.test(command) &&
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

async function spawnRemote(args: string[], input?: string): Promise<RemoteResult> {
  const child = Bun.spawn(args, {
    stdin: input === undefined ? 'ignore' : Buffer.from(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
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

async function runRigshelf(
  alias: string,
  command: string,
  run: RemoteRunner,
  input?: string,
): Promise<string> {
  const result = await run(sshArguments(alias, command), input);
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
  const roots = checkedRoots(options.roots);
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

const PreparedSchema = z.object({
  library: z.object({ entries: z.number().int().min(0) }),
  directives: z.object({
    added: z.array(z.string().max(100)),
    replaced: z.array(z.string().max(100)),
    kept: z.array(z.string().max(100)),
  }),
  projects: z
    .array(
      z.object({
        repository: z.string().max(300),
        path: z.string().max(4096).optional(),
        planId: z.string().regex(PLAN_ID).optional(),
        files: z.number().int().min(0).optional(),
        warnings: z.array(z.string().max(2000)).max(200).optional(),
        error: z.string().max(2000).optional(),
        memoryPlanId: z.string().regex(PLAN_ID).optional(),
        memoryFiles: z.number().int().min(0).optional(),
        memoryError: z.string().max(2000).optional(),
        localPlanId: z.string().regex(PLAN_ID).optional(),
        localFiles: z.number().int().min(0).optional(),
        localError: z.string().max(2000).optional(),
      }),
    )
    .max(300),
  global: z
    .array(
      z.object({
        root: z.string().max(20),
        planId: z.string().regex(PLAN_ID).optional(),
        files: z.number().int().min(0).optional(),
        error: z.string().max(2000).optional(),
      }),
    )
    .max(10),
});
export type PreparedSync = z.infer<typeof PreparedSchema>;

function checkedRoots(roots: string[] = []): string[] {
  for (const root of roots)
    if (!REMOTE_ROOT.test(root) || root.split('/').includes('..'))
      throw new Error(
        `Remote roots must be absolute paths of letters, digits, ., _, - and /: ${root.slice(0, 80)}`,
      );
  return roots;
}

export async function remotePrepare(
  alias: string,
  request: unknown,
  options: { roots?: string[]; replaceDirectives?: boolean; run?: RemoteRunner } = {},
): Promise<PreparedSync> {
  const input = JSON.stringify(request);
  if (input.length > MAX_BUNDLE_BYTES) throw new Error('The sync bundle exceeds 256 MiB.');
  const command = [
    'rigshelf machine prepare --json',
    ...(options.replaceDirectives ? ['--replace-directives'] : []),
    ...checkedRoots(options.roots).map((root) => `--root ${root}`),
  ].join(' ');
  const output = await runRigshelf(alias, command, options.run || spawnRemote, input);
  try {
    return PreparedSchema.parse(JSON.parse(output));
  } catch {
    throw new Error(
      `${alias} returned a sync review this version cannot read. Install the same Rigshelf version on both machines.`,
    );
  }
}

export async function remoteApply(
  alias: string,
  planId: string,
  options: { run?: RemoteRunner } = {},
): Promise<{ status: string; fileCount?: number }> {
  if (!PLAN_ID.test(planId)) throw new Error('Expected a plan ID from machine sync.');
  const output = await runRigshelf(alias, `rigshelf apply ${planId}`, options.run || spawnRemote);
  return z
    .object({ status: z.string().max(40), fileCount: z.number().int().optional() })
    .passthrough()
    .parse(JSON.parse(output));
}
