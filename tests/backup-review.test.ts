import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { compareArchive, exportArchive } from '../src/core/archive';
import { exportLibrary } from '../src/core/backup';
import { backupFingerprint, compareBackup } from '../src/core/backup-review';
import { fixture, sampleSkill } from './helpers';

test('batch backup comparison ignores export time and order, and detects metadata, resource and removal changes', async () => {
  const data = await fixture();
  try {
    const skill = sampleSkill(data.store);
    const before = exportLibrary(data.store);
    const reordered = {
      ...before,
      exportedAt: '2099-01-01T00:00:00Z',
      sources: [...before.sources].reverse(),
    };
    expect(backupFingerprint(before)).toBe(backupFingerprint(reordered));
    expect(compareBackup(before, reordered).changes).toEqual([]);
    data.store.saveEntry({ ...skill, tags: ['new-tag'] });
    sampleSkill(data.store, 'additional-guide');
    const after = exportLibrary(data.store);
    const review = compareBackup(after, before);
    expect(review.counts.changed).toBe(1);
    expect(review.counts.added).toBe(1);
    expect(compareBackup(before, after).counts.removed).toBe(1);
    const resourceChange = structuredClone(before);
    resourceChange.entries[0]!.files.push({
      path: 'reference.md',
      content: 'Zml4dHVyZQ==',
      executable: false,
    });
    expect(compareBackup(resourceChange, before).counts.changed).toBe(1);
    expect(() => exportArchive(data.store, backupFingerprint(before))).toThrow(
      'changed after backup review',
    );
    expect(exportArchive(data.store, review.fingerprint).bytes.length).toBeGreaterThan(0);
  } finally {
    await data.cleanup();
  }
});
test('archive comparison fully validates its baseline without importing records or authority', async () => {
  const data = await fixture();
  const other = await fixture();
  try {
    sampleSkill(other.store, 'other-guide');
    const entries = data.store.entries(true);
    const plans = data.store.planSummaries();
    const review = compareArchive(data.store, exportArchive(other.store).bytes);
    expect(review.compared).toBe(true);
    expect(
      review.changes.filter((change) => change.kind === 'skill' && change.action === 'removed'),
    ).toHaveLength(1);
    expect(data.store.entries(true)).toEqual(entries);
    expect(data.store.planSummaries()).toEqual(plans);
    expect(data.store.list('ownership')).toEqual([]);
    expect(data.store.list('approval')).toEqual([]);
    const malformed = exportLibrary(other.store);
    malformed.entries[0]!.entry.digest = 'forged';
    expect(() => compareArchive(data.store, gzipSync(JSON.stringify(malformed)))).toThrow();
  } finally {
    await data.cleanup();
    await other.cleanup();
  }
});
