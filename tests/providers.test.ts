import { expect, test } from 'bun:test';
import { parse } from '@iarna/toml';
import { connection } from '../src/core/connection';
import type { Mcp } from '../src/core/model';
import { adapters, mergeMcp, renderMcp } from '../src/core/providers';

const stdio: Mcp = {
  transport: 'stdio',
  command: 'bun',
  args: ['server.ts'],
  env: { API_KEY: '${API_KEY}', MODE: 'dev' },
  headers: {},
};
const remote: Mcp = {
  transport: 'http',
  url: 'https://example.com/mcp',
  args: [],
  env: {},
  headers: { Authorization: '${MCP_AUTHORIZATION}', 'X-Region': 'eu' },
};

test('every shipped adapter has a documented project skill path and usable MCP output', () => {
  for (const adapter of adapters) {
    expect(adapter.skills).toBeTruthy();
    expect(adapter.docs).toStartWith('https://');
    const output = mergeMcp(null, adapter.id, { stdio, remote });
    const parsed = adapter.format === 'toml' ? parse(output) : JSON.parse(output);
    expect(Object.keys(parsed)).toContain(adapter.mcpKey);
  }
});
test('Codex inherits secret environment values and maps HTTP header environment variables instead of writing literal placeholders', () => {
  expect(renderMcp(stdio, 'codex')).toEqual({
    command: 'bun',
    args: ['server.ts'],
    env: { MODE: 'dev' },
    env_vars: ['API_KEY'],
  });
  expect(renderMcp(remote, 'codex')).toEqual({
    url: remote.url,
    http_headers: { 'X-Region': 'eu' },
    env_http_headers: { Authorization: 'MCP_AUTHORIZATION' },
  });
});
test('OpenCode gets command arrays and Antigravity gets serverUrl', () => {
  expect(renderMcp(stdio, 'opencode').command).toEqual(['bun', 'server.ts']);
  expect(renderMcp(remote, 'antigravity').serverUrl).toBe(remote.url);
});
test('MCP merge preserves unrelated settings, rejects collisions, and removes only unchanged owned servers', () => {
  const before = JSON.stringify({
    theme: 'light',
    mcpServers: { existing: { command: 'existing' } },
  });
  const output = JSON.parse(mergeMcp(before, 'claude', { docs: remote }));
  expect(output.theme).toBe('light');
  expect(output.mcpServers.existing.command).toBe('existing');
  expect(() => mergeMcp(before, 'claude', { existing: stdio })).toThrow('already exists');
  const removed = JSON.parse(mergeMcp(JSON.stringify(output), 'claude', {}, { docs: remote }));
  expect(removed.mcpServers.docs).toBeUndefined();
  expect(removed.mcpServers.existing).toBeTruthy();
});
test('TOML round trips remain idempotent when the serializer changes object key order', () => {
  const first = mergeMcp('model = "selected"\n', 'codex', { docs: remote });
  expect(() => mergeMcp(first, 'codex', { docs: remote }, { docs: remote })).not.toThrow();
  expect(parse(mergeMcp(first, 'codex', { docs: remote }, { docs: remote })).model).toBe(
    'selected',
  );
});
test('connection snippets use each harness format and writable mode requires an explicit project scope', async () => {
  for (const provider of ['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok']) {
    const result = await connection({ provider });
    expect(result.content).toContain('kitfold');
    expect(result.content).not.toContain('--write');
    expect(result.file).toBeTruthy();
  }
  await expect(connection({ provider: 'codex', writable: true })).rejects.toThrow(
    'explicit project root',
  );
  const writable = await connection({
    provider: 'codex',
    writable: true,
    projectPath: '.local/tests/connection-fixture',
  });
  expect(writable.content).toContain('--root');
  expect(writable.content).toContain('--write');
});
