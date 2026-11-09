import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { InventoryScan } from '../src/core/scan-lifecycle';
import { startServer } from '../src/server';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('shutdown refuses new inventory starts and drains the current job before the catalog can close', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began = false;
  const owned = new InventoryScan(data.store, async () => {
    began = true;
    await gate;
    data.store.put('fixture-result', { id: 'complete', value: 'durable' });
  });
  cleanups.unshift(async () => {
    release();
    await owned.close();
  });
  owned.start();
  expect(() => owned.start()).toThrow('already running');
  await Promise.resolve();
  expect(began).toBe(true);
  let closed = false;
  const closing = owned.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(() => owned.start()).toThrow('shutting down');
  release();
  await closing;
  expect(data.store.get('fixture-result', 'complete')).toEqual({
    id: 'complete',
    value: 'durable',
  });
  await owned.close();
});

test('owned scan failures settle and record their receipt before shutdown', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const owned = new InventoryScan(data.store, async () => {
    throw new Error('Fixture inventory failure');
  });
  owned.start();
  await owned.close();
  expect(
    data.store
      .events()
      .filter((event) => event.action === 'scan.failed')
      .map((event) => event.detail),
  ).toEqual(['Fixture inventory failure']);
});

test('HTTP workbench shutdown awaits its real fixture inventory without reading global or existing projects', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  await Bun.write(join(data.project, 'package.json'), '{}');
  for (let index = 0; index < 20; index++)
    await Bun.write(
      join(data.project, '.agents/skills', `fixture-${index}`, 'SKILL.md'),
      `---\nname: fixture-${index}\ndescription: Use this focused fixture.\n---\n\nKeep inputs explicit.\n`,
    );
  data.store.put('settings', {
    id: 'main',
    ...data.store.settings(),
    roots: [data.project],
    scanGlobals: false,
  });
  const server = startServer(data.store, 48017);
  cleanups.unshift(async () => {
    await server.stop(true);
  });
  const token = new URLSearchParams(new URL(server.accessUrl).hash.slice(1)).get('access')!;
  const origin = new URL(server.accessUrl).origin;
  const started = await fetch(`${origin}/api/scan`, {
    method: 'POST',
    headers: { 'x-kitfold-token': token, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(started.status).toBe(200);
  await server.stop(true);
  expect(data.store.entries()).toHaveLength(20);
  expect(data.store.events().some((event) => event.action === 'scan.completed')).toBe(true);
  expect(data.store.events().filter((event) => event.action === 'scan.failed')).toEqual([]);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
});
