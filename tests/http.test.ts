import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import type { Preset, Source } from '../src/core/model';
import type { Store } from '../src/core/store';
import type { AiDriver } from '../src/platform/ai-runner';
import type { DirectoryPickerDriver } from '../src/platform/folder-picker';
import { startServer } from '../src/server';
import { fixture } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
const MAX_PORT_ATTEMPTS = 5;
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixtureServer(store: Store, chooseDirectory?: DirectoryPickerDriver, aiDriver?: AiDriver) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = randomInt(48000, 59000);
    try {
      return { server: startServer(store, port, { chooseDirectory, aiDriver }), port };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE')
        throw error;
    }
  }
  throw new Error('No available HTTP fixture port after bounded retries.');
}

async function serverFixture(chooseDirectory?: DirectoryPickerDriver, aiDriver?: AiDriver) {
  const value = await fixture();
  cleanup.push(() => value.cleanup());
  const { server, port } = fixtureServer(value.store, chooseDirectory, aiDriver);
  cleanup.unshift(async () => {
    await server.stop(true);
  });
  const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(base)).text();
  const token = new URLSearchParams(new URL(server.accessUrl).hash.slice(1)).get('access');
  if (!token) throw new Error('No private access token');
  expect(html).not.toContain(token);
  return { ...value, base, token, server };
}

test('a missing interface chunk returns 404 instead of serving HTML as JavaScript', async () => {
  const data = await serverFixture();
  const response = await fetch(`${data.base}/assets/missing-fixture-chunk.js`);
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).not.toContain('text/html');
  expect(await response.text()).not.toContain('<html');
  expect(data.store.planSummaries()).toEqual([]);
});

test('definition collisions and stale checked edits report HTTP 409 without returning the newer body or accepting unchecked fallbacks', async () => {
  const data = await serverFixture();
  const preset = data.store.get<Preset>('preset', 'expo')!;
  const headers = { 'x-kitfold-token': data.token, 'content-type': 'application/json' };
  const duplicate = await fetch(`${data.base}/api/presets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(preset),
  });
  expect(duplicate.status).toBe(409);
  const newer = { ...preset, description: 'Newer private fixture definition.' };
  data.store.put('preset', newer);
  const stale = await fetch(`${data.base}/api/presets/${preset.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ value: preset, expected: preset }),
  });
  expect(stale.status).toBe(409);
  expect(await stale.text()).not.toContain(newer.description);
  const invalid = await fetch(`${data.base}/api/presets/${preset.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ value: preset, expected: null }),
  });
  expect(invalid.status).toBe(400);
  expect(data.store.get('preset', preset.id)).toEqual(newer);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
});

test('forced socket shutdown still drains an in-flight source mutation after its client disconnects', async () => {
  const data = await serverFixture();
  const actualFetch = globalThis.fetch;
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        if (url.hostname !== 'api.github.com')
          throw new Error('Unexpected fixture network request.');
        entered();
        await gate;
        if (url.pathname.endsWith('/commits/HEAD')) return Response.json({ sha: 'c'.repeat(40) });
        if (url.pathname.includes('/git/trees/'))
          return Response.json({ tree: [], truncated: false });
        return Response.json({
          owner: { login: 'example' },
          license: { spdx_id: 'MIT' },
          archived: false,
          description: 'An isolated fixture.',
        });
      },
      { preconnect: actualFetch.preconnect },
    ),
  );
  let closing: Promise<void> | undefined;
  try {
    const pending = actualFetch(`${data.base}/api/sources`, {
      method: 'POST',
      headers: { 'x-kitfold-token': data.token, 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'example/shutdown-fixture', research: true }),
    }).catch(() => undefined);
    await began;
    let closed = false;
    closing = data.server.stop(true).then(() => {
      closed = true;
    });
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release();
    await closing;
    const source = data.store
      .sources()
      .find((source) => source.url === 'https://github.com/example/shutdown-fixture') as Source;
    expect(source.latestRef).toBe('c'.repeat(40));
    expect(source.status).toBe('reachable');
    expect(source.skillCount).toBe(0);
    expect(data.store.planSummaries()).toEqual([]);
  } finally {
    release();
    try {
      await closing;
      await data.server.stop(true);
    } finally {
      mock.restore();
    }
  }
});

test('AI draft requests use private JSON authorization, return metadata-only status and never grant project authority', async () => {
  let calls = 0;
  const data = await serverFixture(undefined, async () => {
    calls++;
    return {
      summary: 'A fixture draft.',
      questions: [],
      draft: { kind: 'text', text: 'A formatted fixture note.' },
    };
  });
  const body = JSON.stringify({
    task: 'text',
    runner: 'claude',
    text: 'Format this fixture note.',
  });
  const url = `${data.base}/api/ai/drafts`;
  expect((await fetch(url, { method: 'POST', body })).status).toBe(403);
  const headers = { 'x-kitfold-token': data.token, 'content-type': 'application/json' };
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...headers, origin: 'https://foreign.example' },
        body,
      })
    ).status,
  ).toBe(403);
  expect(calls).toBe(0);
  const response = await fetch(url, { method: 'POST', headers, body });
  expect(response.status).toBe(200);
  const job = (await response.json()) as { id: string };
  expect(job).not.toHaveProperty('request');
  expect(job).not.toHaveProperty('prompt');
  const status = (await (await fetch(`${url}/${job.id}`, { headers })).json()) as { state: string };
  expect(['running', 'ready']).toContain(status.state);
  expect(calls).toBe(1);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
});

test('local HTTP rejects foreign origins and missing tokens, while the app session can read its catalog', async () => {
  const { base, token } = await serverFixture();
  expect((await fetch(`${base}/api/state`)).status).toBe(403);
  expect(
    (
      await fetch(`${base}/api/state`, {
        headers: { 'x-kitfold-token': token, origin: 'https://malicious.example' },
      })
    ).status,
  ).toBe(403);
  const response = await fetch(`${base}/api/state`, { headers: { 'x-kitfold-token': token } });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(((await response.json()) as { entries: unknown[] }).entries).toEqual([]);
});

test('mutations require JSON and malformed input leaves the private store unchanged', async () => {
  const { base, token, store } = await serverFixture();
  const headers = { 'x-kitfold-token': token };
  expect(
    (await fetch(`${base}/api/custom`, { method: 'POST', headers, body: 'name=bad' })).status,
  ).toBe(415);
  const response = await fetch(`${base}/api/custom`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'missing-content' }),
  });
  expect(response.status).toBe(400);
  expect(store.entries()).toHaveLength(0);
});

test('metadata and source content are returned as data and cannot change security response headers', async () => {
  const { base, token } = await serverFixture();
  const response = await fetch(`${base}/api/custom`, {
    method: 'POST',
    headers: { 'x-kitfold-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'xss-guide',
      description: '<img src=x onerror=alert(1)>',
      body: '<script>alert(1)</script>',
      tags: [],
    }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const result = (await response.json()) as { body: string };
  expect(result.body).toContain('<script>');
});

test('native folder selection requires the private same-origin POST and does not scan or authorize the chosen project', async () => {
  const calls: string[] = [];
  const data = await serverFixture(async (initial) => {
    calls.push(initial);
    return initial;
  });
  const url = `${data.base}/api/pick-directory`;
  const body = JSON.stringify({ initialPath: data.project });
  const headers = { 'x-kitfold-token': data.token, 'content-type': 'application/json' };
  expect((await fetch(url, { method: 'POST', body })).status).toBe(403);
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...headers, origin: 'https://untrusted.example' },
        body,
      })
    ).status,
  ).toBe(403);
  expect((await fetch(url, { headers })).status).toBe(405);
  expect(
    (await fetch(url, { method: 'POST', headers: { 'x-kitfold-token': data.token }, body })).status,
  ).toBe(415);
  expect(
    (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ command: 'untrusted' }) }))
      .status,
  ).toBe(400);
  expect(calls).toHaveLength(0);
  const before = data.store.settings();
  const response = await fetch(url, { method: 'POST', headers, body });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ path: data.project });
  expect(calls).toEqual([data.project]);
  expect(data.store.projects()).toHaveLength(0);
  expect(data.store.settings()).toEqual(before);
  expect(data.store.list('approval')).toHaveLength(0);
});

test('the workbench opens at rigshelf.localhost and still refuses other hosts and origins', async () => {
  const data = await serverFixture();
  const access = new URL(data.server.accessUrl);
  expect(access.hostname).toBe('rigshelf.localhost');
  const headers = { 'x-kitfold-token': data.token };
  const request = (host: string, origin?: string) =>
    fetch(`${data.base}/api/state`, {
      headers: { ...headers, host: `${host}:${access.port}`, ...(origin ? { origin } : {}) },
    });
  expect((await request('rigshelf.localhost', access.origin)).status).toBe(200);
  expect((await request('127.0.0.1')).status).toBe(200);
  expect((await request('other.localhost')).status).toBe(403);
  expect(
    (await request('rigshelf.localhost', `http://other.localhost:${access.port}`)).status,
  ).toBe(403);
});

test('a tunnelled workbench accepts its public port and prints the URL for it', async () => {
  const value = await fixture();
  cleanup.push(() => value.cleanup());
  const remotePort = randomInt(48000, 52000);
  const publicPort = randomInt(52001, 56000);
  const server = startServer(value.store, remotePort, { publicPort });
  cleanup.unshift(async () => {
    await server.stop(true);
  });
  type Link = { upstream?: Bun.Socket; pending: Uint8Array[] };
  const forwarder = Bun.listen<Link>({
    hostname: '127.0.0.1',
    port: publicPort,
    socket: {
      open(client) {
        client.data = { pending: [] };
        void Bun.connect({
          hostname: '127.0.0.1',
          port: remotePort,
          socket: {
            data(_, chunk) {
              client.write(chunk);
            },
            close() {
              client.end();
            },
          },
        }).then((upstream) => {
          client.data.upstream = upstream;
          for (const chunk of client.data.pending.splice(0)) upstream.write(chunk);
        });
      },
      data(client, chunk) {
        if (client.data.upstream) client.data.upstream.write(chunk);
        else client.data.pending.push(chunk);
      },
      close(client) {
        client.data.upstream?.end();
      },
    },
  });
  cleanup.unshift(async () => forwarder.stop(true));
  const access = new URL(server.accessUrl);
  expect(access.host).toBe(`rigshelf.localhost:${publicPort}`);
  const token = new URLSearchParams(access.hash.slice(1)).get('access')!;
  const state = await fetch(`http://127.0.0.1:${publicPort}/api/state`, {
    headers: { host: access.host, origin: access.origin, 'x-kitfold-token': token },
  });
  expect(state.status).toBe(200);
  const foreign = await fetch(`http://127.0.0.1:${publicPort}/api/state`, {
    headers: { host: `rigshelf.localhost:${publicPort + 1}`, 'x-kitfold-token': token },
  });
  expect(foreign.status).toBe(403);
});
