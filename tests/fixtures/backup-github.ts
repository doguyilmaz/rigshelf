import { createHash } from 'node:crypto';
import type { BackupFetch } from '../../src/core/backup-network';

type Tree = Map<string, { sha: string; mode: string }>;
interface Pull {
  number: number;
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { sha: string; ref: string };
  state: 'open' | 'closed';
  merged: boolean;
}
const sha = (value: string | Uint8Array) => createHash('sha1').update(value).digest('hex');
/** In-memory Git object/PR protocol fixture. No GitHub requests are made. */
export class MemoryGithub {
  private blobs = new Map<string, Uint8Array>();
  private trees = new Map<string, Tree>();
  private commits = new Map<string, { tree: string; parents: string[] }>();
  refs = new Map<string, string>();
  pulls: Pull[] = [];
  requests: { method: string; path: string; body: unknown }[] = [];
  privateRepository = true;
  archived = false;
  protectedBranch = false;
  loseNextPrResponse = false;
  constructor() {
    const tree = this.tree(
      new Map([
        ['README.md', { sha: this.blob(Buffer.from('Keep unrelated files')), mode: '100644' }],
      ]),
    );
    this.refs.set('main', this.commit(tree, []));
  }
  private blob(bytes: Uint8Array) {
    const id = sha(bytes);
    this.blobs.set(id, bytes);
    return id;
  }
  private tree(files: Tree) {
    const id = sha(JSON.stringify([...files].sort()));
    this.trees.set(id, files);
    return id;
  }
  private commit(tree: string, parents: string[]) {
    const id = sha(JSON.stringify({ tree, parents }));
    this.commits.set(id, { tree, parents });
    return id;
  }
  file(path: string, branch = 'main') {
    const commit = this.commits.get(this.refs.get(branch)!);
    const file = this.trees.get(commit!.tree)?.get(path);
    return file ? this.blobs.get(file.sha) : undefined;
  }
  changeFile(path: string, content: string, mode = '100644') {
    const parent = this.refs.get('main')!;
    const files = new Map(this.trees.get(this.commits.get(parent)!.tree));
    files.set(path, { sha: this.blob(Buffer.from(content)), mode });
    this.refs.set('main', this.commit(this.tree(files), [parent]));
  }
  private entries(id: string) {
    const files = this.trees.get(id)!;
    const groups = new Map<string, Tree>();
    const entries: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const [path, value] of files) {
      const slash = path.indexOf('/');
      if (slash < 0) entries.push({ path, ...value, type: 'blob' });
      else {
        const name = path.slice(0, slash);
        const group = groups.get(name) || new Map();
        group.set(path.slice(slash + 1), value);
        groups.set(name, group);
      }
    }
    for (const [path, group] of groups)
      entries.push({ path, mode: '040000', type: 'tree', sha: this.tree(group) });
    return entries;
  }
  fetch: BackupFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      const url = new URL(String(input));
      if (url.origin !== 'https://api.github.com') throw new Error('Fixture refuses network');
      const method = init?.method || 'GET';
      const path = decodeURIComponent(
        url.pathname.replace('/repos/example/private-library', '').replace(/^\//, ''),
      );
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      this.requests.push({ method, path, body });
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      const missing = () => json({ message: 'missing' }, 404);
      if (!path && method === 'GET')
        return json({
          id: 42,
          full_name: 'example/private-library',
          private: this.privateRepository,
          archived: this.archived,
        });
      if (path.startsWith('git/ref/heads/')) {
        const id = this.refs.get(path.slice(14));
        return id ? json({ object: { sha: id } }) : missing();
      }
      if (path.startsWith('git/commits/') && method === 'GET') {
        const value = this.commits.get(path.slice(12));
        return value
          ? json({ tree: { sha: value.tree }, parents: value.parents.map((id) => ({ sha: id })) })
          : missing();
      }
      if (path.startsWith('git/trees/') && method === 'GET') {
        const id = path.slice(10);
        return this.trees.has(id) ? json({ tree: this.entries(id), truncated: false }) : missing();
      }
      if (path.startsWith('git/blobs/') && method === 'GET') {
        const value = this.blobs.get(path.slice(10));
        return value
          ? json({
              size: value.length,
              encoding: 'base64',
              content: Buffer.from(value).toString('base64'),
            })
          : missing();
      }
      if (path === 'git/blobs' && method === 'POST')
        return json({ sha: this.blob(Buffer.from(body.content, 'base64')) }, 201);
      if (path === 'git/trees' && method === 'POST') {
        const files = new Map(this.trees.get(body.base_tree));
        for (const file of body.tree) files.set(file.path, { sha: file.sha, mode: file.mode });
        return json({ sha: this.tree(files) }, 201);
      }
      if (path === 'git/commits' && method === 'POST')
        return json({ sha: this.commit(body.tree, body.parents) }, 201);
      if (path === 'git/refs' && method === 'POST') {
        const branch = body.ref.replace('refs/heads/', '');
        if (this.refs.has(branch)) return json({}, 422);
        this.refs.set(branch, body.sha);
        return json({ ref: body.ref, object: { sha: body.sha } }, 201);
      }
      if (path === 'pulls' && method === 'GET') {
        const head = url.searchParams.get('head')?.replace('example:', '');
        return json(
          this.pulls.filter(
            (value) => value.head.ref === head && value.base.ref === url.searchParams.get('base'),
          ),
        );
      }
      if (path === 'pulls' && method === 'POST') {
        const existing = this.pulls.find((value) => value.head.ref === body.head);
        if (existing) return json({}, 422);
        const pull: Pull = {
          number: this.pulls.length + 1,
          head: {
            sha: this.refs.get(body.head)!,
            ref: body.head,
            repo: { full_name: 'example/private-library' },
          },
          base: { sha: this.refs.get(body.base)!, ref: body.base },
          state: 'open',
          merged: false,
        };
        this.pulls.push(pull);
        if (this.loseNextPrResponse) {
          this.loseNextPrResponse = false;
          throw new Error('Fixture lost PR acknowledgement');
        }
        return json(pull, 201);
      }
      const match = /^pulls\/(\d+)(\/merge)?$/.exec(path);
      if (match) {
        const pull = this.pulls.find((value) => value.number === Number(match[1]));
        if (!pull) return missing();
        if (method === 'GET') return json(pull);
        if (method === 'PATCH') {
          pull.state = 'closed';
          return json(pull);
        }
        if (method === 'PUT' && match[2]) {
          if (this.protectedBranch) return json({}, 405);
          if (body.sha !== pull.head.sha) return json({}, 409);
          const base = this.refs.get(pull.base.ref)!;
          if (base !== pull.base.sha) return json({}, 409);
          const merge = this.commit(this.commits.get(pull.head.sha)!.tree, [base, pull.head.sha]);
          this.refs.set(pull.base.ref, merge);
          pull.merged = true;
          pull.state = 'closed';
          return json({ merged: true, sha: merge });
        }
      }
      throw new Error(`Unimplemented fixture request: ${method} ${path}`);
    },
    { preconnect: fetch.preconnect },
  );
}
