import { parse, stringify } from 'yaml';
import { saveSkill, sensitiveResource } from './ingest';
import { type Entry, MAX_BUNDLE_BYTES, MAX_FILES, type PackedFile, type Source } from './model';
import { safeRelative, scanText, slug } from './safety';
import type { Store } from './store';

const customSource: Source = {
  id: 'custom',
  name: 'Custom skills',
  url: '',
  type: 'local',
  recipe: '',
  status: 'unchecked',
  notes: 'Authored locally. Forks retain their original supporting files and a revision lineage.',
};
export function reviseSkill(
  store: Store,
  id: string,
  input: {
    name?: string;
    description?: string;
    body?: string;
    tags?: string[];
    file?: PackedFile;
    removePath?: string;
  },
): Entry {
  const original = store.entry(id);
  if (original?.kind !== 'skill') throw new Error('Skill snapshot not found');
  const match = original.body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let metadata: Record<string, unknown> = {};
  try {
    metadata = match ? (parse(match[1], { maxAliasCount: 10 }) as Record<string, unknown>) : {};
  } catch {
    /* Recover invalid upstream metadata into valid custom frontmatter. */
  }
  metadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  metadata.name = slug(input.name || original.name);
  metadata.description = input.description || original.description;
  const instructions = (input.body ?? original.body.slice(match?.[0].length || 0)).replace(
    /^(?:\r?\n)+/,
    '',
  );
  let body = `---\n${stringify(metadata).trimEnd()}\n---\n\n${instructions}`;
  if (input.removePath) {
    safeRelative(input.removePath);
    if (input.removePath === 'SKILL.md') throw new Error('A skill must retain SKILL.md.');
    if (!store.fileMetadata(id).some((file) => file.path === input.removePath))
      throw new Error('Supporting file not found.');
  }
  const files = store
    .files(id)
    .filter((file) => !sensitiveResource(file.path) && file.path !== input.removePath);
  const skill = {
    path: 'SKILL.md',
    content: Buffer.from(body).toString('base64'),
    executable: false,
  };
  const existing = files.findIndex((file) => file.path === 'SKILL.md');
  if (existing >= 0) files[existing] = skill;
  else files.unshift(skill);
  if (input.file) {
    safeRelative(input.file.path);
    if (sensitiveResource(input.file.path))
      throw new Error('Keep sensitive files outside portable skill snapshots.');
    const index = files.findIndex((file) => file.path === input.file!.path);
    if (index >= 0) files[index] = input.file;
    else files.push(input.file);
    if (input.file.path === 'SKILL.md')
      body = Buffer.from(input.file.content, 'base64').toString('utf8');
  }
  if (
    files.length > MAX_FILES ||
    files.reduce((total, file) => total + Buffer.byteLength(file.content, 'base64'), 0) >
      MAX_BUNDLE_BYTES
  )
    throw new Error('Revision exceeds snapshot limits');
  const findings = files.flatMap((file) =>
    scanText(Buffer.from(file.content, 'base64').toString('utf8'), file.path),
  );
  const entry = saveSkill(store, body, files, customSource, { custom: true, findings });
  entry.tags = input.tags || original.tags;
  entry.derivedFrom = entry.id === original.id ? original.derivedFrom : original.id;
  entry.archived = false;
  store.saveEntry(entry);
  store.event('skill.revised', `${entry.name}: new custom snapshot`);
  return entry;
}
