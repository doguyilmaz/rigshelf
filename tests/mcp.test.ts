import { afterEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { aiDraft, startAiDraft } from '../src/core/ai-assistance';
import { bridgeReason, resolveDefinition } from '../src/core/mcp-compat';
import type { Entry, Mcp, Plan, Preset, Rule } from '../src/core/model';
import { createPlan, executePlan } from '../src/core/planner';
import { hash } from '../src/core/safety';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import { fixture, sampleSkill } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

test('MCP item reads never expose parsed legacy credential metadata', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const safe = (await route(data.store, 'POST', 'mcp', {
    name: 'legacy-credential-fixture',
    mcp: { transport: 'stdio', command: 'fixture-server', env: { API_KEY: '${TOKEN}' } },
  })) as Entry;
  const mcp = {
    ...safe.mcp!,
    command: 'server --token "private-fixture-command"',
    args: ['--token', 'private-fixture-argument'],
    url: 'https://example.test/mcp?password=private-fixture-query&mode=public',
    env: { API_KEY: 'private-fixture-${OTHER}' },
  };
  const body = JSON.stringify(mcp, null, 2);
  const legacy: Entry = {
    ...safe,
    id: 'legacy-mcp-reader',
    body,
    mcp,
    digest: hash(body),
    custom: false,
  };
  data.store.saveEntry(legacy);
  const client = new Client({ name: 'legacy-reader-fixture', version: '1.0.0' });
  cleanup.unshift(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/cli.ts'), 'mcp'],
      env: { KITFOLD_DATA_DIR: data.store.directory },
      stderr: 'pipe',
    }),
  );
  const result = await client.callTool({ name: 'kitfold_item', arguments: { id: legacy.id } });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-fixture');
  const parsed = JSON.parse((result.content as { text: string }[])[0]!.text) as { entry: Entry };
  expect(parsed.entry.mcp).toBeUndefined();
  expect(parsed.entry.body).toContain('${API_KEY}');
  expect(data.store.entry(legacy.id)!.body).toBe(body);
});

test('read-only MCP can restore private returning choices without applying again or granting permission', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  await Bun.write(join(data.project, 'package.json'), '{}');
  const skill = sampleSkill(data.store, 'returning-mcp-guide');
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex', 'opencode'],
    entryIds: [skill.id],
    requirements: 'Preserve this privately reviewed brief.',
    presetId: 'cli',
  });
  await executePlan(data.store, plan.id, 'apply');
  const before = await Bun.file(join(data.project, '.kitfold/kit.json')).text();
  const client = new Client({ name: 'returning-reader-fixture', version: '1.0.0' });
  cleanup.unshift(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/cli.ts'), 'mcp'],
      env: { KITFOLD_DATA_DIR: data.store.directory },
      stderr: 'pipe',
    }),
  );
  const result = await client.callTool({
    name: 'kitfold_recommend',
    arguments: { projectPath: data.project, restorePrevious: true },
  });
  expect(result.isError).not.toBe(true);
  const inspected = JSON.parse((result.content as { type: string; text: string }[])[0]!.text) as {
    project: { requirements: string };
    presetId: string;
    previousSetup: { providers: string[]; entryIds: string[]; manifestMatches: boolean };
  };
  expect(inspected.project.requirements).toBe('Preserve this privately reviewed brief.');
  expect(inspected.presetId).toBe('cli');
  expect(inspected.previousSetup.providers).toEqual(['codex', 'opencode']);
  expect(inspected.previousSetup.entryIds).toEqual([skill.id]);
  expect(inspected.previousSetup.manifestMatches).toBe(true);
  expect(data.store.planSummaries()).toHaveLength(1);
  expect(data.store.list('approval')).toEqual([]);
  expect(data.store.list('trust')).toEqual([]);
  expect(await Bun.file(join(data.project, '.kitfold/kit.json')).text()).toBe(before);
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
  await Bun.write(join(data.project, 'package.json'), '{}');
  await Bun.write(
    join(data.project, 'MEMORY.md'),
    'A unique fixture memory body, not catalog metadata.',
  );
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const project = data.store.projects()[0]!;
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
  expect(client.getServerVersion()?.name).toBe('rigshelf');
  expect(names).toContain('kitfold_recommend');
  expect(names).toContain('kitfold_plan');
  expect(names).toContain('kitfold_backup_review');
  expect(names).not.toContain('kitfold_backup_apply');
  const backups = await client.callTool({
    name: 'kitfold_backup_review',
    arguments: { action: 'destinations' },
  });
  expect(backups.isError).not.toBe(true);
  expect(JSON.stringify(backups.content)).toContain('[]');
  expect(names).not.toContain('kitfold_apply');
  expect(names).not.toContain('kitfold_save_preset');
  expect(names).not.toContain('kitfold_save_rule');
  expect(names).toContain('kitfold_pending_drafts');
  expect(names).toContain('kitfold_propose_draft');
  const draft = startAiDraft(data.store, {
    task: 'text',
    intent: 'format',
    text: 'Format this fixture note.',
    runner: 'session',
  });
  const offered = await client.callTool({
    name: 'kitfold_draft_request',
    arguments: { id: draft.id },
  });
  expect(JSON.stringify(offered)).toContain('Format this fixture note.');
  const proposed = await client.callTool({
    name: 'kitfold_propose_draft',
    arguments: {
      id: draft.id,
      proposal: {
        summary: 'A formatted fixture.',
        questions: [],
        draft: { kind: 'text', text: 'Formatted fixture note.' },
      },
    },
  });
  expect(proposed.isError).not.toBe(true);
  expect(aiDraft(data.store, draft.id).state).toBe('ready');
  expect(names).toContain('kitfold_project_files');
  const listing = await client.callTool({
    name: 'kitfold_project_files',
    arguments: { projectId: project.id, limit: 1 },
  });
  expect(JSON.stringify(listing)).not.toContain('unique fixture memory body');
  const text = (listing.content as { type: string; text: string }[])[0]!.text;
  const files = JSON.parse(text) as {
    total: number;
    files: { documentId: string; path: string }[];
  };
  expect(files.total).toBe(1);
  expect(files.files[0]!.path).toBe('MEMORY.md');
  const document = await client.callTool({
    name: 'kitfold_project_document',
    arguments: { projectId: project.id, documentId: files.files[0]!.documentId },
  });
  expect(JSON.stringify(document)).toContain('unique fixture memory body');
});

test('writable MCP supports create-only definitions and checked edits without granting project permission', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  const client = new Client({ name: 'definition-writer-fixture', version: '1.0.0' });
  cleanup.unshift(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/cli.ts'), 'mcp', '--write', '--root', data.project],
      env: { KITFOLD_DATA_DIR: data.store.directory },
      stderr: 'pipe',
    }),
  );
  const documented = new Set(
    (await Bun.file(new URL('../docs/MCP.md', import.meta.url)).text()).match(/kitfold_[a-z_]+/g),
  );
  const exposed = new Set((await client.listTools()).tools.map((tool) => tool.name));
  expect([...documented].sort()).toEqual([...exposed].sort());
  const preset: Preset = {
    id: 'mcp-preset',
    name: 'MCP fixture',
    description: 'Original definition.',
    parentId: 'base',
    stacks: [],
    selectors: [],
    entryIds: [],
    excludedIds: [],
    providers: ['codex'],
  };
  const rule: Rule = {
    id: 'mcp-rule',
    name: 'MCP fixture',
    scope: 'global',
    content: 'Original authored instruction.',
    enabled: true,
    priority: 50,
    provenance: 'Fixture',
  };
  for (const [name, kind, value, revised] of [
    ['kitfold_save_preset', 'preset', preset, { ...preset, description: 'Explicit checked edit.' }],
    ['kitfold_save_rule', 'rule', rule, { ...rule, content: 'Explicit checked edit.' }],
  ] as const) {
    expect(
      (await client.callTool({ name, arguments: { ...value, createOnly: true } })).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name, arguments: { ...revised, createOnly: true } })).isError,
    ).toBe(true);
    expect(data.store.get(kind, value.id)).toEqual(value);
    const read = await client.callTool({
      name: kind === 'preset' ? 'kitfold_presets' : 'kitfold_rules',
      arguments: { id: value.id },
    });
    const readDefinition = JSON.parse((read.content as { type: string; text: string }[])[0]!.text);
    expect(
      (await client.callTool({ name, arguments: { ...revised, expected: readDefinition } }))
        .isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name, arguments: { ...value, expected: value } })).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name,
          arguments: { ...value, expected: revised, createOnly: true },
        })
      ).isError,
    ).toBe(true);
    expect(data.store.get(kind, value.id)).toEqual(revised);
  }
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
  expect(data.store.list('trust')).toEqual([]);
});

test('MCP pages directives and large plan metadata without exposing bulk file bodies', async () => {
  const data = await fixture();
  cleanup.push(data.cleanup);
  for (let index = 0; index < 62; index++) {
    const suffix = String(index).padStart(2, '0');
    data.store.put('rule', {
      id: `page-${suffix}`,
      name: `Rule ${suffix}`,
      scope: 'pagination',
      content: 'private fixture body',
      enabled: true,
      priority: 50,
      provenance: 'Fixture',
    } satisfies Rule);
  }
  const plan: Plan = {
    id: crypto.randomUUID(),
    projectPath: data.project,
    providers: ['codex'],
    entries: [],
    createdAt: new Date().toISOString(),
    warnings: [],
    status: 'planned',
    changes: Array.from({ length: 62 }, (_, index) => ({
      path: `guides/${index}.md`,
      beforeHash: null,
      before: null,
      after: Buffer.from(`private body ${index}`).toString('base64'),
      reason: 'Fixture change',
    })),
  };
  data.store.put('plan', plan);
  const client = new Client({ name: 'pagination-fixture', version: '1.0.0' });
  cleanup.unshift(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('src/cli.ts'), 'mcp'],
      env: { KITFOLD_DATA_DIR: data.store.directory },
      stderr: 'pipe',
    }),
  );
  const rules = await client.callTool({
    name: 'kitfold_rules',
    arguments: { scope: 'pagination', offset: 30, limit: 30 },
  });
  const rows = JSON.parse((rules.content as { text: string }[])[0]!.text) as { id: string }[];
  expect(rows).toHaveLength(30);
  expect(rows[0]!.id).toBe('page-30');
  expect(JSON.stringify(rules)).not.toContain('private fixture body');
  const result = await client.callTool({
    name: 'kitfold_plan_changes',
    arguments: { planId: plan.id, offset: 50, limit: 50 },
  });
  expect(result.isError).not.toBe(true);
  const page = JSON.parse((result.content as { text: string }[])[0]!.text) as {
    total: number;
    nextOffset: null;
    changes: { index: number; path: string }[];
  };
  expect(page.total).toBe(62);
  expect(page.nextOffset).toBeNull();
  expect(page.changes).toHaveLength(12);
  expect(page.changes[0]).toMatchObject({ index: 50, path: 'guides/50.md' });
  expect(JSON.stringify(result)).not.toContain('private body');
  const preview = await client.callTool({
    name: 'kitfold_plan_file',
    arguments: { planId: plan.id, index: page.changes[0]!.index },
  });
  expect(JSON.stringify(preview)).toContain('private body 50');
  expect(data.store.get<Plan>('plan', plan.id)?.status).toBe('planned');
  expect(data.store.list('approval')).toHaveLength(0);
});
