import { randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { exportLibrary, importLibrary } from './backup';
import { readKit } from './kit';
import { MAX_PROJECT_KIT_ENTRIES } from './kit-limits';
import { readLocalBytes } from './local-files';
import { machineProjects } from './machine-inventory';
import { claudeMemoryKey } from './memory-locations';
import { type Change, type Plan, ProvidersSchema, type Rule, RuleSchema } from './model';
import { rootIdentity } from './ownership';
import { planFile } from './plan-limits';
import { createPlan, missingDirectories } from './planner';
import { assertWritePath, hash, now, redact, safeRelative } from './safety';
import type { Store } from './store';

const MAX_SYNC_PROJECTS = 300;
const MAX_DIRECTIVES = 1000;
const MAX_MEMORY_FILES = 200;
const MAX_MEMORY_BYTES = 1024 * 1024;

const MemoryRequest = z.object({
  sourceProject: z.string().min(1).max(4096),
  sourceHome: z.string().min(1).max(4096),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(1024)
          .refine((value) => {
            try {
              safeRelative(value);
              return true;
            } catch {
              return false;
            }
          }, 'Memory paths must stay inside the memory folder.'),
        content: z.string().max(MAX_MEMORY_BYTES),
      }),
    )
    .max(MAX_MEMORY_FILES),
});

const ProjectRequest = z.object({
  repository: z.string().min(1).max(300),
  entryIds: z.array(z.string().min(1).max(150)).max(MAX_PROJECT_KIT_ENTRIES),
  providers: ProvidersSchema,
  presetId: z.string().max(100).optional(),
  requirements: z.string().max(10000).optional(),
  memory: MemoryRequest.optional(),
});
const SyncRequestSchema = z.object({
  library: z.unknown(),
  projects: z.array(ProjectRequest).max(MAX_SYNC_PROJECTS),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
type Withheld = { id: string; name: string; reason: string };
export interface PreparedProject {
  repository: string;
  path?: string;
  planId?: string;
  files?: number;
  warnings?: string[];
  error?: string;
  memoryPlanId?: string;
  memoryFiles?: number;
  memoryError?: string;
}

async function memoryFiles(folder: string, withheld: Withheld[]) {
  const files: { path: string; content: string }[] = [];
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || files.length >= MAX_MEMORY_FILES) continue;
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(folder, absolute).split('\\').join('/');
    if ((await lstat(absolute)).size > MAX_MEMORY_BYTES) {
      withheld.push({ id: `memory/${path}`, name: `memory/${path}`, reason: 'Larger than 1 MiB.' });
      continue;
    }
    const content = (await readLocalBytes(absolute, MAX_MEMORY_BYTES)).toString('utf8');
    if (redact(content) !== content) {
      withheld.push({
        id: `memory/${path}`,
        name: `memory/${path}`,
        reason: 'Possible credential; set it up by hand.',
      });
      continue;
    }
    files.push({ path, content });
  }
  return files;
}

export async function buildSyncRequest(
  store: Store,
  roots: string[],
  options: { home?: string; memory?: string[] } = {},
): Promise<{
  request: SyncRequest;
  skipped: { name: string; reason: string }[];
  withheld: Withheld[];
}> {
  const home = options.home ?? homedir();
  const withMemory = new Set(options.memory ?? []);
  const skipped: { name: string; reason: string }[] = [];
  const projects: SyncRequest['projects'] = [];
  const withheld: Withheld[] = [];
  for (const project of await machineProjects(roots)) {
    if (!project.repository) {
      skipped.push({ name: project.name, reason: 'no Git origin to match on the server' });
      continue;
    }
    const kit = await readKit(project.path).catch(() => undefined);
    if (!kit) {
      skipped.push({ name: project.name, reason: 'no Rigshelf kit applied here' });
      continue;
    }
    const memory =
      withMemory.has(project.name) || withMemory.has(project.repository)
        ? {
            sourceProject: project.path,
            sourceHome: home,
            files: await memoryFiles(
              join(home, '.claude/projects', claudeMemoryKey(project.path), 'memory'),
              withheld,
            ),
          }
        : undefined;
    projects.push({
      repository: project.repository,
      entryIds: kit.entries.map((entry) => entry.id),
      providers: kit.providers,
      presetId: kit.presetId,
      requirements: kit.requirements,
      ...(memory ? { memory } : {}),
    });
  }
  const exported = exportLibrary(store);
  const wanted = new Set(projects.flatMap((project) => project.entryIds));
  const entries = exported.entries.filter((value) => wanted.has(value.entry.id));
  const sent = new Set(entries.map((value) => value.entry.id));
  for (const id of wanted)
    if (!sent.has(id))
      withheld.push(
        exported.excluded.find((value) => value.id === id) || {
          id,
          name: id,
          reason: 'Not in this machine’s Library.',
        },
      );
  for (const project of projects) project.entryIds = project.entryIds.filter((id) => sent.has(id));
  const sourceIds = new Set(entries.map((value) => value.entry.sourceId));
  return {
    request: {
      library: {
        format: exported.format,
        schemaVersion: exported.schemaVersion,
        exportedAt: exported.exportedAt,
        entries,
        sources: exported.sources.filter((source) => sourceIds.has(source.id)),
        presets: [],
        rules: exported.rules,
      },
      projects,
    },
    skipped,
    withheld,
  };
}

function syncDirectives(store: Store, rules: Rule[], replace: boolean) {
  const result = { added: [] as string[], replaced: [] as string[], kept: [] as string[] };
  for (const rule of rules) {
    const existing = store.get<Rule>('rule', rule.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(rule)) continue;
    if (existing && !replace) {
      result.kept.push(rule.id);
      continue;
    }
    store.put('rule', rule);
    (existing ? result.replaced : result.added).push(rule.id);
  }
  return result;
}

async function memoryPlan(
  store: Store,
  home: string,
  clone: string,
  memory: z.infer<typeof MemoryRequest>,
): Promise<Plan | undefined> {
  const root = join(home, '.claude/projects');
  if (!(await lstat(root).catch(() => undefined))?.isDirectory())
    throw new Error(
      'Claude Code has not created ~/.claude/projects here yet. Run Claude Code once, then sync memory.',
    );
  const folder = `${claudeMemoryKey(clone)}/memory`;
  const changes: Change[] = [];
  for (const file of memory.files) {
    const path = `${folder}/${file.path}`;
    const target = await assertWritePath(root, path);
    const after = file.content
      .split(memory.sourceProject)
      .join(clone)
      .split(memory.sourceHome)
      .join(home);
    const before = await planFile(target);
    if (before?.toString('utf8') === after) continue;
    const mode = before ? (await lstat(target)).mode & 0o777 : undefined;
    changes.push({
      path,
      beforeHash: before ? hash(before) : null,
      before: before ? before.toString('base64') : null,
      after: Buffer.from(after).toString('base64'),
      reason: 'Sync opted-in Claude memory from the other machine',
      beforeMode: mode,
      afterMode: mode ?? 0o600,
    });
  }
  if (!changes.length) return;
  const plan: Plan = {
    id: randomUUID(),
    projectPath: root,
    providers: [],
    entries: [],
    createdAt: now(),
    changes,
    warnings: ['Memory files that exist only on this machine are kept.'],
    status: 'planned',
    purpose: 'document',
    rootIdentity: await rootIdentity(root),
    createdDirectories: await missingDirectories(root, changes),
  };
  store.put('plan', plan);
  store.event('memory.planned', `${changes.length} memory files for ${clone}`);
  return plan;
}

async function memoryResult(
  store: Store,
  home: string,
  clone: string,
  memory: z.infer<typeof MemoryRequest>,
): Promise<{ memoryPlanId?: string; memoryFiles?: number; memoryError?: string }> {
  try {
    const plan = await memoryPlan(store, home, clone, memory);
    return { memoryPlanId: plan?.id, memoryFiles: plan?.changes.length ?? 0 };
  } catch (error) {
    return { memoryError: error instanceof Error ? error.message : 'Could not prepare memory.' };
  }
}

/** Runs on the server: imports the sent Library additively, then prepares one plan per matched clone without writing project files. */
export async function prepareSync(
  store: Store,
  raw: unknown,
  roots: string[],
  options: { replaceDirectives?: boolean; home?: string } = {},
) {
  const request = SyncRequestSchema.parse(raw);
  const bundle = z
    .object({ rules: z.array(RuleSchema).max(MAX_DIRECTIVES) })
    .passthrough()
    .parse(request.library);
  const library = importLibrary(store, { ...bundle, rules: [], presets: [] }, true);
  const directives = syncDirectives(store, bundle.rules, options.replaceDirectives ?? false);
  const clones = await machineProjects(roots);
  const projects: PreparedProject[] = [];
  for (const project of request.projects) {
    const clone = clones.find((candidate) => candidate.repository === project.repository);
    if (!clone) {
      projects.push({
        repository: project.repository,
        error: `No clone of ${project.repository} under ${roots.join(', ')}.`,
      });
      continue;
    }
    try {
      const plan = await createPlan(store, {
        projectPath: clone.path,
        providers: project.providers,
        entryIds: project.entryIds,
        presetId:
          project.presetId && store.get('preset', project.presetId) ? project.presetId : undefined,
        requirements: project.requirements ?? '',
        includeRules: true,
        allowReviewed: true,
      });
      projects.push({
        repository: project.repository,
        path: clone.path,
        planId: plan.id,
        files: plan.changes.length,
        warnings: plan.warnings,
        ...(project.memory
          ? await memoryResult(store, options.home ?? homedir(), clone.path, project.memory)
          : {}),
      });
    } catch (error) {
      projects.push({
        repository: project.repository,
        path: clone.path,
        error: error instanceof Error ? error.message : 'Could not prepare the plan.',
      });
    }
  }
  return { library: { entries: library.entries }, directives, projects };
}
