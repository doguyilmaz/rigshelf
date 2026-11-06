import { afterEach, expect, spyOn, test } from 'bun:test';
import { exportLibrary, importLibrary } from '../src/core/backup';
import { S3BackupSchema } from '../src/core/backup-destinations';
import { BackupJobs } from '../src/core/backup-jobs';
import {
  prepareRemoteBackup,
  removeBackupDestination,
  saveBackupDestination,
} from '../src/core/backup-manager';
import { backupHistory, prepareBackupRestore, restoreBackup } from '../src/core/backup-restore';
import { s3BackupTransport } from '../src/core/backup-s3';
import { Store } from '../src/core/store';
import { MemoryS3 } from './fixtures/backup-s3';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
test('portable import validates and writes under one database reservation, preserving a concurrent authored directive', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const rule = {
    id: 'authored-rule',
    name: 'Authored rule',
    scope: 'global',
    content: 'Original guidance',
    enabled: true,
    priority: 10,
    provenance: 'Fixture',
  };
  data.store.put('rule', rule);
  const bundle = exportLibrary(data.store);
  const other = new Store(data.store.directory);
  other.db.exec('PRAGMA busy_timeout=0');
  cleanups.push(async () => other.close());
  const newer = { ...rule, content: 'Concurrent authored guidance' };
  const read = data.store.get.bind(data.store);
  let attempted = false;
  let reserved = false;
  const observed = spyOn(data.store, 'get').mockImplementation(
    <T>(type: string, id: string): T | undefined => {
      const value = read<T>(type, id);
      if (type === 'rule' && id === rule.id && !attempted) {
        attempted = true;
        try {
          other.put('rule', newer);
        } catch (failure) {
          if (!(failure instanceof Error) || !failure.message.includes('locked')) throw failure;
          reserved = true;
        }
      }
      return value;
    },
  );
  try {
    importLibrary(data.store, bundle, true);
  } finally {
    observed.mockRestore();
  }
  if (reserved) other.put('rule', newer);
  expect(attempted).toBe(true);
  expect(other.get('rule', rule.id)).toEqual(newer);
});
test('destination aliases share persistent exclusion and cancellation drains before another Sync can start', async () => {
  const data = await context();
  const alias = { ...data.destination, id: 'alias-backup', name: 'Alias backup' };
  saveBackupDestination(data.store, alias);
  sampleSkill(data.store, 'alias-test');
  const first = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  const second = await prepareRemoteBackup(data.store, alias.id, data.factory);
  const other = new Store(data.store.directory);
  const jobs = new BackupJobs(other, data.factory);
  cleanups.push(async () => {
    await jobs.close();
    other.close();
  });
  data.jobs.start(first.id);
  expect(() => jobs.start(second.id)).toThrow('unfinished');
  expect(() => removeBackupDestination(other, data.destination.id, data.destination)).toThrow(
    'pending',
  );
  expect(() =>
    saveBackupDestination(
      other,
      { ...data.destination, bucket: 'different-bucket' },
      data.destination,
    ),
  ).toThrow('pending');
  expect((await data.jobs.cancel(first.id)).state).toBe('cancelled');
  expect(data.remote.objects.size).toBe(0);
  jobs.start(second.id);
  expect((await jobs.wait(second.id)).state).toBe('published');
});
async function context() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const remote = new MemoryS3();
  const destination = S3BackupSchema.parse({
    id: 'fixture-s3',
    name: 'Fixture S3',
    kind: 's3',
    endpoint: 'http://127.0.0.1:49000',
    bucket: 'test-private',
    privateBucketConfirmed: true,
  });
  saveBackupDestination(data.store, destination);
  const factory = () =>
    s3BackupTransport(
      destination,
      {
        RIGSHELF_BACKUP_S3_ACCESS_KEY_ID: 'fixture-key',
        RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
      },
      remote.fetch,
    );
  const jobs = new BackupJobs(data.store, factory);
  cleanups.push(() => jobs.close());
  return { ...data, remote, destination, factory, jobs };
}
test('S3 Sync is explicit, one reviewed immutable archive, a verified no-op, and linked history', async () => {
  const data = await context();
  sampleSkill(data.store, 'first');
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  expect(data.remote.requests.every((request) => request.method === 'GET')).toBe(true);
  const started = data.jobs.start(review.id);
  expect(data.jobs.start(review.id).id).toBe(started.id);
  const completed = await data.jobs.wait(started.id);
  expect(completed.state).toBe('published');
  expect(data.remote.objects.size).toBe(3);
  expect(
    data.remote.requests
      .filter((request) => request.method === 'PUT' && request.path.endsWith('/current.json'))[0]
      ?.headers.get('if-none-match'),
  ).toBe('*');
  const noop = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(noop.id);
  expect((await data.jobs.wait(noop.id)).state).toBe('noop');
  expect(data.remote.objects.size).toBe(3);
  sampleSkill(data.store, 'second');
  const next = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(next.id);
  expect((await data.jobs.wait(next.id)).state).toBe('published');
  const history = await backupHistory(data.store, data.destination.id, {}, data.factory);
  expect(history.snapshots.map((value) => value.digest)).toEqual([
    next.manifestDigest,
    review.manifestDigest,
  ]);
  expect(
    data.remote.requests
      .filter((request) => request.method === 'PUT' && request.path.endsWith('/current.json'))[1]
      ?.headers.has('if-match'),
  ).toBe(true);
});
test('lost publication acknowledgements reconcile the same frozen Snapshot without a second backup', async () => {
  const data = await context();
  sampleSkill(data.store, 'frozen');
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.remote.loseNextCurrentResponse = true;
  data.jobs.start(review.id);
  expect((await data.jobs.wait(review.id)).state).toBe('uncertain');
  sampleSkill(data.store, 'created-after-interruption');
  expect(() => data.jobs.retry(review.id)).toThrow('acknowledge');
  data.jobs.retry(review.id, true);
  const recovered = await data.jobs.wait(review.id);
  expect(recovered.state).toBe('published');
  expect(recovered.manifestDigest).toBe(review.manifestDigest);
  expect(
    data.remote.requests.filter(
      (request) => request.method === 'PUT' && request.path.endsWith('/current.json'),
    ),
  ).toHaveLength(1);
});
test('a concurrent publication receipt cannot be reset to queued by a stale retry', async () => {
  const data = await context();
  sampleSkill(data.store, 'receipt-race');
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(review.id);
  const published = await data.jobs.wait(review.id);
  expect(published.state).toBe('published');
  data.store.put('backup-operation', {
    ...published,
    state: 'failed',
    sequence: published.sequence + 1,
  });
  const read = data.store.get.bind(data.store);
  let interleaved = false;
  const observed = spyOn(data.store, 'get').mockImplementation(
    <T>(type: string, id: string): T | undefined => {
      const current = read<T>(type, id);
      if (type === 'backup-operation' && id === review.id && !interleaved) {
        interleaved = true;
        data.store.put('backup-operation', { ...published, sequence: published.sequence + 2 });
      }
      return current;
    },
  );
  try {
    expect(() => data.jobs.retry(review.id, true)).toThrow('no longer needs');
  } finally {
    observed.mockRestore();
  }
  expect(data.jobs.get(review.id).state).toBe('published');
});
test('stale reviews, aliases and nonconditional S3 providers cannot silently overwrite backups', async () => {
  const data = await context();
  sampleSkill(data.store, 'before');
  const stale = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  sampleSkill(data.store, 'after');
  expect(() => data.jobs.start(stale.id)).toThrow('changed after review');
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.remote.enforceConditions = false;
  data.jobs.start(review.id);
  expect((await data.jobs.wait(review.id)).state).toBe('failed');
  expect([...data.remote.objects.keys()].some((path) => path.endsWith('/current.json'))).toBe(
    false,
  );
  data.remote.enforceConditions = true;
  data.jobs.retry(review.id, true);
  expect((await data.jobs.wait(review.id)).state).toBe('published');
  const winner = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  sampleSkill(data.store, 'concurrent');
  const other = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(other.id);
  await data.jobs.wait(other.id);
  expect(() => data.jobs.start(winner.id)).toThrow('changed after review');
});
test('a probe cleanup failure is actionable and blocks publication instead of silently leaving test objects', async () => {
  const data = await context();
  data.remote.rejectProbeDeletion = true;
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(review.id);
  const failed = await data.jobs.wait(review.id);
  expect(failed.state).toBe('failed');
  expect(failed.error).toContain('could not be removed');
  expect(failed.error).toContain('/.probe/');
  expect([...data.remote.objects.keys()].every((value) => value.includes('/.probe/'))).toBe(true);
});
test('remote restore keeps local-only and authored records, previews explicit definition replacements and never imports authority', async () => {
  const data = await context();
  const saved = sampleSkill(data.store, 'restore-me');
  data.store.put('rule', {
    id: 'test-rule',
    name: 'Test rule',
    scope: 'global',
    enabled: true,
    content: 'Original guidance',
    priority: 1,
    provenance: 'Custom',
  });
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(review.id);
  await data.jobs.wait(review.id);
  data.store.deleteEntry(saved.id);
  sampleSkill(data.store, 'local-only');
  data.store.put('rule', {
    id: 'test-rule',
    name: 'Test rule',
    scope: 'global',
    enabled: true,
    content: 'Authored later',
    priority: 1,
    provenance: 'Custom',
  });
  const restore = await prepareBackupRestore(
    data.store,
    data.destination.id,
    review.manifestDigest,
    'missing',
    data.factory,
  );
  expect(restore.counts.removed).toBe(0);
  expect(restore.changes.some((value) => value.name === 'local-only')).toBe(false);
  expect(restore.import.conflicts).toEqual([]);
  await restoreBackup(data.store, restore.id, data.factory);
  expect(data.store.entry(saved.id)).toBeDefined();
  expect(data.store.get<{ content: string }>('rule', 'test-rule')?.content).toBe('Authored later');
  const definitions = await prepareBackupRestore(
    data.store,
    data.destination.id,
    review.manifestDigest,
    'definitions',
    data.factory,
  );
  expect(definitions.counts.changed).toBe(1);
  await restoreBackup(data.store, definitions.id, data.factory);
  expect(data.store.get<{ content: string }>('rule', 'test-rule')?.content).toBe(
    'Original guidance',
  );
  expect(data.store.list('approval')).toHaveLength(0);
  expect(data.store.planSummaries()).toHaveLength(0);
  expect(exportLibrary(data.store).entries).toHaveLength(2);
  const stale = await prepareBackupRestore(
    data.store,
    data.destination.id,
    review.manifestDigest,
    'missing',
    data.factory,
  );
  sampleSkill(data.store, 'later');
  await expect(restoreBackup(data.store, stale.id, data.factory)).rejects.toThrow(
    'changed after restore review',
  );
});
