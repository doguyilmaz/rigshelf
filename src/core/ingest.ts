import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ignoredDirectories, inferTags, readText } from './detect';
import { readLocalBytes } from './local-files';
import {
  type Entry,
  type Finding,
  MAX_BUNDLE_BYTES,
  MAX_FILES,
  MAX_TEXT_BYTES,
  type PackedFile,
  type Source,
} from './model';
import { hash, inside, now, safeRelative, scanText, slug } from './safety';
import type { Store } from './store';

export function skillMetadata(body: string): {
  name: string;
  description: string;
  findings: Finding[];
} {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let parsed: unknown = {};
  const parseFindings: Finding[] = [];
  try {
    parsed = match ? parseYaml(match[1], { maxAliasCount: 10 }) : {};
  } catch {
    parsed = Object.fromEntries(
      (match?.[1] || '').split('\n').flatMap((line) => {
        const field = line.match(/^(name|description):\s*(.+)$/);
        return field ? [[field[1], field[2].replace(/^["']|["']$/g, '')]] : [];
      }),
    );
    parseFindings.push({
      code: 'invalid-yaml',
      level: 'review',
      message:
        'Invalid YAML frontmatter. Metadata was recovered; fix a custom copy before installation.',
    });
  }
  const metadata = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const name = typeof metadata.name === 'string' ? metadata.name : '';
  const description = typeof metadata.description === 'string' ? metadata.description : '';
  const findings = [...scanText(body), ...parseFindings];
  if (!name || !description)
    findings.push({
      code: 'metadata',
      level: 'review',
      message: 'Missing skill name or description.',
    });
  if (name && slug(name) !== name)
    findings.push({
      code: 'nonstandard-name',
      level: 'info',
      message: 'Name will be normalized for portable folder paths.',
    });
  if (description.length > 1024)
    findings.push({
      code: 'description-length',
      level: 'info',
      message: 'Description exceeds the portable 1024-character limit.',
    });
  if (name.length > 200 || description.length > 2000)
    findings.push({
      code: 'catalog-metadata-length',
      level: 'review',
      message:
        'Catalog metadata was shortened. The complete original content remains in the immutable snapshot.',
    });
  return { name: name.slice(0, 200), description: description.slice(0, 2000), findings };
}

export function sensitiveResource(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    (/^\.env(?:\.|$)/.test(name) && !/\.(?:example|sample|template)$/.test(name)) ||
    /^(?:id_rsa|id_ed25519|auth\.json|credentials\.json|tokens\.json)$/.test(name) ||
    /\.(?:key|p12|pfx)$/.test(name)
  );
}

export async function packDirectory(
  directory: string,
): Promise<{ files: PackedFile[]; findings: Finding[] }> {
  const files: PackedFile[] = [];
  const findings: Finding[] = [];
  const root = await realpath(directory);
  let total = 0;
  async function visit(current: string, depth: number): Promise<void> {
    if (depth > 12) throw new Error('Skill directory exceeds depth limit');
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (ignoredDirectories.has(entry.name) || entry.name === '.DS_Store') continue;
      const path = join(current, entry.name);
      const filePath = safeRelative(relative(root, path).split('\\').join('/'));
      if (sensitiveResource(filePath)) {
        findings.push({
          code: 'sensitive-resource',
          level: 'review',
          message:
            'Sensitive-looking resource excluded from the snapshot. Supply credentials separately.',
          file: filePath,
        });
        continue;
      }
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        findings.push({
          code: 'symlink',
          level: 'review',
          message: 'Symlink resource excluded from portable snapshot.',
          file: filePath,
        });
        continue;
      }
      if (stat.isDirectory()) {
        await visit(path, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.nlink !== 1) {
        findings.push({
          code: 'linked-resource',
          level: 'review',
          message: 'Hard-linked resource excluded from the portable snapshot.',
          file: filePath,
        });
        continue;
      }
      total += stat.size;
      if (files.length >= MAX_FILES || total > MAX_BUNDLE_BYTES)
        throw new Error('Skill exceeds bounded snapshot size');
      const bytes = await readLocalBytes(path, MAX_BUNDLE_BYTES - (total - stat.size));
      findings.push(
        ...scanText(new TextDecoder().decode(bytes), filePath).filter(
          (finding) => finding.level === 'block',
        ),
      );
      if (
        stat.size <= MAX_TEXT_BYTES &&
        /\.(md|txt|ts|js|mjs|py|sh|json|yaml|yml|toml)$/i.test(path)
      )
        findings.push(...scanText(new TextDecoder().decode(bytes), filePath));
      files.push({
        path: filePath,
        content: Buffer.from(bytes).toString('base64'),
        executable: Boolean(stat.mode & 0o111),
      });
    }
  }
  await visit(root, 0);
  return { files, findings };
}

export function snapshotDigest(files: PackedFile[]): string {
  return hash(
    JSON.stringify(
      [...files]
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
        .map((file) => [file.path, file.content, file.executable]),
    ),
  );
}

interface SkillImportOptions {
  custom?: boolean;
  upstreamPath?: string;
  upstreamRef?: string;
  findings?: Finding[];
}

export function saveSkill(
  store: Store,
  body: string,
  files: PackedFile[],
  source: Source,
  extra: SkillImportOptions = {},
): Entry {
  // Merge authored metadata and provenance in the same transaction as the snapshot write.
  return store.db.transaction(() => persistSkill(store, body, files, source, extra))();
}

function persistSkill(
  store: Store,
  body: string,
  files: PackedFile[],
  source: Source,
  extra: SkillImportOptions,
): Entry {
  if (Buffer.byteLength(body, 'utf8') > MAX_TEXT_BYTES)
    throw new Error('SKILL.md exceeds the 512 KiB instruction limit.');
  const metadata = skillMetadata(body);
  const digest = snapshotDigest(files);
  const id = `${extra.custom ? 'custom' : 'skill'}-${slug(metadata.name || 'unnamed')}-${digest.slice(0, 20)}`;
  const existing = store.entry(id);
  const sourceId =
    existing?.sourceId && store.get<Source>('source', existing.sourceId)?.type !== 'local'
      ? existing.sourceId
      : source.id;
  const origins = [
    ...new Map(
      [
        ...(existing?.origins ||
          (existing
            ? [
                {
                  sourceId: existing.sourceId,
                  url: store.get<Source>('source', existing.sourceId)?.url,
                  path: existing.upstreamPath,
                  ref: existing.upstreamRef,
                },
              ]
            : [])),
        { sourceId: source.id, url: source.url, path: extra.upstreamPath, ref: extra.upstreamRef },
      ].map((origin) => [
        `${origin.sourceId}:${origin.url || ''}:${origin.path || ''}:${origin.ref || ''}`,
        origin,
      ]),
    ).values(),
  ];
  if (origins.length > 1000)
    throw new Error(
      'Snapshot provenance reached its 1,000-receipt limit. Reconcile its source history before importing another receipt.',
    );
  const primaryOrigin = origins.findLast((origin) => origin.sourceId === sourceId);
  const entry: Entry = {
    id,
    name: metadata.name || 'Unnamed skill',
    description: metadata.description,
    kind: 'skill',
    tags: existing?.tags || inferTags(metadata.name, source.name),
    sourceId,
    origins,
    digest,
    custom: extra.custom ?? existing?.custom ?? false,
    body,
    updatedAt: existing?.updatedAt || now(),
    archived: existing?.archived,
    findings: [
      ...new Map(
        [...metadata.findings, ...(extra.findings || [])].map((finding) => [
          `${finding.file}:${finding.code}`,
          finding,
        ]),
      ).values(),
    ],
    upstreamPath: primaryOrigin?.path,
    upstreamRef: primaryOrigin?.ref,
  };
  const existingSource = store.get<Source>('source', source.id);
  store.put('source', existingSource ? { ...source, ...existingSource } : source);
  store.saveEntry(entry, files);
  return entry;
}

async function originFor(
  directory: string,
  name: string,
  home: string,
): Promise<{ source: Source; upstreamPath?: string; upstreamRef?: string }> {
  let ancestor = dirname(directory);
  for (let step = 0; step < 5; step++) {
    for (const lockName of ['skills-lock.json', '.skill-lock.json']) {
      const text = await readText(join(ancestor, lockName)).catch(() => undefined);
      if (!text) continue;
      const lock = JSON.parse(text) as {
        skills?: Record<
          string,
          {
            source?: string;
            sourceUrl?: string;
            skillPath?: string;
            ref?: string;
            sourceType?: string;
          }
        >;
      };
      const record = lock.skills?.[name] || lock.skills?.[basename(directory)];
      if (record?.source && /^[\w.-]+\/[\w.-]+$/.test(record.source)) {
        const url = `https://github.com/${record.source}`;
        return {
          source: {
            id: `github-${hash(url.toLowerCase()).slice(0, 20)}`,
            name: record.source,
            url,
            type: 'github',
            recipe: `bunx skills add ${record.source}`,
            status: 'unchecked',
            notes: 'Origin from local skills lockfile; not independently publisher-verified.',
          },
          upstreamPath: record.skillPath?.replace(/\/SKILL\.md$/, ''),
          upstreamRef: record.ref,
        };
      }
    }
    const next = dirname(ancestor);
    if (next === ancestor || !inside(home, next)) break;
    ancestor = next;
  }
  // Plugin caches retain publisher/repository hints, but a path is not verification.
  const sourcePath = directory.includes('/plugins/cache/')
    ? directory.split('/plugins/cache/')[1]?.split('/').slice(0, 2).join('/')
    : '';
  return {
    source: {
      id: sourcePath ? `plugin-${hash(sourcePath).slice(0, 20)}` : 'local-imports',
      name: sourcePath || 'Local imports',
      url: '',
      type: 'local',
      recipe: '',
      status: 'unchecked',
      notes: sourcePath
        ? 'Imported directly from a local plugin cache.'
        : 'Direct file discovery. Origin not established.',
    },
  };
}

export async function importSkillDirectory(
  store: Store,
  directory: string,
  home: string,
): Promise<Entry> {
  const leaf = await lstat(join(directory, 'SKILL.md'));
  if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1)
    throw new Error('SKILL.md must be a regular file without symbolic or hard links.');
  const packed = await packDirectory(directory);
  const skillFile = packed.files.find((file) => file.path === 'SKILL.md');
  if (!skillFile || Buffer.byteLength(skillFile.content, 'base64') > MAX_TEXT_BYTES)
    throw new Error('SKILL.md is missing or exceeds the 512 KiB instruction limit.');
  const body = Buffer.from(skillFile.content, 'base64').toString('utf8');
  if (!body) throw new Error('SKILL.md is empty.');
  const metadata = skillMetadata(body);
  const origin = await originFor(directory, metadata.name, home);
  return saveSkill(store, body, packed.files, origin.source, {
    upstreamPath: origin.upstreamPath,
    upstreamRef: origin.upstreamRef,
    findings: packed.findings,
  });
}

export function createCustomSkill(
  store: Store,
  input: { name: string; description: string; body: string; tags: string[] },
): Entry {
  const name = slug(input.name);
  const body = `---\nname: ${name}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.body}\n`;
  const source: Source = {
    id: 'custom',
    name: 'Custom skills',
    url: '',
    type: 'local',
    recipe: '',
    status: 'unchecked',
    notes: 'Authored locally.',
  };
  const entry = saveSkill(
    store,
    body,
    [{ path: 'SKILL.md', content: Buffer.from(body).toString('base64'), executable: false }],
    source,
    { custom: true },
  );
  entry.tags = input.tags;
  store.saveEntry(entry);
  store.event('skill.created', `Created ${entry.name}`);
  return entry;
}
