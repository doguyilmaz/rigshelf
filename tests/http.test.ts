import { afterEach, expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import type { Store } from '../src/core/store';
import type { DirectoryPickerDriver } from '../src/platform/folder-picker';
import { startServer } from '../src/server';
import { fixture } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
const MAX_PORT_ATTEMPTS = 5;
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixtureServer(store: Store, chooseDirectory?: DirectoryPickerDriver) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = randomInt(48000, 59000);
    try {
      return { server: startServer(store, port, { chooseDirectory }), port };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE')
        throw error;
    }
  }
  throw new Error('No available HTTP fixture port after bounded retries.');
}

async function serverFixture(chooseDirectory?: DirectoryPickerDriver) {
  const value = await fixture();
  cleanup.push(() => value.cleanup());
  const { server, port } = fixtureServer(value.store, chooseDirectory);
  cleanup.unshift(async () => {
    await server.stop(true);
  });
  const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(base)).text();
  const token = new URLSearchParams(new URL(server.accessUrl).hash.slice(1)).get('access');
  if (!token) throw new Error('No private access token');
  expect(html).not.toContain(token);
  return { ...value, base, token };
}

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
