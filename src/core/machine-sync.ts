import { z } from 'zod';
import { exportLibrary, importLibrary } from './backup';
import { readKit } from './kit';
import { MAX_PROJECT_KIT_ENTRIES } from './kit-limits';
import { machineProjects } from './machine-inventory';
import { ProvidersSchema, type Rule, RuleSchema } from './model';
import { createPlan } from './planner';
import type { Store } from './store';

const MAX_SYNC_PROJECTS = 300;
const MAX_DIRECTIVES = 1000;

const ProjectRequest = z.object({
  repository: z.string().min(1).max(300),
  entryIds: z.array(z.string().min(1).max(150)).max(MAX_PROJECT_KIT_ENTRIES),
  providers: ProvidersSchema,
  presetId: z.string().max(100).optional(),
  requirements: z.string().max(10000).optional(),
});
const SyncRequestSchema = z.object({
  library: z.unknown(),
  projects: z.array(ProjectRequest).max(MAX_SYNC_PROJECTS),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
type Withheld = { id: string; name: string; reason: string };

export async function buildSyncRequest(
  store: Store,
  roots: string[],
): Promise<{
  request: SyncRequest;
  skipped: { name: string; reason: string }[];
  withheld: Withheld[];
}> {
  const skipped: { name: string; reason: string }[] = [];
  const projects: SyncRequest['projects'] = [];
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
    projects.push({
      repository: project.repository,
      entryIds: kit.entries.map((entry) => entry.id),
      providers: kit.providers,
      presetId: kit.presetId,
      requirements: kit.requirements,
    });
  }
  const exported = exportLibrary(store);
  const wanted = new Set(projects.flatMap((project) => project.entryIds));
  const entries = exported.entries.filter((value) => wanted.has(value.entry.id));
  const sent = new Set(entries.map((value) => value.entry.id));
  const withheld: Withheld[] = [...wanted]
    .filter((id) => !sent.has(id))
    .map(
      (id) =>
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

/** Runs on the server: imports the sent Library additively, then prepares one plan per matched clone without writing project files. */
export async function prepareSync(
  store: Store,
  raw: unknown,
  roots: string[],
  options: { replaceDirectives?: boolean } = {},
) {
  const request = SyncRequestSchema.parse(raw);
  const bundle = z
    .object({ rules: z.array(RuleSchema).max(MAX_DIRECTIVES) })
    .passthrough()
    .parse(request.library);
  const library = importLibrary(store, { ...bundle, rules: [], presets: [] }, true);
  const directives = syncDirectives(store, bundle.rules, options.replaceDirectives ?? false);
  const clones = await machineProjects(roots);
  const projects = [];
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
