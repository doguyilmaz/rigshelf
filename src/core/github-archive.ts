import { gunzipSync } from 'node:zlib';
import { extract } from 'tar-stream';
import { safeRelative } from './safety';

export interface RepositoryFile {
  path: string;
  type: string;
  mode: string;
  size?: number;
  data?: Uint8Array;
}
async function download(url: string, maximum: number): Promise<Uint8Array> {
  const endpoint = new URL(url);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(endpoint, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: { Accept: '*/*', 'User-Agent': 'Rigshelf-Workbench/0.1' },
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) throw new Error('Too many or invalid GitHub redirects.');
    const next = new URL(location, endpoint);
    if (
      next.hostname !== endpoint.hostname ||
      next.protocol !== 'https:' ||
      next.username ||
      next.password ||
      next.port
    )
      throw new Error('GitHub redirect left its allowed HTTPS host.');
    await response.body?.cancel();
    endpoint.href = next.href;
  }
  if (!response) throw new Error('Empty GitHub response');
  if (!response.ok) throw new Error(`GitHub archive endpoint returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty GitHub response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new Error(
        'Repository archive exceeds its bounded download limit. Import a local skill directory instead.',
      );
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export async function publicHead(repo: string): Promise<string> {
  const feed = new TextDecoder().decode(
    await download(`https://github.com/${repo}/commits.atom`, 1024 * 1024),
  );
  const ref = feed.match(/\/commit\/([a-f0-9]{40})(?:[<"?/#\s]|$)/)?.[1];
  if (!ref) throw new Error('No immutable commit was found in the public GitHub feed.');
  return ref;
}
export async function parseRepositoryArchive(
  bytes: Uint8Array,
  repo: string,
  ref: string,
): Promise<RepositoryFile[]> {
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('Invalid immutable GitHub ref');
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  const parser = extract();
  const files: RepositoryFile[] = [];
  const paths = new Set<string>();
  let totalEntries = 0;
  const expected = `${repo.split('/')[1]}-${ref}`.toLowerCase();
  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject);
    parser.on('finish', resolve);
    parser.on('entry', (header, stream, next) => {
      stream.on('error', reject);
      try {
        if (++totalEntries > 40000)
          throw new Error('Repository archive exceeds 40,000 total entries.');
        const components = header.name.replace(/\/$/, '').split('/');
        if (components.shift()?.toLowerCase() !== expected)
          throw new Error('Archive root does not match its repository and pinned commit.');
        if (!components.length) {
          if (header.type !== 'directory') throw new Error('Unexpected archive root entry');
          stream.resume();
          stream.on('end', next);
          return;
        }
        const path = safeRelative(components.join('/'));
        if (header.type === 'directory') {
          stream.resume();
          stream.on('end', next);
          return;
        }
        if (paths.has(path)) throw new Error('Duplicate archive file path');
        paths.add(path);
        if (paths.size > 20000) throw new Error('Repository archive exceeds 20,000 file entries.');
        const linked = header.type === 'symlink' || header.type === 'link';
        if (header.type !== 'file' && !linked)
          throw new Error('Unsupported special file in repository archive');
        const file: RepositoryFile = {
          path,
          type: 'blob',
          mode: linked ? '120000' : (header.mode || 0) & 0o111 ? '100755' : '100644',
          size: header.size || 0,
        };
        const chunks: Uint8Array[] = [];
        let length = 0;
        stream.on('data', (chunk: unknown) => {
          if (!(chunk instanceof Uint8Array)) {
            parser.destroy(new Error('Invalid archive byte stream'));
            return;
          }
          length += chunk.length;
          if (!linked && (header.size || 0) <= 16 * 1024 * 1024) chunks.push(chunk);
        });
        stream.on('end', () => {
          if (length !== (header.size || 0)) {
            parser.destroy(new Error('Archive file length mismatch'));
            return;
          }
          if (!linked && length <= 16 * 1024 * 1024) file.data = Buffer.concat(chunks);
          files.push(file);
          next();
        });
      } catch (error) {
        stream.resume();
        parser.destroy(error instanceof Error ? error : new Error('Invalid archive'));
      }
    });
    parser.end(tar);
  });
  return files;
}
let cached: { key: string; files: RepositoryFile[] } | undefined;
export async function publicArchive(repo: string, ref: string): Promise<RepositoryFile[]> {
  const key = `${repo}@${ref}`;
  if (cached?.key === key) return cached.files;
  const bytes = await download(
    `https://codeload.github.com/${repo}/tar.gz/${ref}`,
    32 * 1024 * 1024,
  );
  const files = await parseRepositoryArchive(bytes, repo, ref);
  cached = { key, files };
  return files;
}
