import { readBounded } from './bounded-read';
import { publicArchive, publicHead, type RepositoryFile as TreeFile } from './github-archive';
import { saveSkill, sensitiveResource } from './ingest';
import type { Entry, Finding, PackedFile, Source } from './model';
import { MAX_BUNDLE_BYTES, MAX_FILES } from './model';
import { now, safeRelative, scanText } from './safety';
import type { Store } from './store';

const allowedResourceHosts = new Set([
  'github.com',
  'gist.github.com',
  'skills.sh',
  'glama.ai',
  'ui-skills.com',
  'docs.slack.dev',
  'codewithbeto.dev',
  'www.aihero.dev',
  'expo.dev',
  'blog.margelo.com',
  'firebase.blog',
  'www.callstack.com',
  'x.com',
]);

export function githubRepository(source: Source): string {
  const match = source.url.match(/^https:\/\/(?:github\.com|skills\.sh)\/([\w.-]+\/[^/?#]+)/);
  if (
    !match ||
    !/^[\w.-]+\/[\w.-]+$/.test(match[1]) ||
    match[1].split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('This source is not a supported public GitHub repository.');
  return match[1].replace(/\.git$/, '');
}
async function boundedFetch(
  url: string,
  limit = 4 * 1024 * 1024,
  accept = 'application/vnd.github+json',
): Promise<Uint8Array> {
  const authorization: Record<string, string> =
    new URL(url).hostname === 'api.github.com' && process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Rigshelf-Workbench/0.1', Accept: accept, ...authorization },
    redirect: 'error',
    signal: AbortSignal.timeout(new URL(url).hostname === 'api.github.com' ? 5000 : 15000),
  });
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > limit)
    throw new Error('Upstream response is too large.');
  if (!response.body) throw new Error('Empty upstream response');
  return readBounded(
    response.body,
    limit,
    () => new Error('Upstream response exceeds size limit.'),
  );
}
let apiUnavailableUntil = 0;
async function githubJson<T>(url: string): Promise<T> {
  if (Date.now() < apiUnavailableUntil) throw new Error('GitHub API is temporarily unavailable.');
  try {
    return JSON.parse(new TextDecoder().decode(await boundedFetch(url))) as T;
  } catch (error) {
    if (
      error instanceof Error &&
      /timeout|timed out|fetch|TLS|HTTP 40[139]|HTTP 429/i.test(error.message)
    )
      apiUnavailableUntil = Date.now() + 5 * 60000;
    throw error;
  }
}
async function repositoryMetadata(repo: string): Promise<NonNullable<Source['repository']>> {
  const metadata = await githubJson<{
    owner: { login: string };
    license?: { spdx_id?: string } | null;
    archived: boolean;
    description?: string | null;
  }>(`https://api.github.com/repos/${repo}`);
  if (typeof metadata.owner?.login !== 'string' || typeof metadata.archived !== 'boolean')
    throw new Error('Invalid repository metadata');
  return {
    owner: metadata.owner.login.slice(0, 100),
    url: `https://github.com/${repo}`,
    license: metadata.license?.spdx_id?.slice(0, 100),
    archived: metadata.archived,
    description: metadata.description?.slice(0, 2000) || undefined,
    checkedAt: now(),
  };
}

function currentSource(store: Store, expected: Source): Source {
  const current = store.get<Source>('source', expected.id);
  if (!current || current.url !== expected.url || current.type !== expected.type)
    throw new Error('Source changed during the request. Check it again.');
  return current;
}

function recordEvidence(
  store: Store,
  expected: Source,
  startedAt: string,
  evidence: Pick<Source, 'status'> & Partial<Pick<Source, 'latestRef' | 'repository'>>,
  error?: string,
): Source {
  return store.db
    .transaction(() => {
      const current = currentSource(store, expected);
      if (current.checkedAt && current.checkedAt > startedAt) return current;
      const notes = current.notes.replace(/\nLast check:[^\n]*/g, '');
      const updated = {
        ...current,
        ...evidence,
        checkedAt: now(),
        notes: error ? `${notes}\nLast check: ${error}` : notes,
      };
      store.put('source', updated);
      return updated;
    })
    .immediate();
}

export async function checkSource(store: Store, id: string): Promise<Source> {
  const source = store.get<Source>('source', id);
  if (!source) throw new Error('Source not found');
  if (!source.url) throw new Error('This local/manual source has no remote URL to check.');
  const startedAt = now();
  const evidence: Parameters<typeof recordEvidence>[3] = { status: 'reachable' };
  let failure: string | undefined;
  try {
    if (source.type === 'github') {
      const repo = githubRepository(source);
      try {
        const commit = await githubJson<{ sha: string }>(
          `https://api.github.com/repos/${repo}/commits/HEAD`,
        );
        if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid upstream commit');
        evidence.latestRef = commit.sha;
      } catch {
        evidence.latestRef = await publicHead(repo);
      }
      try {
        evidence.repository = await repositoryMetadata(repo);
      } catch {
        /* Reachability does not depend on optional API metadata. */
      }
    } else {
      const url = new URL(source.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !allowedResourceHosts.has(url.hostname)
      )
        throw new Error('Host is outside the explicit source-check allowlist. Open it manually.');
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    evidence.status = 'unavailable';
    failure = error instanceof Error ? error.message : 'Failed';
  }
  const updated = recordEvidence(store, source, startedAt, evidence, failure);
  store.event('source.checked', `${updated.name}: ${updated.status}`);
  return updated;
}

export async function sourceTree(
  store: Store,
  id: string,
): Promise<{
  repo: string;
  ref: string;
  files: TreeFile[];
  transport: 'api' | 'archive';
  source: Source;
}> {
  const source = store.get<Source>('source', id);
  if (!source) throw new Error('Source not found');
  const startedAt = now();
  const repo = githubRepository(source);
  let ref: string;
  let files: TreeFile[];
  let transport: 'api' | 'archive' = 'api';
  try {
    const head = await githubJson<{ sha: string }>(
      `https://api.github.com/repos/${repo}/commits/HEAD`,
    );
    if (!/^[a-f0-9]{40}$/.test(head.sha)) throw new Error('Invalid upstream commit');
    const tree = await githubJson<{ tree: TreeFile[]; truncated: boolean }>(
      `https://api.github.com/repos/${repo}/git/trees/${head.sha}?recursive=1`,
    );
    if (tree.truncated) throw new Error('Repository tree is too large. Add a narrower source.');
    ref = head.sha;
    files = tree.tree;
  } catch (error) {
    if (
      error instanceof Error &&
      /too large|Invalid upstream commit|response.*size|too large/i.test(error.message)
    )
      throw error;
    ref = await publicHead(repo);
    files = await publicArchive(repo, ref);
    transport = 'archive';
  }
  recordEvidence(store, source, startedAt, { latestRef: ref, status: 'reachable' });
  return { repo, ref, files, transport, source };
}

export async function discoverSourceSkills(
  store: Store,
  id: string,
): Promise<{ path: string; name: string }[]> {
  const tree = await sourceTree(store, id);
  const skills = tree.files
    .filter(
      (file) =>
        file.type === 'blob' && /(?:^|\/)SKILL\.md$/.test(file.path) && file.mode !== '120000',
    )
    .map((file) => ({
      path: file.path,
      name: file.path.split('/').at(-2) || tree.repo.split('/')[1],
    }));
  let repository: Source['repository'];
  if (tree.transport === 'api') {
    try {
      repository = await repositoryMetadata(tree.repo);
    } catch {
      /* Optional metadata; pinning and import remain available. */
    }
  }
  store.db
    .transaction(() => {
      const source = currentSource(store, tree.source);
      // A newer check may have observed a different revision while this tree was loading.
      if (source.latestRef !== tree.ref)
        throw new Error('Source revision changed. Check it again.');
      if (repository) source.repository = repository;
      source.skillCount = skills.length;
      source.categories = [
        ...new Set([...(source.categories || []), ...(skills.length ? ['skills'] : [])]),
      ];
      if (skills.length && !source.recipe) {
        source.recipe = `bunx skills add ${tree.repo}`;
        source.recipeKind = 'suggested';
      }
      if (!skills.length && source.recipeKind === 'suggested') source.recipe = '';
      store.put('source', source);
      store.put('source-index', { id, ref: tree.ref, skills, checkedAt: now() });
    })
    .immediate();
  return skills;
}

export async function importUpstreamSkill(
  store: Store,
  sourceId: string,
  path: string,
): Promise<Entry> {
  safeRelative(path);
  if (path.split('/').at(-1) !== 'SKILL.md')
    throw new Error('Select a SKILL.md from the source list.');
  const tree = await sourceTree(store, sourceId);
  return importSkillFromTree(store, tree, path);
}

/** Reuse one immutable, bounded source tree when checking several existing Skills. */
export async function importSkillFromTree(
  store: Store,
  tree: Awaited<ReturnType<typeof sourceTree>>,
  path: string,
): Promise<Entry> {
  safeRelative(path);
  if (path.split('/').at(-1) !== 'SKILL.md')
    throw new Error('Select a SKILL.md from the source list.');
  currentSource(store, tree.source);
  const root = path.slice(0, -'SKILL.md'.length);
  const candidates = tree.files.filter(
    (file) => file.type === 'blob' && file.path.startsWith(root),
  );
  if (!candidates.some((file) => file.path === path))
    throw new Error('Selected skill does not exist in the repository.');
  if (
    candidates.length > MAX_FILES ||
    candidates.reduce((sum, file) => sum + (file.size || 0), 0) > MAX_BUNDLE_BYTES
  )
    throw new Error('Skill exceeds snapshot limits.');
  const files: PackedFile[] = [];
  const findings: Finding[] = [];
  let total = 0;
  async function download(candidate: TreeFile): Promise<void> {
    if (candidate.mode === '120000') {
      findings.push({
        code: 'symlink',
        level: 'review',
        message: 'Upstream symlink excluded.',
        file: candidate.path,
      });
      return;
    }
    const localPath = safeRelative(candidate.path.slice(root.length));
    if (sensitiveResource(localPath)) {
      findings.push({
        code: 'sensitive-resource',
        level: 'review',
        message: 'Sensitive-looking upstream file excluded. Supply credentials separately.',
        file: localPath,
      });
      return;
    }
    const encodedPath = candidate.path.split('/').map(encodeURIComponent).join('/');
    let bytes: Uint8Array;
    try {
      bytes =
        candidate.data ??
        (await boundedFetch(
          `https://raw.githubusercontent.com/${tree.repo}/${tree.ref}/${encodedPath}`,
          MAX_BUNDLE_BYTES,
        ));
    } catch (error) {
      if (
        !process.env.GITHUB_TOKEN ||
        !(error instanceof Error) ||
        !error.message.includes('HTTP 404')
      )
        throw error;
      bytes = await boundedFetch(
        `https://api.github.com/repos/${tree.repo}/contents/${encodedPath}?ref=${tree.ref}`,
        MAX_BUNDLE_BYTES,
        'application/vnd.github.raw+json',
      );
    }
    total += bytes.length;
    if (total > MAX_BUNDLE_BYTES) throw new Error('Snapshot exceeds total size limit');
    const text = new TextDecoder().decode(bytes);
    findings.push(...scanText(text, localPath));
    files.push({
      path: localPath,
      content: Buffer.from(bytes).toString('base64'),
      executable: candidate.mode === '100755',
    });
  }
  // Bound simultaneous requests; credentials are only attached to api.github.com.
  for (let offset = 0; offset < candidates.length; offset += 6) {
    const results = await Promise.allSettled(candidates.slice(offset, offset + 6).map(download));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  const skillFile = files.find((file) => file.path === 'SKILL.md');
  if (!skillFile) throw new Error('Missing skill snapshot');
  const entry = store.db
    .transaction(() =>
      saveSkill(
        store,
        Buffer.from(skillFile.content, 'base64').toString('utf8'),
        files,
        currentSource(store, tree.source),
        { upstreamPath: root.replace(/\/$/, ''), upstreamRef: tree.ref, findings },
      ),
    )
    .immediate();
  store.event('source.imported', `Snapshot imported: ${entry.name} @ ${tree.ref.slice(0, 8)}`);
  return entry;
}
