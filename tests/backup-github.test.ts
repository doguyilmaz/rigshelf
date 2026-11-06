import { afterEach, expect, test } from 'bun:test';
import {
  closeBackupPullRequest,
  mergeBackup,
  prepareBackupMerge,
  refreshBackupOperation,
} from '../src/core/backup-actions';
import { GithubBackupSchema } from '../src/core/backup-destinations';
import { githubBackupTransport } from '../src/core/backup-github';
import { backupJobs, closeBackupJobs } from '../src/core/backup-jobs';
import { prepareRemoteBackup, saveBackupDestination } from '../src/core/backup-manager';
import { backupHistory } from '../src/core/backup-restore';
import { MemoryGithub } from './fixtures/backup-github';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function context() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  const remote = new MemoryGithub();
  const destination = GithubBackupSchema.parse({
    id: 'github-test',
    name: 'GitHub test',
    kind: 'github',
    owner: 'example',
    repository: 'private-library',
  });
  saveBackupDestination(data.store, destination);
  const factory = () =>
    githubBackupTransport(
      destination,
      { RIGSHELF_BACKUP_GITHUB_TOKEN: 'fixture-token' },
      remote.fetch,
    );
  const jobs = backupJobs(data.store, factory);
  cleanups.push(() => closeBackupJobs(data.store));
  sampleSkill(data.store, 'first');
  return { ...data, remote, destination, factory, jobs };
}
test('GitHub publishes one batch commit and one PR, preserves unrelated paths, then verifies explicit merge', async () => {
  const data = await context();
  const base = data.remote.refs.get('main');
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(review.id);
  const pending = await data.jobs.wait(review.id);
  expect(pending.state).toBe('awaiting-merge');
  expect(data.remote.refs.get('main')).toBe(base);
  expect(
    data.remote.requests.filter((value) => value.method === 'POST' && value.path === 'git/commits'),
  ).toHaveLength(1);
  expect(
    data.remote.requests.filter((value) => value.method === 'POST' && value.path === 'pulls'),
  ).toHaveLength(1);
  const tree = data.remote.requests.find(
    (value) => value.method === 'POST' && value.path === 'git/trees',
  )?.body;
  expect(tree).toMatchObject({
    base_tree: review.remote.tree,
    tree: expect.arrayContaining([expect.objectContaining({ path: 'rigshelf/current.json' })]),
  });
  expect(data.remote.file('README.md', pending.branch)).toEqual(
    Buffer.from('Keep unrelated files'),
  );
  const merge = await prepareBackupMerge(data.store, pending.id, data.factory);
  const done = await mergeBackup(data.store, merge.id, data.factory);
  expect(done.state).toBe('published');
  expect(data.remote.file('README.md')).toEqual(Buffer.from('Keep unrelated files'));
  expect(
    (await backupHistory(data.store, data.destination.id, {}, data.factory)).snapshots[0]?.digest,
  ).toBe(review.manifestDigest);
});
test('lost PR responses reuse deterministic operation branches and PRs; edited heads and protection block app merge', async () => {
  const data = await context();
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.remote.loseNextPrResponse = true;
  data.jobs.start(review.id);
  expect((await data.jobs.wait(review.id)).state).toBe('uncertain');
  data.jobs.retry(review.id, true);
  expect((await data.jobs.wait(review.id)).state).toBe('awaiting-merge');
  expect(data.remote.pulls).toHaveLength(1);
  expect(
    data.remote.requests.filter((value) => value.method === 'POST' && value.path === 'git/commits'),
  ).toHaveLength(1);
  data.remote.protectedBranch = true;
  const merge = await prepareBackupMerge(data.store, review.id, data.factory);
  expect((await mergeBackup(data.store, merge.id, data.factory)).state).toBe('awaiting-merge');
  expect(data.remote.pulls[0]?.merged).toBe(false);
  data.remote.pulls[0]!.head.sha = 'f'.repeat(40);
  const edited = await refreshBackupOperation(data.store, review.id, data.factory);
  expect(edited.error).toContain('edited outside');
  await expect(prepareBackupMerge(data.store, review.id, data.factory)).rejects.toThrow(
    'unchanged open PR',
  );
  data.remote.pulls[0]!.state = 'closed';
  const resolved = await refreshBackupOperation(data.store, review.id, data.factory);
  expect(resolved.state).toBe('conflict');
  expect(resolved.error).toContain('not confirmed');
  const fresh = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(fresh.id);
  expect((await data.jobs.wait(fresh.id)).state).toBe('awaiting-merge');
});
test('GitHub refuses public repositories and occupied prefixes; changed remote heads require renewed review', async () => {
  const data = await context();
  data.remote.privateRepository = false;
  await expect(prepareRemoteBackup(data.store, data.destination.id, data.factory)).rejects.toThrow(
    'private repository',
  );
  data.remote.privateRepository = true;
  data.remote.changeFile('rigshelf', 'existing authored file');
  await expect(prepareRemoteBackup(data.store, data.destination.id, data.factory)).rejects.toThrow(
    'prefix crosses',
  );
  const clean = await context();
  const review = await prepareRemoteBackup(clean.store, clean.destination.id, clean.factory);
  clean.remote.changeFile('unrelated.md', 'new authored file');
  clean.jobs.start(review.id);
  expect((await clean.jobs.wait(review.id)).state).toBe('conflict');
  expect(clean.remote.pulls).toHaveLength(0);
  expect(clean.remote.file('unrelated.md')).toEqual(Buffer.from('new authored file'));
});
test('closing a backup PR keeps remote branches and does not mark it as a completed backup', async () => {
  const data = await context();
  const review = await prepareRemoteBackup(data.store, data.destination.id, data.factory);
  data.jobs.start(review.id);
  await data.jobs.wait(review.id);
  const result = await closeBackupPullRequest(data.store, review.id, data.factory);
  expect(result.state).toBe('cancelled');
  expect(data.remote.refs.has(result.branch!)).toBe(true);
  expect(data.remote.file('rigshelf/current.json')).toBeUndefined();
});
