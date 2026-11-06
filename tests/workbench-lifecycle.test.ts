import { afterEach, expect, test } from 'bun:test';
import { exportLibrary } from '../src/core/backup';
import { Store } from '../src/core/store';
import { openWorkbenchServer } from '../src/platform/workbench-start';
import { startServer } from '../src/server';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('same-catalog access survives a process restart, stays out of state/portable exports and can be explicitly rotated', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const blocker = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('fixture'),
  });
  const port = blocker.port;
  await blocker.stop(true);
  const first = startServer(data.store, port);
  const token = new URL(first.accessUrl).hash.slice(8);
  await first.stop(true);
  data.store.close();
  const reopened = new Store(data.store.directory);
  cleanups.unshift(async () => reopened.close());
  const second = startServer(reopened, port);
  expect(second.accessUrl).toContain(token);
  const headers = { 'x-kitfold-token': token };
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers })).text();
  expect(state).not.toContain(token);
  expect(JSON.stringify(exportLibrary(reopened))).not.toContain(token);
  await second.stop(true);
  const reset = startServer(reopened, port, { resetAccess: true });
  cleanups.unshift(async () => {
    await reset.stop(true);
  });
  expect(reset.accessUrl).not.toContain(token);
  expect((await fetch(`http://127.0.0.1:${port}/api/state`, { headers })).status).toBe(403);
  const next = new URL(reset.accessUrl).hash.slice(8);
  expect(
    (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'x-kitfold-token': next } }))
      .status,
  ).toBe(200);
});

test('an occupied explicit port starts no automation and changes no access record; implicit default collisions advance without stopping a listener', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const explicit = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('owned fixture listener'),
  });
  cleanups.unshift(async () => {
    await explicit.stop(true);
  });
  expect(() => openWorkbenchServer(data.store, explicit.port, true)).toThrow('is in use');
  expect(data.store.get('local-ui-access', 'main')).toBeUndefined();
  expect(await (await fetch(`http://127.0.0.1:${explicit.port}`)).text()).toBe(
    'owned fixture listener',
  );
  let defaultBlocker: Bun.Server<undefined> | undefined;
  try {
    defaultBlocker = Bun.serve({
      hostname: '127.0.0.1',
      port: 47471,
      fetch: () => new Response('default fixture'),
    });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
  }
  if (defaultBlocker)
    cleanups.unshift(async () => {
      await defaultBlocker.stop(true);
    });
  const { server, moved } = openWorkbenchServer(data.store);
  cleanups.unshift(async () => {
    await server.stop(true);
  });
  expect(moved).toBe(true);
  expect(server.port).toBeGreaterThan(47471);
  expect(server.port).toBeLessThanOrEqual(47478);
  if (defaultBlocker)
    expect(await (await fetch('http://127.0.0.1:47471')).text()).toBe('default fixture');
});
