import { afterEach, expect, test } from 'bun:test';
import { reviseSkill } from '../src/core/skill-revisions';
import { setupSelection } from '../web/setup-selection';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('refreshing setup suggestions keeps an explicit pin ahead of a newer revision and keeps manual removals', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const pinned = sampleSkill(data.store, 'pinned-guide');
  const latest = reviseSkill(data.store, pinned.id, { body: 'Changed guidance.' });
  const excluded = sampleSkill(data.store, 'excluded-guide');
  const added = sampleSkill(data.store, 'manually-added-guide');
  const edits = new Map([
    [pinned.id, true],
    [excluded.id, false],
    [added.id, true],
  ]);
  expect(setupSelection([latest.id, excluded.id], edits, data.store.entries(true))).toEqual([
    pinned.id,
    added.id,
  ]);
  expect(data.store.entry(pinned.id)?.body).toBe(pinned.body);
});

test('a newly refreshed revision cannot undo a deliberate family removal; explicitly choosing another revision can', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const old = sampleSkill(data.store, 'excluded-guide');
  const latest = reviseSkill(data.store, old.id, { body: 'Changed guidance.' });
  const edits = new Map([[old.id, false]]);
  expect(setupSelection([latest.id], edits, data.store.entries(true))).toEqual([]);
  edits.set(latest.id, true);
  expect(setupSelection([old.id], edits, data.store.entries(true))).toEqual([latest.id]);
});

test('existing recommended archived snapshots remain pinned; unavailable content is never invented', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const existing = sampleSkill(data.store);
  data.store.saveEntry({ ...existing, archived: true });
  expect(setupSelection([existing.id, 'missing'], new Map(), data.store.entries(true))).toEqual([
    existing.id,
  ]);
});
