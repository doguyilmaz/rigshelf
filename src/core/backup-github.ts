import { z } from 'zod';
import {
  archiveKey,
  type BackupArtifact,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_POINTER_BYTES,
  MAX_GITHUB_BACKUP_BYTES,
  manifestKey,
  readBackupManifest,
  readBackupPointer,
} from './backup-artifacts';
import { backupCredential, type GithubBackupDestination } from './backup-destinations';
import { type BackupFetch, BackupRemoteError, backupResponse } from './backup-network';
import type {
  BackupPublication,
  BackupPublishContext,
  BackupPullRequest,
  BackupTransport,
  RemoteBackupState,
} from './backup-transport';
import { hash } from './safety';

const GitSha = z.string().regex(/^[a-f0-9]{40}$/);
const PullRequest = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  head: z.object({ sha: GitSha, ref: z.string(), repo: z.object({ full_name: z.string() }) }),
  base: z.object({ sha: GitSha, ref: z.string() }),
});
export function githubBackupTransport(
  destination: GithubBackupDestination,
  environment: Record<string, string | undefined> = process.env,
  fetcher: BackupFetch = fetch,
): BackupTransport {
  const token = backupCredential(destination.tokenEnv, environment);
  const repository = `${destination.owner}/${destination.repository}`;
  const root = `https://api.github.com/repos/${encodeURIComponent(destination.owner)}/${encodeURIComponent(destination.repository)}`;
  let readRef: string | undefined;
  let readTree: string | undefined;
  const trees = new Map<string, { path: string; type: string; mode: string; sha: string }[]>();
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
    limit = MAX_BACKUP_MANIFEST_BYTES,
    allowMissing = false,
  ): Promise<unknown> {
    const response = await backupResponse(
      `${root}${path ? `/${path}` : ''}`,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'Rigshelf-Workbench/0.1',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      limit,
      signal,
      fetcher,
    );
    if (allowMissing && response.status === 404) return null;
    if (response.status < 200 || response.status >= 300)
      throw new BackupRemoteError(
        `GitHub returned HTTP ${response.status}. Check repository access, branch protection and token permissions.`,
        response.status,
        response.status >= 500 && method !== 'GET',
      );
    if (!response.bytes.length) return null;
    try {
      return JSON.parse(new TextDecoder().decode(response.bytes)) as unknown;
    } catch {
      throw new BackupRemoteError('GitHub returned an invalid response.');
    }
  }
  async function readRepository(signal?: AbortSignal) {
    // A trailing empty path deliberately remains on this exact repository endpoint.
    const raw = await request('', 'GET', undefined, signal);
    const repo = z
      .object({
        id: z.number().int().positive(),
        full_name: z.string(),
        private: z.boolean(),
        archived: z.boolean().optional(),
      })
      .parse(raw);
    if (repo.full_name.toLowerCase() !== repository.toLowerCase() || !repo.private)
      throw new BackupRemoteError(
        'GitHub backups require this exact existing private repository. Public or redirected repositories are refused.',
      );
    return repo;
  }
  function decode(content: string, maximum: number): Uint8Array {
    const compact = content.replace(/\s/g, '');
    const bytes = Buffer.from(compact, 'base64');
    if (bytes.length > maximum || bytes.toString('base64') !== compact)
      throw new BackupRemoteError('GitHub backup file exceeds its bound or has invalid encoding.');
    return bytes;
  }
  async function readFile(
    path: string,
    maximum: number,
    signal?: AbortSignal,
    allowMissing = false,
  ): Promise<Uint8Array | null> {
    if (!readRef || !readTree)
      throw new BackupRemoteError('Read the destination state before requesting backup files.');
    let tree = readTree;
    let file: { sha: string } | undefined;
    const components = path.split('/');
    for (let index = 0; index < components.length; index++) {
      const entry = (await readTreeEntries(tree, signal)).find(
        (value) => value.path === components[index],
      );
      if (!entry) {
        if (allowMissing) return null;
        throw new BackupRemoteError('The selected backup file is missing from GitHub.', 404);
      }
      if (index === components.length - 1) {
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
          throw new BackupRemoteError(
            'The backup path is a link, submodule or directory. Nothing was overwritten.',
          );
        file = entry;
      } else {
        if (entry.type !== 'tree' || entry.mode !== '040000')
          throw new BackupRemoteError(
            'The backup path crosses a file, link or submodule. Nothing was overwritten.',
          );
        tree = entry.sha;
      }
    }
    if (!file) throw new BackupRemoteError('The selected backup file is unavailable.');
    const blob = z
      .object({
        encoding: z.literal('base64'),
        content: z.string(),
        size: z.number().int().min(0).max(maximum),
      })
      .parse(
        await request(
          `git/blobs/${file.sha}`,
          'GET',
          undefined,
          signal,
          Math.ceil(maximum / 3) * 4 + 32768,
        ),
      );
    return decode(blob.content, maximum);
  }
  async function readCurrent(signal?: AbortSignal): Promise<RemoteBackupState> {
    const repo = await readRepository(signal);
    const reference = z
      .object({ object: z.object({ sha: GitSha }) })
      .parse(
        await request(
          `git/ref/heads/${encodeURIComponent(destination.branch)}`,
          'GET',
          undefined,
          signal,
        ),
      );
    readRef = reference.object.sha;
    const commit = z
      .object({ tree: z.object({ sha: GitSha }) })
      .parse(await request(`git/commits/${readRef}`, 'GET', undefined, signal));
    readTree = commit.tree.sha;
    await checkPrefix(commit.tree.sha, signal);
    const bytes = await readFile(
      `${destination.prefix}/current.json`,
      MAX_BACKUP_POINTER_BYTES,
      signal,
      true,
    );
    if (!bytes)
      return {
        revision: readRef,
        pointer: null,
        manifest: null,
        tree: commit.tree.sha,
        repositoryId: repo.id,
      };
    const pointer = readBackupPointer(bytes);
    const manifest = await readManifest(pointer.manifestDigest, signal);
    if (
      pointer.archiveDigest !== manifest.archiveDigest ||
      pointer.fingerprint !== manifest.fingerprint ||
      pointer.operationId !== manifest.operationId ||
      pointer.createdAt !== manifest.createdAt
    )
      throw new BackupRemoteError('The GitHub backup pointer does not match its manifest.');
    return { revision: readRef, pointer, manifest, tree: commit.tree.sha, repositoryId: repo.id };
  }
  async function checkPrefix(rootTree: string, signal?: AbortSignal): Promise<void> {
    let tree = rootTree;
    for (const component of destination.prefix.split('/')) {
      const entry = (await readTreeEntries(tree, signal)).find((value) => value.path === component);
      if (!entry) return;
      if (entry.type !== 'tree' || entry.mode !== '040000')
        throw new BackupRemoteError(
          'The backup prefix crosses an existing file, link or submodule. Choose a dedicated directory.',
        );
      tree = entry.sha;
    }
  }
  async function readTreeEntries(sha: string, signal?: AbortSignal) {
    const cached = trees.get(sha);
    if (cached) return cached;
    const result = z
      .object({
        truncated: z.boolean().optional(),
        tree: z
          .array(z.object({ path: z.string(), type: z.string(), mode: z.string(), sha: GitSha }))
          .max(20000),
      })
      .parse(await request(`git/trees/${sha}`, 'GET', undefined, signal));
    if (result.truncated)
      throw new BackupRemoteError(
        'The repository directory is too large to verify this backup prefix.',
      );
    trees.set(sha, result.tree);
    return result.tree;
  }
  async function readManifest(digest: string, signal?: AbortSignal) {
    return readBackupManifest(
      (await readFile(manifestKey(destination.prefix, digest), MAX_BACKUP_MANIFEST_BYTES, signal))!,
      digest,
    );
  }
  function pull(value: unknown): BackupPullRequest {
    const parsed = PullRequest.parse(value);
    if (
      parsed.head.repo.full_name.toLowerCase() !== repository.toLowerCase() ||
      parsed.base.ref !== destination.branch
    )
      throw new BackupRemoteError('This pull request belongs to a different backup destination.');
    return {
      number: parsed.number,
      url: `https://github.com/${destination.owner}/${destination.repository}/pull/${parsed.number}`,
      head: parsed.head.sha,
      base: parsed.base.sha,
      state: parsed.state,
      merged: parsed.merged === true || !!parsed.merged_at,
    };
  }
  async function pullRequest(number: number, signal?: AbortSignal) {
    await readRepository(signal);
    return pull(await request(`pulls/${number}`, 'GET', undefined, signal));
  }
  async function findPull(
    branch: string,
    signal: AbortSignal,
  ): Promise<BackupPullRequest | undefined> {
    const rows = z
      .array(PullRequest)
      .max(10)
      .parse(
        await request(
          `pulls?state=all&head=${encodeURIComponent(`${destination.owner}:${branch}`)}&base=${encodeURIComponent(destination.branch)}&per_page=10`,
          'GET',
          undefined,
          signal,
        ),
      );
    return rows.length ? pull(rows[0]) : undefined;
  }
  async function blob(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
    return z
      .object({ sha: GitSha })
      .parse(
        await request(
          'git/blobs',
          'POST',
          { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' },
          signal,
        ),
      ).sha;
  }
  async function publish(
    artifact: BackupArtifact,
    expected: RemoteBackupState,
    context: BackupPublishContext,
  ): Promise<BackupPublication> {
    if ((await readRepository(context.signal)).archived)
      throw new BackupRemoteError(
        'This repository is archived. Existing backups can be restored, but Sync needs an active repository.',
      );
    if (artifact.archive.length > MAX_GITHUB_BACKUP_BYTES)
      throw new BackupRemoteError(
        'GitHub backup archives are limited to 32 MiB. Use an S3-compatible destination for a larger library.',
      );
    const branch = `rigshelf-backup/${context.id}`;
    context.checkpoint({ branch, phase: 'checking-github' });
    const current = await readCurrent(context.signal);
    if (context.previous?.commit) {
      const previous = await findPull(branch, context.signal);
      if (previous) {
        if (previous.head !== context.previous.commit)
          throw new BackupRemoteError(
            'The backup PR was changed outside Rigshelf. Review it on GitHub.',
            409,
          );
        if (previous.state === 'closed' && !previous.merged)
          throw new BackupRemoteError(
            'The backup PR was closed without merging. Prepare a new review.',
            409,
          );
        context.checkpoint({ pullRequest: previous });
        return {
          state: previous.merged ? 'published' : 'awaiting-merge',
          revision: previous.head,
          pullRequest: previous,
        };
      }
    }
    if (current.revision !== expected.revision || current.repositoryId !== expected.repositoryId)
      throw new BackupRemoteError(
        'The GitHub base branch changed after review. Prepare a new review.',
        409,
      );
    context.assertCurrent();
    let commit = context.previous?.commit;
    if (!commit) {
      for (const [path, bytes] of [
        [archiveKey(destination.prefix, artifact.manifest.archiveDigest), artifact.archive],
        [manifestKey(destination.prefix, artifact.pointer.manifestDigest), artifact.manifestBytes],
      ] as const) {
        const existing = await readFile(path, bytes.length, context.signal, true);
        if (existing && hash(existing) !== hash(bytes))
          throw new BackupRemoteError(
            'An immutable backup path already contains different bytes. Nothing was overwritten.',
            409,
          );
      }
      context.checkpoint({ phase: 'uploading-archive' });
      const archive = await blob(artifact.archive, context.signal);
      context.checkpoint({ phase: 'uploading-manifest' });
      const manifest = await blob(artifact.manifestBytes, context.signal);
      const pointer = await blob(artifact.pointerBytes, context.signal);
      const tree = z.object({ sha: GitSha }).parse(
        await request(
          'git/trees',
          'POST',
          {
            base_tree: expected.tree,
            tree: [
              {
                path: archiveKey(destination.prefix, artifact.manifest.archiveDigest),
                mode: '100644',
                type: 'blob',
                sha: archive,
              },
              {
                path: manifestKey(destination.prefix, artifact.pointer.manifestDigest),
                mode: '100644',
                type: 'blob',
                sha: manifest,
              },
              {
                path: `${destination.prefix}/current.json`,
                mode: '100644',
                type: 'blob',
                sha: pointer,
              },
            ],
          },
          context.signal,
        ),
      );
      context.assertCurrent();
      context.checkpoint({ phase: 'creating-commit' });
      commit = z.object({ sha: GitSha }).parse(
        await request(
          'git/commits',
          'POST',
          {
            message: 'backup: save Rigshelf library snapshot',
            tree: tree.sha,
            parents: [expected.revision],
          },
          context.signal,
        ),
      ).sha;
      context.checkpoint({ commit });
    }
    const existing = await request(
      `git/ref/heads/${encodeURIComponent(branch)}`,
      'GET',
      undefined,
      context.signal,
      32768,
      true,
    );
    if (existing) {
      if (z.object({ object: z.object({ sha: GitSha }) }).parse(existing).object.sha !== commit)
        throw new BackupRemoteError(
          'The operation branch was changed outside Rigshelf. No branch was overwritten.',
          409,
        );
    } else {
      context.assertCurrent();
      context.checkpoint({ phase: 'creating-branch' });
      try {
        await request(
          'git/refs',
          'POST',
          { ref: `refs/heads/${branch}`, sha: commit },
          context.signal,
        );
      } catch (failure) {
        if (!(failure instanceof BackupRemoteError) || failure.status !== 422) throw failure;
        const recovered = z
          .object({ object: z.object({ sha: GitSha }) })
          .parse(
            await request(
              `git/ref/heads/${encodeURIComponent(branch)}`,
              'GET',
              undefined,
              context.signal,
            ),
          );
        if (recovered.object.sha !== commit)
          throw new BackupRemoteError('The operation branch conflicts with another writer.', 409);
      }
    }
    const latest = await readCurrent(context.signal);
    if (latest.revision !== expected.revision)
      throw new BackupRemoteError(
        'The GitHub base branch changed before PR creation. Review again; no base files were changed.',
        409,
      );
    context.assertCurrent();
    context.checkpoint({ phase: 'creating-pr' });
    let opened = await findPull(branch, context.signal);
    if (!opened)
      try {
        opened = pull(
          await request(
            'pulls',
            'POST',
            {
              title: 'Back up Rigshelf library',
              head: branch,
              base: destination.branch,
              body: `Save one reviewed portable library Snapshot.\n\n- ${artifact.manifest.records.length} portable records\n- ${artifact.manifest.excluded.length} excluded records\n- Content fingerprint: \`${artifact.manifest.fingerprint}\`\n\nReview the readable manifest and merge separately. This backup does not include project files, credentials or automation permissions.\n\n<!-- rigshelf-backup:${context.id} -->`,
            },
            context.signal,
          ),
        );
      } catch (failure) {
        if (!(failure instanceof BackupRemoteError) || failure.status !== 422) throw failure;
        opened = await findPull(branch, context.signal);
        if (!opened)
          throw new BackupRemoteError(
            'GitHub did not confirm PR creation. Reconcile this operation before retrying.',
            undefined,
            true,
          );
      }
    if (opened.head !== commit)
      throw new BackupRemoteError('The backup PR head no longer matches its reviewed commit.', 409);
    if (opened.state === 'closed' && !opened.merged)
      throw new BackupRemoteError(
        'This backup PR was closed without merging. Prepare a new backup review.',
        409,
      );
    context.checkpoint({
      pullRequest: opened,
      phase: opened.merged ? 'verifying-publication' : 'awaiting-merge',
    });
    return {
      state: opened.merged ? 'published' : 'awaiting-merge',
      revision: commit,
      pullRequest: opened,
    };
  }
  async function checkedPull(expected: BackupPullRequest, signal?: AbortSignal) {
    const current = await pullRequest(expected.number, signal);
    if (
      current.head !== expected.head ||
      current.base !== expected.base ||
      current.state !== 'open'
    )
      throw new BackupRemoteError(
        'The PR changed after review. Refresh its status before continuing.',
        409,
      );
    return current;
  }
  return {
    readCurrent,
    readManifest,
    readArchive: async (digest, signal) =>
      (await readFile(archiveKey(destination.prefix, digest), MAX_GITHUB_BACKUP_BYTES, signal))!,
    probe: async (signal) => {
      await readCurrent(signal);
    },
    publish,
    pullRequest,
    operationPullRequest: async (id, signal) => {
      await readRepository(signal);
      return findPull(
        `rigshelf-backup/${z.string().uuid().parse(id)}`,
        signal || AbortSignal.timeout(60000),
      );
    },
    merge: async (expected, signal) => {
      await checkedPull(expected, signal);
      const merged = z.object({ merged: z.boolean() }).parse(
        await request(
          `pulls/${expected.number}/merge`,
          'PUT',
          {
            sha: expected.head,
            merge_method: 'merge',
            commit_title: 'backup: merge reviewed Rigshelf snapshot',
          },
          signal,
        ),
      );
      if (!merged.merged)
        throw new BackupRemoteError(
          'GitHub did not merge this backup PR. Review branch protection and merge conflicts.',
        );
    },
    closePullRequest: async (expected, signal) => {
      await checkedPull(expected, signal);
      await request(`pulls/${expected.number}`, 'PATCH', { state: 'closed' }, signal);
    },
  };
}
