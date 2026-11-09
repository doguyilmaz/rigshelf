import { basename, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { packDirectory } from './ingest';
import type { Kit } from './kit';
import type { Entry, Project } from './model';
import { type Mcp, McpSchema } from './model';
import { hash, inside, slug } from './safety';
import type { Store } from './store';

export async function pinnedSkill(
  store: Store,
  project: Project,
  directory: string,
  kit?: Kit,
): Promise<Entry | undefined> {
  if (!kit || !inside(project.path, directory)) return;
  const record = kit.entries.find((value) => slug(value.name || '') === basename(directory));
  const entry = record && store.entry(record.id);
  if (!entry || (record.digest && record.digest !== entry.digest)) return;
  const prefix = `${relative(project.path, directory).split('\\').join('/')}/`;
  const expected = Object.entries(kit.hashes).filter(([path]) => path.startsWith(prefix));
  if (!expected.length) return;
  const packed = await packDirectory(directory);
  if (packed.files.length !== expected.length) return;
  const actual = new Map(
    packed.files.map((file) => [
      `${prefix}${file.path}`,
      hash(Buffer.from(file.content, 'base64')),
    ]),
  );
  if (expected.every(([path, digest]) => actual.get(path) === digest)) return entry;
}

export function pinnedMcp(
  store: Store,
  kit: Kit | undefined,
  provider: string,
  name: string,
  actual: Mcp,
): Entry | undefined {
  const expected = kit?.managedMcp?.[provider]?.[name];
  if (!expected || !isDeepStrictEqual(McpSchema.parse(expected), McpSchema.parse(actual))) return;
  const record = kit?.entries.find((value) => slug(value.name || '') === slug(name));
  const entry = record && store.entry(record.id);
  return entry?.kind === 'mcp' && (!record?.digest || record.digest === entry.digest)
    ? entry
    : undefined;
}
