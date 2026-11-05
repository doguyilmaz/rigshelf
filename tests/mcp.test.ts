import { afterEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bridgeReason, resolveDefinition } from '../src/core/mcp-compat';
import type { Entry, Mcp } from '../src/core/model';
import { createPlan } from '../src/core/planner';
import { route } from '../src/core/service';
import { fixture } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

test('stdio bridge preserves tool restrictions and forwards only declared dummy secrets', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const definition: Mcp = {
    transport: 'stdio',
    command: process.execPath,
    args: [resolve('tests/fixtures/mcp-server.ts')],
    env: { TOKEN: '${KITFOLD_TEST_TOKEN}' },
    headers: {},
    allowedTools: ['echo'],
    deniedTools: ['admin'],
  };
  await Bun.write(join(data.project, '.kitfold/mcp/test.json'), JSON.stringify(definition));
  const client = new Client({ name: 'kitfold-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/cli.ts'), 'mcp-proxy', '--file', '.kitfold/mcp/test.json'],
    cwd: data.project,
    env: { KITFOLD_TEST_TOKEN: 'dummy-token-value', KITFOLD_UNDECLARED_SECRET: 'must-not-forward' },
    stderr: 'pipe',
  });
  cleanup.unshift(async () => {
    await client.close();
  });
  await client.connect(transport);
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toEqual(['echo']);
  const response = await client.callTool({ name: 'echo', arguments: { message: 'hello' } });
  expect(response.content).toEqual([
    {
      type: 'text',
      text: JSON.stringify({ message: 'hello', token: 'dummy-token-value', ambient: '' }),
    },
  ]);
  await expect(client.callTool({ name: 'admin', arguments: {} })).rejects.toThrow('allowed set');
});

test('missing runtime variables fail with a name-only error and are never replaced with empty credentials', () => {
  const definition: Mcp = {
    transport: 'http',
    url: 'https://example.com/mcp',
    args: [],
    env: {},
    headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
  };
  expect(() => resolveDefinition(definition, {})).toThrow(
    'Required environment variable is missing: MISSING_TOKEN',
  );
  expect(resolveDefinition(definition, { MISSING_TOKEN: 'dummy-only' }).headers.Authorization).toBe(
    'Bearer dummy-only',
  );
});

test('empty local bridge definitions block ancestor execution while absent files retain parent discovery', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const nested = join(data.project, 'packages/nested');
  const relative = '.kitfold/mcp/test.json';
  const marker = join(data.root, 'parent-started');
  await mkdir(nested, { recursive: true });
  await Bun.write(
    join(data.project, relative),
    JSON.stringify({
      transport: 'stdio',
      command: process.execPath,
      args: [resolve('tests/fixtures/mcp-server.ts')],
      env: { KITFOLD_TEST_START_MARKER: marker },
    }),
  );
  await Bun.write(join(nested, relative), '');
  const connect = async () => {
    const client = new Client({ name: 'bridge-selection-test', version: '1.0.0' });
    cleanup.unshift(async () => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('src/cli.ts'), 'mcp-proxy', '--file', relative],
        cwd: nested,
        stderr: 'pipe',
      }),
    );
    return client;
  };
  await expect(connect()).rejects.toThrow();
  expect(await Bun.file(marker).exists()).toBe(false);
  await rm(join(nested, relative));
  const client = await connect();
  expect((await client.listTools()).tools.some((tool) => tool.name === 'echo')).toBe(true);
  expect(await Bun.file(marker).text()).toBe('started');
});

test('setup plans use documented native formats and add a canonical bridge only when required', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const entry = (await route(data.store, 'POST', 'mcp', {
    name: 'filtered-server',
    mcp: {
      transport: 'stdio',
      command: 'example-server',
      args: [],
      env: {},
      headers: {},
      allowedTools: ['read'],
    },
  })) as Entry;
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['claude', 'codex'],
    entryIds: [entry.id],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  expect(plan.changes.some((change) => change.path === '.kitfold/mcp/filtered-server.json')).toBe(
    true,
  );
  const claude = JSON.parse(
    Buffer.from(
      plan.changes.find((change) => change.path === '.mcp.json')!.after!,
      'base64',
    ).toString(),
  );
  expect(claude.mcpServers['filtered-server'].command).toBe('kitfold');
  const codex = Buffer.from(
    plan.changes.find((change) => change.path === '.codex/config.toml')!.after!,
    'base64',
  ).toString();
  expect(codex).toContain('enabled_tools');
  expect(codex).not.toContain('mcp-proxy');
  expect(bridgeReason(entry.mcp!, 'codex')).toBeUndefined();
});

test('catalog MCP exposes read/plan tools by default and no hidden write tools', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const client = new Client({ name: 'kitfold-test', version: '1.0.0' });
  cleanup.unshift(async () => {
    await client.close();
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/cli.ts'), 'mcp'],
      env: { KITFOLD_DATA_DIR: data.store.directory },
      stderr: 'pipe',
    }),
  );
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  expect(names).toContain('kitfold_recommend');
  expect(names).toContain('kitfold_plan');
  expect(names).not.toContain('kitfold_apply');
});
