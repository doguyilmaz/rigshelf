import { expect, test } from 'bun:test';
import { randomInt } from 'node:crypto';
import { join, resolve } from 'node:path';
import { exportLibrary } from '../src/core/backup';
import { S3BackupSchema } from '../src/core/backup-destinations';
import { backupJobs } from '../src/core/backup-jobs';
import { prepareRemoteBackup, saveBackupDestination } from '../src/core/backup-manager';
import { s3BackupTransport } from '../src/core/backup-s3';
import { startServer } from '../src/server';
import { MemoryS3 } from './fixtures/backup-s3';
import { fixture, sampleSkill } from './helpers';

test('private HTTP backup routes reject unauthorized requests and drain a cancelled Sync before shutdown', async () => {
  const data = await fixture();
  sampleSkill(data.store, 'http-backup');
  const destination = S3BackupSchema.parse({
    id: 'http-backup',
    name: 'HTTP backup',
    kind: 's3',
    endpoint: 'http://127.0.0.1:49000',
    bucket: 'private-fixture',
    privateBucketConfirmed: true,
  });
  saveBackupDestination(data.store, destination);
  const remote = new MemoryS3();
  const environment = {
    RIGSHELF_BACKUP_S3_ACCESS_KEY_ID: 'fixture-key',
    RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  const baseFactory = () => s3BackupTransport(destination, environment, remote.fetch);
  const review = await prepareRemoteBackup(data.store, destination.id, baseFactory);
  let entered: () => void = () => undefined;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const factory = () => ({
    ...baseFactory(),
    readCurrent: async (signal?: AbortSignal) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      throw new Error('Fixture read was cancelled');
    },
  });
  const port = randomInt(48000, 59000);
  const server = startServer(data.store, port, { backupTransport: factory });
  const base = `http://127.0.0.1:${port}`;
  const token = new URLSearchParams(new URL(server.accessUrl).hash.slice(1)).get('access')!;
  const headers = { 'x-rigshelf-token': token, 'content-type': 'application/json' };
  try {
    const unauthorized = await fetch(`${base}/api/backup-reviews/${review.id}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauthorized.status).toBe(403);
    const foreign = await fetch(`${base}/api/backup-reviews/${review.id}/sync`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://untrusted.invalid' },
      body: '{}',
    });
    expect(foreign.status).toBe(403);
    expect(data.store.list('backup-operation')).toHaveLength(0);
    const response = await fetch(`${base}/api/backup-reviews/${review.id}/sync`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(response.ok).toBe(true);
    const operation = await response.json();
    expect(operation).not.toHaveProperty('ownerPid');
    expect(operation).not.toHaveProperty('ownerSession');
    await began;
    const listing = await (await fetch(`${base}/api/backup-destinations`, { headers })).text();
    expect(listing).not.toContain('fixture-secret');
    expect(listing).not.toContain('ownerPid');
    expect(JSON.stringify(exportLibrary(data.store))).not.toContain(destination.endpoint);
    data.store.put('backup-destination', { ...destination, name: 'Newer private fixture label' });
    const stale = await fetch(`${base}/api/backup-destinations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        value: { ...destination, name: 'Stale label' },
        expected: destination,
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.text()).not.toContain('Newer private fixture label');
    await server.stop(true);
    expect(backupJobs(data.store, factory).get(review.id).state).toBe('cancelled');
    expect(remote.objects.size).toBe(0);
  } finally {
    await server.stop(true);
    await data.cleanup();
  }
});
test('CLI saves checked destination files, lists without networking and rejects stale edits without losing authored configuration', async () => {
  const data = await fixture();
  const file = join(data.root, 'destination.json');
  const destination = {
    id: 'cli-backup',
    name: 'CLI backup',
    kind: 'github',
    owner: 'example',
    repository: 'private-library',
  };
  const invoke = async (args: string[]) => {
    const process = Bun.spawn([Bun.which('bun')!, resolve('src/cli.ts'), 'backup', ...args], {
      env: { PATH: Bun.env.PATH || '', RIGSHELF_DATA_DIR: data.store.directory },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { stdout, stderr, code };
  };
  try {
    await Bun.write(file, JSON.stringify(destination));
    const saved = await invoke(['save', file]);
    expect(saved.code).toBe(0);
    const definition = JSON.parse(saved.stdout);
    const expected = join(data.root, 'expected.json');
    await Bun.write(expected, JSON.stringify(definition));
    const listing = await invoke(['list']);
    expect(listing.code).toBe(0);
    expect(listing.stdout).toContain('RIGSHELF_BACKUP_GITHUB_TOKEN');
    expect(listing.stdout).toContain('CLI backup');
    data.store.put('backup-destination', { ...definition, name: 'Authored later' });
    await Bun.write(file, JSON.stringify({ ...definition, name: 'Stale edit' }));
    const stale = await invoke(['save', file, '--expect', expected]);
    expect(stale.code).toBe(1);
    expect(data.store.get<{ name: string }>('backup-destination', definition.id)?.name).toBe(
      'Authored later',
    );
    expect(stale.stderr).not.toContain('Authored later');
    const missing = await invoke(['review', definition.id]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Set RIGSHELF_BACKUP_GITHUB_TOKEN');
    expect(data.store.list('backup-operation')).toHaveLength(0);
  } finally {
    await data.cleanup();
  }
});
