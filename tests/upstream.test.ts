import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { discoverSkills } from '../src/core/discovery';
import { addSource } from '../src/core/source-library';
import { checkSource, discoverSourceSkills, importUpstreamSkill } from '../src/core/upstream';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
const originalToken = process.env.GITHUB_TOKEN;
afterEach(async () => {
  mock.restore();
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  return value;
}

function mockFetch(
  implementation: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): void {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(implementation, { preconnect: fetch.preconnect }),
  );
}

test('source checks preserve edits made while remote evidence is loading', async () => {
  const { store } = await setup();
  const source = await addSource(store, { input: 'example/concurrent', research: false });
  mockFetch(async (input) => {
    if (String(input).endsWith('/commits/HEAD')) {
      store.put('source', {
        ...source,
        name: 'Edited name',
        notes: 'Authored note\nLast check: old failure\nKeep following note',
        recipe: 'custom recipe',
      });
      return Response.json({ sha: 'b'.repeat(40) });
    }
    return Response.json({ owner: { login: 'example' }, archived: false });
  });
  const checked = await checkSource(store, source.id);
  expect(checked).toMatchObject({
    name: 'Edited name',
    notes: 'Authored note\nKeep following note',
    recipe: 'custom recipe',
    latestRef: 'b'.repeat(40),
    status: 'reachable',
  });
});

test('remote checks cannot resurrect deleted sources or attach evidence to a changed URL', async () => {
  const { store } = await setup();
  for (const action of ['retarget', 'delete'] as const) {
    const source = await addSource(store, { input: `example/${action}`, research: false });
    mockFetch(async (input) => {
      if (String(input).endsWith('/commits/HEAD')) {
        if (action === 'delete') store.remove('source', source.id);
        else store.put('source', { ...source, url: 'https://github.com/example/replacement' });
        return Response.json({ sha: 'c'.repeat(40) });
      }
      return Response.json({ owner: { login: 'example' }, archived: false });
    });
    await expect(checkSource(store, source.id)).rejects.toThrow('Source changed');
    if (action === 'delete') expect(store.get('source', source.id)).toBeUndefined();
    else
      expect(store.get('source', source.id)).toMatchObject({
        url: 'https://github.com/example/replacement',
        status: 'unchecked',
      });
    mock.restore();
  }
});

test('an import refuses changed source identity after downloading instead of misattributing a snapshot', async () => {
  const { store } = await setup();
  const source = await addSource(store, { input: 'example/identity', research: false });
  mockFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/commits/HEAD')) return Response.json({ sha: 'd'.repeat(40) });
    if (url.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [{ path: 'SKILL.md', type: 'blob', mode: '100644', size: 100 }],
      });
    store.put('source', { ...source, url: 'https://github.com/example/changed' });
    return new Response(
      '---\nname: identity-guide\ndescription: Identity fixture.\n---\nRead carefully.',
    );
  });
  await expect(importUpstreamSkill(store, source.id, 'SKILL.md')).rejects.toThrow('Source changed');
  expect(store.entries()).toHaveLength(0);
});

test('research indexes immutable paths; import preserves safe files and never sends GitHub credentials to raw hosts', async () => {
  const { store } = await setup();
  process.env.GITHUB_TOKEN = 'dummy-github-token';
  const requests: { host: string; auth: string | null }[] = [];
  const ref = 'a'.repeat(40);
  const body =
    '---\nname: remote-guide\ndescription: Use for remote library import tests.\n---\n\nRead supporting files only when relevant.\n';
  mockFetch(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ host: url.hostname, auth: new Headers(init?.headers).get('Authorization') });
    if (url.pathname.endsWith('/commits/HEAD')) return Response.json({ sha: ref });
    if (url.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [
          { path: 'skills/remote-guide/SKILL.md', type: 'blob', mode: '100644', size: body.length },
          { path: 'skills/remote-guide/scripts/check.sh', type: 'blob', mode: '100755', size: 18 },
          { path: 'skills/remote-guide/credentials.json', type: 'blob', mode: '100644', size: 50 },
          { path: 'skills/remote-guide/linked.md', type: 'blob', mode: '120000', size: 15 },
        ],
      });
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/example/skills')
      return Response.json({
        owner: { login: 'example' },
        archived: false,
        license: { spdx_id: 'MIT' },
        description: 'A public example.',
      });
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/SKILL.md')) {
      expect(url.pathname).toContain(ref);
      return new Response(body);
    }
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/check.sh'))
      return new Response('#!/bin/sh\nexit 0\n');
    throw new Error(`Unexpected network request: ${url.hostname}${url.pathname}`);
  });
  const source = await addSource(store, { input: 'https://skills.sh/example/skills/remote-guide' });
  expect(source.skillCount).toBe(1);
  expect(source.repository?.license).toBe('MIT');
  expect(store.get<{ skills: unknown[] }>('source-index', source.id)?.skills).toHaveLength(1);
  const imported = await importUpstreamSkill(store, source.id, 'skills/remote-guide/SKILL.md');
  expect(imported.upstreamRef).toBe(ref);
  expect(store.files(imported.id).map((file) => file.path)).toEqual([
    'SKILL.md',
    'scripts/check.sh',
  ]);
  expect(store.files(imported.id)[1].executable).toBe(true);
  expect(imported.findings.map((finding) => finding.code)).toContain('sensitive-resource');
  expect(imported.findings.map((finding) => finding.code)).toContain('symlink');
  expect(
    requests
      .filter((request) => request.host === 'api.github.com')
      .every((request) => request.auth === 'Bearer dummy-github-token'),
  ).toBe(true);
  expect(
    requests
      .filter((request) => request.host !== 'api.github.com')
      .every((request) => request.auth === null),
  ).toBe(true);
});

test('source discovery refuses truncated trees and path traversal without persisting an imported snapshot', async () => {
  const { store } = await setup();
  const source = await addSource(store, { input: 'example/skills', research: false });
  mockFetch(async (input) =>
    String(input).includes('/commits/')
      ? Response.json({ sha: 'a'.repeat(40) })
      : Response.json({ truncated: true, tree: [] }),
  );
  await expect(discoverSourceSkills(store, source.id)).rejects.toThrow('too large');
  await expect(importUpstreamSkill(store, source.id, '../SKILL.md')).rejects.toThrow('Unsafe');
  expect(store.entries()).toHaveLength(0);
});

test('remote instruction bodies obey the same text limit as local skills before saving', async () => {
  const { store } = await setup();
  const source = await addSource(store, { input: 'example/oversized', research: false });
  const body = `---\nname: oversized-guide\ndescription: A bounded import fixture.\n---\n${'x'.repeat(1024 * 1024)}`;
  mockFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/commits/HEAD')) return Response.json({ sha: 'a'.repeat(40) });
    if (url.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [{ path: 'SKILL.md', type: 'blob', mode: '100644', size: body.length }],
      });
    if (url.hostname === 'raw.githubusercontent.com') return new Response(body);
    return Response.json({ owner: { login: 'example' }, archived: false });
  });
  await expect(importUpstreamSkill(store, source.id, 'SKILL.md')).rejects.toThrow('512 KiB');
  expect(store.entries()).toHaveLength(0);
});

test('directory discovery validates suggestions, records dated evidence, and treats popularity separately from trust', async () => {
  const { store } = await setup();
  mockFetch(async (input) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe('skills.sh');
    expect(url.searchParams.get('q')).toBe('SwiftUI gestures');
    return Response.json({
      skills: [
        {
          id: 'example/skills/swift-guide',
          name: 'Swift guide',
          source: 'example/skills',
          installs: 2500,
        },
        {
          id: 'invalid',
          name: 'Unknown source',
          source: 'https://untrusted.invalid/path',
          installs: 9999,
        },
      ],
    });
  });
  const result = await discoverSkills(store, { query: 'SwiftUI gestures' });
  expect(result.skills).toHaveLength(1);
  expect(result.skills[0].installs).toBe(2500);
  expect(store.list('trust')).toHaveLength(0);
  expect(store.get('discovery', result.id)).toBeDefined();
  await expect(discoverSkills(store, { query: 'token="private-value"' })).rejects.toThrow(
    'public technology',
  );
});

test('plugin commands remain native recipes and are never translated into executable portable skills', async () => {
  const { store } = await setup();
  const source = await addSource(store, {
    input: '/plugin marketplace add example/agent-skills',
    research: false,
  });
  expect(source.url).toBe('https://github.com/example/agent-skills');
  const entry = store.entries().find((value) => value.kind === 'plugin');
  expect(entry).toBeDefined();
  expect(store.entry(entry!.id)?.body).toBe('/plugin marketplace add example/agent-skills');
  expect(store.files(entry!.id)).toHaveLength(0);
});
