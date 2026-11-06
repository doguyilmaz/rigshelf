import { z } from 'zod';
import { guidanceFindings } from './guidance';
import { sensitiveResource, skillMetadata, snapshotDigest } from './ingest';
import {
  type Entry,
  MAX_BUNDLE_BYTES,
  MAX_FILES,
  MAX_TEXT_BYTES,
  McpSchema,
  PresetSchema,
  RecordIdSchema,
  RuleSchema,
  SCHEMA_VERSION,
} from './model';
import { PluginReferenceSchema } from './plugin-model';
import { hash, now, redact, safeRelative, scanText } from './safety';
import { validateSourceUrl } from './source-library';
import type { Store } from './store';

const EntryImport = z.object({
  id: RecordIdSchema.max(150),
  name: z.string().max(200),
  description: z.string().max(2000),
  kind: z.enum(['skill', 'mcp', 'plugin', 'resource']),
  tags: z.array(z.string().max(64)).max(100),
  sourceId: RecordIdSchema,
  digest: z.string(),
  custom: z.boolean(),
  body: z.string().max(MAX_BUNDLE_BYTES),
  findings: z.array(z.unknown()),
  updatedAt: z.string(),
  upstreamPath: z.string().max(4096).optional(),
  upstreamRef: z.string().max(200).optional(),
  mcp: z.unknown().optional(),
  plugin: PluginReferenceSchema.optional(),
  archived: z.boolean().optional(),
  derivedFrom: RecordIdSchema.max(150).optional(),
  origins: z
    .array(
      z.object({
        sourceId: RecordIdSchema,
        url: z.string().max(4096).optional(),
        path: z.string().max(4096).optional(),
        ref: z.string().max(200).optional(),
      }),
    )
    .max(1000)
    .optional(),
});
const SourceImport = z.object({
  id: RecordIdSchema,
  name: z.string().max(500),
  url: z.string().max(4096),
  type: z.enum(['github', 'local', 'listing', 'plugin', 'resource']),
  recipe: z.string().max(4096),
  status: z.enum(['unchecked', 'reachable', 'unavailable']),
  notes: z.string().max(20000),
  checkedAt: z.string().optional(),
  latestRef: z.string().max(200).optional(),
  skillCount: z.number().int().min(0).optional(),
  focusSkill: z.string().max(200).optional(),
  categories: z.array(z.string().max(100)).max(100).optional(),
  recipeKind: z.enum(['suggested', 'explicit']).optional(),
  previousUrls: z
    .array(
      z.object({
        url: z.string().max(4096),
        checkedAt: z.string().optional(),
        ref: z.string().max(200).optional(),
      }),
    )
    .max(1000)
    .optional(),
  repository: z
    .object({
      owner: z.string().max(100),
      url: z.string().max(4096),
      license: z.string().max(100).optional(),
      archived: z.boolean(),
      description: z.string().max(2000).optional(),
      checkedAt: z.string(),
    })
    .optional(),
});
const FileImport = z.object({
  path: z.string().max(4096),
  content: z.string().max(MAX_BUNDLE_BYTES * 2),
  executable: z.boolean(),
});
export const BackupSchema = z.object({
  format: z.literal('kitfold-library'),
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: z.string(),
  entries: z
    .array(z.object({ entry: EntryImport, files: z.array(FileImport).max(MAX_FILES) }))
    .max(10000),
  sources: z.array(SourceImport).max(10000),
  presets: z.array(PresetSchema).max(1000),
  rules: z.array(RuleSchema).max(1000),
});

function portableMcp(body: string) {
  const definition = McpSchema.strict().parse(JSON.parse(body));
  if (redact(body) !== body || redact(JSON.stringify(definition)) !== JSON.stringify(definition))
    throw new Error('MCP imports must use environment placeholders for credentials.');
  return definition;
}

export function exportLibrary(store: Store) {
  const excluded: { id: string; name: string; reason: string }[] = [];
  const entries = store
    .entries(true)
    .map((metadata) => ({ entry: store.entry(metadata.id)!, files: store.files(metadata.id) }))
    .filter((value) => {
      if (value.entry.kind === 'mcp') {
        try {
          portableMcp(value.entry.body);
        } catch {
          excluded.push({
            id: value.entry.id,
            name: value.entry.name,
            reason: 'MCP definition contains unknown fields or possible credentials.',
          });
          return false;
        }
      }
      const blocked = [
        value.entry.body,
        ...value.files.map((file) => Buffer.from(file.content, 'base64').toString('utf8')),
      ].some((text) => scanText(text).some((finding) => finding.code === 'secret'));
      if (blocked)
        excluded.push({
          id: value.entry.id,
          name: value.entry.name,
          reason: 'Possible embedded credential. Resolve in a custom revision before export.',
        });
      return !blocked;
    });
  const rules = store.list<import('./model').Rule>('rule').filter((rule) => {
    const blocked = guidanceFindings(rule).some((finding) => finding.level === 'block');
    if (blocked)
      excluded.push({ id: rule.id, name: rule.name, reason: 'Possible credential in directive.' });
    return !blocked;
  });
  const omitted = new Set(excluded.map((value) => value.id));
  return {
    format: 'kitfold-library',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    entries,
    sources: store
      .sources()
      .map((source) => ({ ...source, recipe: redact(source.recipe), notes: redact(source.notes) })),
    presets: store.list<import('./model').Preset>('preset').map((preset) => ({
      ...preset,
      entryIds: preset.entryIds.filter((id) => !omitted.has(id)),
      excludedIds: preset.excludedIds.filter((id) => !omitted.has(id)),
    })),
    rules,
    excluded,
  };
}

export function importLibrary(store: Store, raw: unknown, apply = false): ImportReview {
  if (apply) return store.db.transaction(() => validateLibraryImport(store, raw, true)).immediate();
  return validateLibraryImport(store, raw, false);
}

function validateLibraryImport(store: Store, raw: unknown, apply: boolean): ImportReview {
  const bundle = BackupSchema.parse(raw);
  const conflicts: string[] = [];
  const entryIds = new Set<string>(),
    sourceIds = new Set<string>();
  for (const source of bundle.sources) {
    if (sourceIds.has(source.id)) throw new Error('Duplicate source record');
    sourceIds.add(source.id);
    validateSourceUrl(source.url);
    for (const previous of source.previousUrls || []) validateSourceUrl(previous.url);
    if (source.repository?.url) validateSourceUrl(source.repository.url);
    source.notes = redact(source.notes);
    source.recipe = redact(source.recipe);
  }
  let total = 0;
  for (const value of bundle.entries) {
    if (entryIds.has(value.entry.id)) throw new Error('Duplicate entry record');
    entryIds.add(value.entry.id);
    if (!sourceIds.has(value.entry.sourceId) && !store.get('source', value.entry.sourceId))
      throw new Error(`Missing source for ${value.entry.name}`);
    const paths = new Set<string>();
    for (const file of value.files) {
      safeRelative(file.path);
      if (sensitiveResource(file.path))
        throw new Error('Sensitive resource paths are not portable.');
      if (paths.has(file.path)) throw new Error('Duplicate file in snapshot');
      paths.add(file.path);
      if (Buffer.from(file.content, 'base64').toString('base64') !== file.content)
        throw new Error('Invalid base64 snapshot');
      total += Buffer.byteLength(file.content, 'base64');
    }
    if (value.entry.kind === 'skill') {
      if (Buffer.byteLength(value.entry.body, 'utf8') > MAX_TEXT_BYTES)
        throw new Error('SKILL.md exceeds the 512 KiB instruction limit.');
      const metadata = skillMetadata(value.entry.body);
      if (
        value.entry.name !== (metadata.name || 'Unnamed skill') ||
        value.entry.description !== metadata.description
      )
        throw new Error('Skill metadata differs from its snapshot.');
      if (snapshotDigest(value.files) !== value.entry.digest)
        throw new Error(`Snapshot digest mismatch: ${value.entry.name}`);
      const skillFile = value.files.find((file) => file.path === 'SKILL.md');
      if (
        !skillFile ||
        Buffer.from(skillFile.content, 'base64').toString('utf8') !== value.entry.body
      )
        throw new Error('Skill body differs from its snapshot');
    } else if (hash(value.entry.body) !== value.entry.digest)
      throw new Error('Entry digest mismatch');
    if (value.entry.kind === 'mcp') {
      value.entry.mcp = portableMcp(value.entry.body);
    }
    if (
      value.entry.plugin &&
      (value.entry.kind !== 'plugin' ||
        JSON.stringify(PluginReferenceSchema.parse(JSON.parse(value.entry.body))) !==
          JSON.stringify(value.entry.plugin))
    )
      throw new Error('Plugin reference metadata differs from its snapshot.');
    const existing = store.entry(value.entry.id);
    for (const origin of value.entry.origins || []) if (origin.url) validateSourceUrl(origin.url);
    if (existing && (existing.digest !== value.entry.digest || existing.body !== value.entry.body))
      conflicts.push(value.entry.name);
  }
  if (total > 256 * 1024 * 1024) throw new Error('Import exceeds the 256 MiB library limit');
  const presets = new Map(
    [...store.list<import('./model').Preset>('preset'), ...bundle.presets].map((preset) => [
      preset.id,
      preset,
    ]),
  );
  const seenPresets = new Set<string>(),
    seenRules = new Set<string>();
  for (const preset of bundle.presets) {
    if (seenPresets.has(preset.id)) throw new Error('Duplicate preset record');
    seenPresets.add(preset.id);
    const seen = new Set<string>();
    let current: typeof preset | undefined = preset;
    while (current) {
      if (seen.has(current.id)) throw new Error('Preset inheritance contains a cycle.');
      seen.add(current.id);
      if (current.parentId && !presets.has(current.parentId))
        throw new Error('Missing parent preset');
      current = current.parentId ? presets.get(current.parentId) : undefined;
    }
    for (const id of preset.entryIds)
      if (!entryIds.has(id) && !store.entry(id))
        conflicts.push(`Missing pinned capability in ${preset.name}: ${id}`);
  }
  for (const rule of bundle.rules) {
    if (seenRules.has(rule.id)) throw new Error('Duplicate directive record');
    seenRules.add(rule.id);
  }
  for (const preset of bundle.presets)
    if (
      store.get('preset', preset.id) &&
      JSON.stringify(store.get('preset', preset.id)) !== JSON.stringify(preset)
    )
      conflicts.push(`Preset: ${preset.name}`);
  for (const rule of bundle.rules)
    if (
      store.get('rule', rule.id) &&
      JSON.stringify(store.get('rule', rule.id)) !== JSON.stringify(rule)
    )
      conflicts.push(`Rule: ${rule.name}`);
  if (apply && conflicts.length)
    throw new Error('Import has conflicting records. Rename or reconcile them first.');
  if (apply)
    store.db.transaction(() => {
      for (const source of bundle.sources)
        if (!store.get('source', source.id)) store.put('source', source);
      for (const { entry: rawEntry, files } of bundle.entries) {
        // Matching immutable content does not authorize replacing local relationships or archive state.
        if (store.entry(rawEntry.id)) continue;
        const findings = [
          ...scanText(rawEntry.body),
          ...files.flatMap((file) =>
            scanText(Buffer.from(file.content, 'base64').toString('utf8'), file.path),
          ),
        ];
        const entry = { ...rawEntry, findings } as Entry;
        if (entry.kind === 'mcp') entry.mcp = portableMcp(entry.body);
        store.saveEntry(entry, files);
      }
      for (const preset of bundle.presets) store.put('preset', preset);
      for (const rule of bundle.rules) store.put('rule', rule);
      store.event('library.imported', `${bundle.entries.length} entries imported`);
    })();
  return {
    entries: bundle.entries.length,
    sources: bundle.sources.length,
    presets: bundle.presets.length,
    rules: bundle.rules.length,
    directives: bundle.rules.map(({ id, name, scope, enabled, content, priority, provenance }) => ({
      id,
      name,
      scope,
      enabled,
      findings: guidanceFindings({ id, name, scope, enabled, content, priority, provenance }),
    })),
    conflicts,
    applied: apply,
  };
}

export interface ImportReview {
  entries: number;
  sources: number;
  presets: number;
  rules: number;
  conflicts: string[];
  applied: boolean;
  directives: {
    id: string;
    name: string;
    scope: string;
    enabled: boolean;
    findings: import('./model').Finding[];
  }[];
}
