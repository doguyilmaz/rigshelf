import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  createBackupArtifact,
  readBackupManifest,
  readBackupPointer,
  verifiedBackupBundle,
} from '../src/core/backup-artifacts';
import {
  BackupDestinationSchema,
  destinationFingerprint,
  destinationIdentity,
  S3BackupSchema,
} from '../src/core/backup-destinations';
import { backupResponse } from '../src/core/backup-network';
import { canonicalBackup, reviewBackup } from '../src/core/backup-review';
import { s3BackupTransport } from '../src/core/backup-s3';
import { readStagedBackup, stageBackup } from '../src/core/backup-staging';
import { hash } from '../src/core/safety';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function fakeFetch(
  handler: (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: fetch.preconnect });
}

test('backup artifacts retain exact resources and verify both index and archive integrity without adopting authority', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  sampleSkill(data.store, 'backup-fixture');
  const input = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fingerprint: reviewBackup(data.store).fingerprint,
    previous: null,
  };
  const artifact = createBackupArtifact(data.store, input);
  expect(createBackupArtifact(data.store, input).archive).toEqual(artifact.archive);
  const manifest = readBackupManifest(artifact.manifestBytes, artifact.pointer.manifestDigest);
  const restored = verifiedBackupBundle(data.store, artifact.archive, manifest);
  expect(restored.entries).toHaveLength(1);
  expect(data.store.list('approval')).toHaveLength(0);
  expect(data.store.planSummaries()).toHaveLength(0);
  expect(() => readBackupManifest(new Uint8Array([1, 2]), artifact.pointer.manifestDigest)).toThrow(
    'integrity',
  );
  expect(() => verifiedBackupBundle(data.store, new Uint8Array([1, 2]), manifest)).toThrow(
    'integrity',
  );
  sampleSkill(data.store, 'new-after-review');
  expect(() => createBackupArtifact(data.store, input)).toThrow('changed after review');
});

test('destination identities prevent aliases from bypassing exclusion while configuration changes invalidate reviews', () => {
  const original = BackupDestinationSchema.parse({
    id: 'private-backup',
    name: 'Private backup',
    kind: 'github',
    owner: 'Example',
    repository: 'Library',
    branch: 'main',
  });
  const alias = BackupDestinationSchema.parse({
    ...original,
    id: 'another-profile',
    name: 'Other label',
    owner: 'example',
    repository: 'library',
    tokenEnv: 'RIGSHELF_BACKUP_ALTERNATE',
  });
  expect(destinationIdentity(original)).toBe(destinationIdentity(alias));
  expect(destinationFingerprint(original)).not.toBe(destinationFingerprint(alias));
  expect(destinationFingerprint({ ...original, name: 'Renamed' })).toBe(
    destinationFingerprint(original),
  );
  for (const prefix of ['../private', 'folder//nested', '/absolute', 'one/../two'])
    expect(() => BackupDestinationSchema.parse({ ...original, prefix })).toThrow();
  expect(() =>
    BackupDestinationSchema.parse({ ...original, token: 'must-never-be-saved' }),
  ).toThrow();
});
test('remote format errors do not echo response excerpts or malformed private content', async () => {
  const privateText = 'private-fixture-value-that-must-not-be-echoed';
  const bytes = Buffer.from(privateText);
  for (const parse of [
    () => readBackupPointer(bytes),
    () => readBackupManifest(bytes, hash(bytes)),
  ]) {
    try {
      parse();
      throw new Error('Expected malformed format rejection');
    } catch (failure) {
      expect(String(failure)).toContain('format');
      expect(String(failure)).not.toContain(privateText);
    }
  }
  const data = await fixture();
  cleanups.push(data.cleanup);
  sampleSkill(data.store, 'private-error');
  const artifact = createBackupArtifact(data.store, {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fingerprint: reviewBackup(data.store).fingerprint,
    previous: null,
  });
  const raw = JSON.parse(gunzipSync(artifact.archive).toString());
  raw.entries[0].entry.kind = 'mcp';
  raw.entries[0].entry.body = privateText;
  raw.entries[0].entry.digest = hash(privateText);
  const corrupted = gzipSync(JSON.stringify(raw));
  try {
    verifiedBackupBundle(data.store, corrupted, {
      ...artifact.manifest,
      archiveDigest: hash(corrupted),
      archiveBytes: corrupted.length,
    });
    throw new Error('Expected malformed private content rejection');
  } catch (failure) {
    expect(String(failure)).toContain('portable format validation');
    expect(String(failure)).not.toContain(privateText);
  }
});
test('retry refuses a changed staged pointer before it can corrupt remote publication', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  sampleSkill(data.store, 'staged-guide');
  const id = crypto.randomUUID();
  const artifact = createBackupArtifact(data.store, {
    id,
    createdAt: new Date().toISOString(),
    fingerprint: reviewBackup(data.store).fingerprint,
    previous: null,
  });
  await stageBackup(data.store, id, artifact);
  expect(
    (
      await readStagedBackup(
        data.store,
        id,
        artifact.pointer.manifestDigest,
        artifact.manifest.archiveDigest,
      )
    ).pointer,
  ).toEqual(artifact.pointer);
  await Bun.write(
    join(data.store.directory, 'backup-staging', id, 'pointer.json'),
    canonicalBackup({ ...artifact.pointer, fingerprint: 'f'.repeat(64) }),
  );
  await expect(
    readStagedBackup(
      data.store,
      id,
      artifact.pointer.manifestDigest,
      artifact.manifest.archiveDigest,
    ),
  ).rejects.toThrow('integrity');
});

test('native S3 signing uses only selected credentials and never forwards ambient session tokens', async () => {
  const previous = process.env.AWS_SESSION_TOKEN;
  process.env.AWS_SESSION_TOKEN = 'dummy-unselected-session';
  try {
    const destination = S3BackupSchema.parse({
      id: 's3-test',
      name: 'S3 test',
      kind: 's3',
      service: 'minio',
      endpoint: 'http://127.0.0.1:49000',
      bucket: 'private-fixture',
      region: 'us-east-1',
      privateBucketConfirmed: true,
    });
    const transport = s3BackupTransport(
      destination,
      {
        RIGSHELF_BACKUP_S3_ACCESS_KEY_ID: 'SELECTED_FIXTURE',
        RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY: 'dummy-selected-secret',
      },
      fakeFetch(async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe(destination.endpoint);
        expect(url.pathname).toBe('/private-fixture/rigshelf/current.json');
        expect(url.searchParams.get('X-Amz-Credential')).toStartWith('SELECTED_FIXTURE/');
        expect(url.searchParams.has('X-Amz-Security-Token')).toBe(false);
        expect(init?.redirect).toBe('error');
        return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      }),
    );
    expect(await transport.readCurrent()).toEqual({
      revision: null,
      pointer: null,
      manifest: null,
    });
  } finally {
    if (previous === undefined) delete process.env.AWS_SESSION_TOKEN;
    else process.env.AWS_SESSION_TOKEN = previous;
  }
});

test('remote transport bounds response bodies and treats interrupted writes as uncertain without exposing signed URLs', async () => {
  await expect(
    backupResponse(
      'https://example.invalid/object?credential=fixture',
      {},
      2,
      undefined,
      fakeFetch(async () => new Response('oversized')),
    ),
  ).rejects.toThrow('size limit');
  try {
    await backupResponse(
      'https://example.invalid/object?credential=fixture',
      { method: 'PUT' },
      10,
      undefined,
      fakeFetch(async () => {
        throw new Error('https://example.invalid/?secret=do-not-return');
      }),
    );
    throw new Error('Expected an uncertain write');
  } catch (failure) {
    expect(failure).toMatchObject({ uncertain: true });
    expect(String(failure)).not.toContain('secret=');
    expect(String(failure)).not.toContain('credential=');
  }
});
