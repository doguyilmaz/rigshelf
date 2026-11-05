import { afterEach, expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import type { Store } from '../src/core/store';
import { startServer } from '../src/server';
import { fixture } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
const MAX_PORT_ATTEMPTS = 5;
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixtureServer(store: Store) {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = randomInt(48000, 59000);
    try {
      return { server: startServer(store, port), port };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE')
        throw error;
    }
  }
  throw new Error('No available HTTP fixture port after bounded retries.');
}

async function serverFixture() {
  const value = await fixture();
  cleanup.push(() => value.cleanup());
  const { server, port } = fixtureServer(value.store);
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
