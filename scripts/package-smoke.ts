import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { VERSION } from '../src/version';
import { extractPackage } from './package-extract';

const repository = resolve(import.meta.dir, '..');
const COMMAND_TIMEOUT_MS = 10000;
const READINESS_POLL_MS = 50;
const MAX_ERROR_LENGTH = 500;
await mkdir(join(repository, '.local/tests'), { recursive: true });
const fixture = await mkdtemp(join(repository, '.local/tests/package smoke-'));
const home = join(fixture, 'home');
const cwd = join(fixture, 'unrelated directory');
await mkdir(home);
await mkdir(cwd);
const fixtureConfiguration = join(fixture, 'fixture-bunfig.toml');
await writeFile(fixtureConfiguration, '# Explicit configuration for the dummy upstream.\n');
await writeFile(join(cwd, 'bunfig.toml'), 'preload = ["./ambient-preload.js"]\n');
await writeFile(
  join(cwd, 'ambient-preload.js'),
  'throw new Error("Ambient project configuration was loaded.");\n',
);
const environment = {
  HOME: home,
  TMPDIR: join(fixture, 'tmp'),
  XDG_CACHE_HOME: join(fixture, 'cache'),
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  RIGSHELF_DATA_DIR: join(fixture, 'data'),
};
const StaticAssetSchema = z
  .object({
    path: z.string().startsWith('dist/'),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type StaticAsset = z.infer<typeof StaticAssetSchema>;
await mkdir(environment.TMPDIR);
await mkdir(environment.XDG_CACHE_HOME);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function command(executable: string, args: string[]): Promise<string> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
  try {
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert(code === 0, `Packaged command failed: ${errors.slice(0, MAX_ERROR_LENGTH)}`);
    return output;
  } finally {
    clearTimeout(timer);
  }
}

async function browserServer(executable: string, assets: StaticAsset[]): Promise<void> {
  const reservation = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('fixture'),
  });
  const port = reservation.port;
  await reservation.stop(true);
  const log = join(fixture, `ui-${crypto.randomUUID()}.log`);
  const child = Bun.spawn([executable, 'ui', '--port', String(port)], {
    cwd,
    env: environment,
    stdout: Bun.file(log),
    stderr: Bun.file(`${log}.error`),
  });
  try {
    let access = '';
    for (let attempt = 0; attempt < COMMAND_TIMEOUT_MS / READINESS_POLL_MS; attempt++) {
      const text = await Bun.file(log)
        .text()
        .catch(() => '');
      access = text.match(/http:\/\/rigshelf\.localhost:\d+\/#access=[a-f0-9]{64}/)?.[0] || '';
      if (access) break;
      if (child.exitCode !== null) throw new Error('Packaged UI exited before readiness.');
      await Bun.sleep(READINESS_POLL_MS);
    }
    assert(access, 'Packaged UI did not become ready.');
    const printed = new URL(access);
    const token = new URLSearchParams(printed.hash.slice(1)).get('access')!;
    const url = new URL(`http://127.0.0.1:${printed.port}`);
    const shell = await fetch(url.origin);
    assert(
      shell.status === 200 && (await shell.text()).includes('<div id="root">'),
      'Packaged UI shell missing.',
    );
    assert(
      shell.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
      'UI CSP missing.',
    );
    for (const asset of assets) {
      const response = await fetch(`${url.origin}/${asset.path.replace(/^dist\//, '')}`);
      assert(response.status === 200, `Packaged asset missing: ${asset.path}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(
        bytes.length === asset.bytes &&
          createHash('sha256').update(bytes).digest('hex') === asset.sha256,
        `Packaged asset differs: ${asset.path}`,
      );
    }
    assert(
      (await fetch(`${url.origin}/api/state`)).status === 403,
      'Unauthenticated packaged API was accepted.',
    );
    const state = await fetch(`${url.origin}/api/state`, { headers: { 'x-kitfold-token': token } });
    assert(
      state.status === 200 && Array.isArray((await state.json()).sources),
      'Packaged API/seed failed.',
    );
  } finally {
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
    await child.exited;
    clearTimeout(timeout);
  }
}

async function mcp(executable: string): Promise<void> {
  const client = new Client({ name: 'rigshelf-package-fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: executable,
    args: ['mcp'],
    env: environment,
    cwd,
    stderr: 'pipe',
  });
  const timer = setTimeout(() => {
    void transport.close().catch(() => undefined);
  }, COMMAND_TIMEOUT_MS);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert(
      tools.tools.some((tool) => tool.name.startsWith('rigshelf_')),
      'Packaged MCP tools missing.',
    );
  } finally {
    clearTimeout(timer);
    await client.close();
    await transport.close();
  }
}

async function mcpProxy(executable: string): Promise<void> {
  const upstream = join(fixture, `upstream-${crypto.randomUUID()}.js`);
  await writeFile(
    upstream,
    `
for await (const line of console) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result = {};
  if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'package-fixture', version: '1' } };
  if (message.method === 'tools/list') result = { tools: ['fixture_ping','fixture_hidden'].map(name => ({name, inputSchema:{type:'object'}})) };
  if (message.method === 'tools/call') result = { content: [{type:'text',text:'fixture-pong'}] };
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
}
`,
  );
  const definition = join(fixture, `bridge-${crypto.randomUUID()}.json`);
  await writeFile(
    definition,
    JSON.stringify({
      transport: 'stdio',
      command: process.execPath,
      args: ['--no-env-file', `--config=${fixtureConfiguration}`, upstream],
      allowedTools: ['fixture_ping'],
    }),
  );
  const client = new Client({ name: 'rigshelf-package-bridge-fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: executable,
    args: ['mcp-proxy', '--file', definition],
    env: environment,
    cwd,
    stderr: 'pipe',
  });
  const timer = setTimeout(() => {
    void transport.close().catch(() => undefined);
  }, COMMAND_TIMEOUT_MS);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert(
      tools.tools.length === 1 && tools.tools[0]?.name === 'fixture_ping',
      'Packaged bridge tool filter failed.',
    );
    const result = await client.callTool({ name: 'fixture_ping', arguments: {} });
    assert(JSON.stringify(result).includes('fixture-pong'), 'Packaged bridge forwarding failed.');
  } finally {
    clearTimeout(timer);
    await client.close();
    await transport.close();
  }
}

async function check(archive: string): Promise<void> {
  const destination = join(fixture, `app-${crypto.randomUUID()}`);
  await mkdir(destination);
  const manifest = await extractPackage(archive, destination);
  const portable = manifest.delivery === 'portable';
  assert(
    portable || manifest.delivery === `bun-${process.platform}-${process.arch}`,
    'Run this native smoke on its target operating system and CPU.',
  );
  environment.RIGSHELF_DATA_DIR = join(fixture, `data-${crypto.randomUUID()}`);
  const executable = join(destination, portable ? 'bin/rigshelf' : 'rigshelf');
  const alias = join(destination, portable ? 'bin/kitfold' : 'kitfold');
  const version = (await command(executable, ['--version'])).trim();
  assert(version === `Rigshelf ${VERSION}`, `Package version mismatch: ${version.slice(0, 120)}`);
  assert(
    (await command(alias, ['--version'])).trim() === `Rigshelf ${VERSION}`,
    'Compatibility launcher failed.',
  );
  const links = join(fixture, `linked launchers-${crypto.randomUUID()}`);
  await mkdir(links);
  const linkedExecutable = join(links, 'rigshelf');
  const linkedAlias = join(links, 'kitfold');
  await symlink(relative(links, executable), linkedExecutable);
  await symlink(relative(links, alias), linkedAlias);
  assert(
    (await command(linkedExecutable, ['--version'])).trim() === `Rigshelf ${VERSION}`,
    'Linked primary launcher failed.',
  );
  assert(
    (await command(linkedAlias, ['--version'])).trim() === `Rigshelf ${VERSION}`,
    'Linked compatibility launcher failed.',
  );
  assert(
    (await command(executable, ['--help'])).includes('rigshelf setup'),
    'Packaged help missing.',
  );
  assert(
    !(await Bun.file(join(environment.RIGSHELF_DATA_DIR, 'catalog.sqlite')).exists()),
    'Version/help created catalog state.',
  );
  const doctor = JSON.parse(await command(executable, ['doctor']));
  assert(doctor.runtime, 'Packaged doctor failed.');
  const assets = portable
    ? manifest.files
        .filter((file) => file.path.startsWith('dist/'))
        .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    : z
        .array(StaticAssetSchema)
        .max(500)
        .parse(JSON.parse(await readFile(join(destination, 'web-assets.json'), 'utf8')));
  assert(
    assets.some((asset) => asset.path === 'dist/index.html'),
    'UI asset inventory missing.',
  );
  await browserServer(executable, assets);
  await mcp(executable);
  await mcpProxy(linkedAlias);
  process.stdout.write(
    `PASS ${manifest.delivery}: inventory, checksums, unrelated cwd, CLI, alias, UI assets, API, stdio MCP and filtered bridge\n`,
  );
}

try {
  const archives = process.argv.slice(2);
  if (!archives.length) {
    archives.push(join(repository, `.local/releases/rigshelf-${VERSION}-portable.tar.gz`));
    const native = join(
      repository,
      `.local/releases/rigshelf-${VERSION}-bun-${process.platform}-${process.arch}.tar.gz`,
    );
    if (await Bun.file(native).exists()) archives.push(native);
  }
  for (const archive of archives) await check(resolve(archive));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
