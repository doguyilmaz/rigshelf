import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
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
const MAX_COPY_FILES = 10_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_BUNDLE_FILE_BYTES = 128 * 1024 * 1024;
const GIT_TIMEOUT_MS = 15_000;

/** Agent configuration that a clone does not bring when it is not committed. */
const localFolders = [
  '.claude/rules',
  '.claude/agents',
  '.claude/commands',
  '.claude/hooks',
  '.claude/skills',
  '.agents/skills',
  '.codex/skills',
  '.kiro/skills',
  '.grok/skills',
];
const localFiles = [
  'CLAUDE.local.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  'AGENTS.override.md',
  '.mcp.json',
  'opencode.json',
  'opencode.jsonc',
  '.codex/config.toml',
  '.kiro/settings/mcp.json',
  '.grok/config.toml',
  '.agents/mcp_config.json',
];
const globalRoots = [
  '.claude',
  '.agents',
  '.codex',
  '.kiro',
  '.gemini',
  '.grok',
  '.config/opencode',
] as const;
type GlobalRoot = (typeof globalRoots)[number];
const globalGuidanceFiles: [GlobalRoot, string][] = [
  ['.claude', 'CLAUDE.md'],
  ['.codex', 'AGENTS.md'],
  ['.gemini', 'GEMINI.md'],
];
const globalSettingsFiles: [GlobalRoot, string][] = [['.claude', 'settings.json']];
const privateName = /(^|\/)(?:settings\.local\.json|\.env(?:\.[^/]*)?)$/;
const refusedGlobalSettings = [
  ['~/.claude.json', 'Holds Claude Code account and project trust; sign in on the server instead.'],
  ['~/.codex/config.toml', 'Holds Codex project trust; trust projects on the server yourself.'],
];

const SafePath = z
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
  }, 'Copied paths must stay inside their folder.');
const CopiedFile = z.object({
  path: SafePath,
  content: z.string().max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4),
  executable: z.boolean().default(false),
});
const Files = z.array(CopiedFile).max(MAX_COPY_FILES);
const KitRequest = z.object({
  entryIds: z.array(z.string().min(1).max(150)).max(MAX_PROJECT_KIT_ENTRIES),
  providers: ProvidersSchema,
  presetId: z.string().max(100).optional(),
  requirements: z.string().max(10000).optional(),
});
const ProjectRequest = z.object({
  repository: z.string().min(1).max(300),
  sourceProject: z.string().min(1).max(4096),
  kit: KitRequest.optional(),
  memory: Files.optional(),
  localFiles: Files.optional(),
});
const SyncRequestSchema = z.object({
  library: z.unknown(),
  sourceHome: z.string().min(1).max(4096),
  projects: z.array(ProjectRequest).max(MAX_SYNC_PROJECTS),
  globalFiles: z
    .array(CopiedFile.extend({ root: z.enum(globalRoots) }))
    .max(MAX_COPY_FILES)
    .optional(),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
type CopiedFiles = z.infer<typeof Files>;
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
  localPlanId?: string;
  localFiles?: number;
  localError?: string;
}
export interface PreparedGlobal {
  root: string;
  planId?: string;
  files?: number;
  error?: string;
}

class FileBudget {
  private bytes = 0;
  private count = 0;
  constructor(private readonly withheld: Withheld[]) {}
  async read(absolute: string, name: string, scanSecrets: boolean) {
    const info = await lstat(absolute).catch(() => undefined);
    if (!info?.isFile()) return;
    if (info.size > MAX_FILE_BYTES) return this.hold(name, 'Larger than 1 MiB.');
    if (this.count >= MAX_COPY_FILES || this.bytes + info.size > MAX_BUNDLE_FILE_BYTES)
      return this.hold(name, 'The sync bundle is full; sync fewer projects at once.');
    const bytes = await readLocalBytes(absolute, MAX_FILE_BYTES);
    if (scanSecrets) {
      const text = bytes.toString('utf8');
      if (redact(text) !== text) return this.hold(name, 'Possible credential; set it up by hand.');
    }
    this.count++;
    this.bytes += bytes.length;
    return { content: bytes.toString('base64'), executable: (info.mode & 0o111) !== 0 };
  }
  hold(name: string, reason: string): undefined {
    this.withheld.push({ id: name, name, reason });
    return undefined;
  }
}

async function folderFiles(base: string, folder: string): Promise<string[]> {
  const entries = await readdir(join(base, folder), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(base, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();
}

async function trackedFiles(project: string, paths: string[]): Promise<Set<string> | undefined> {
  if (!paths.length) return new Set();
  const git = Bun.which('git');
  if (!git) return;
  const child = Bun.spawn(
    [git, '-C', project, 'ls-files', '-z', '--', ...localFolders, ...localFiles],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    },
  );
  const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
  try {
    const output = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? new Set(output.split('\0').filter(Boolean)) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function collectLocalFiles(
  project: { path: string; name: string },
  managed: Set<string>,
  budget: FileBudget,
): Promise<CopiedFiles | undefined> {
  const candidates = [
    ...(await Promise.all(localFolders.map((folder) => folderFiles(project.path, folder)))).flat(),
    ...localFiles,
  ];
  const tracked = await trackedFiles(project.path, candidates);
  if (!tracked) return;
  const files: CopiedFiles = [];
  for (const path of candidates) {
    if (tracked.has(path) || managed.has(path)) continue;
    const name = `${project.name}/${path}`;
    if (privateName.test(path)) {
      if (await lstat(join(project.path, path)).catch(() => undefined))
        budget.hold(name, 'Private local settings; set them up by hand.');
      continue;
    }
    const scanSecrets = !/^\.[a-z]+\/skills\//.test(path);
    const read = await budget.read(join(project.path, path), name, scanSecrets);
    if (read) files.push({ path, ...read });
  }
  return files;
}

/** Lists `skills/<name>/…` files, following a Skill folder that is a link inside the same home. */
async function skillFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(join(root, 'skills'), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const folder = await realpath(join(root, 'skills', entry.name)).catch(() => undefined);
    if (!folder || !(await lstat(folder)).isDirectory()) continue;
    for (const path of await folderFiles(folder, '.')) files.push(`skills/${entry.name}/${path}`);
  }
  return files;
}

async function collectMemory(home: string, project: string, budget: FileBudget) {
  const folder = join(home, '.claude/projects', claudeMemoryKey(project), 'memory');
  const files: CopiedFiles = [];
  for (const path of await folderFiles(folder, '.')) {
    const read = await budget.read(join(folder, path), `memory/${path}`, true);
    if (read) files.push({ path, ...read });
  }
  return files;
}

export async function buildSyncRequest(
  store: Store,
  roots: string[],
  options: {
    home?: string;
    memory?: string[];
    localFiles?: boolean;
    globalGuidance?: boolean;
    globalSettings?: boolean;
    globalSkills?: boolean;
  } = {},
): Promise<{
  request: SyncRequest;
  skipped: { name: string; reason: string }[];
  withheld: Withheld[];
}> {
  const home = options.home ?? homedir();
  const withMemory = new Set(options.memory ?? []);
  const skipped: { name: string; reason: string }[] = [];
  const withheld: Withheld[] = [];
  const budget = new FileBudget(withheld);
  const projects: SyncRequest['projects'] = [];
  for (const project of await machineProjects(roots)) {
    if (!project.repository) {
      skipped.push({ name: project.name, reason: 'no Git origin to match on the server' });
      continue;
    }
    const kit = await readKit(project.path).catch(() => undefined);
    const local =
      options.localFiles === false
        ? undefined
        : await collectLocalFiles(project, new Set(Object.keys(kit?.hashes ?? {})), budget);
    if (local === undefined && options.localFiles !== false)
      skipped.push({
        name: project.name,
        reason: 'Git could not list tracked files; local files were not sent',
      });
    const memory =
      withMemory.has(project.name) || withMemory.has(project.repository)
        ? await collectMemory(home, project.path, budget)
        : undefined;
    if (!kit && !local?.length && !memory?.length) {
      skipped.push({ name: project.name, reason: 'no Rigshelf kit or local agent files here' });
      continue;
    }
    projects.push({
      repository: project.repository,
      sourceProject: project.path,
      ...(kit
        ? {
            kit: {
              entryIds: kit.entries.map((entry) => entry.id),
              providers: kit.providers,
              presetId: kit.presetId,
              requirements: kit.requirements,
            },
          }
        : {}),
      ...(local?.length ? { localFiles: local } : {}),
      ...(memory ? { memory } : {}),
    });
  }
  const globalFiles: NonNullable<SyncRequest['globalFiles']> = [];
  const addGlobal = async (root: GlobalRoot, path: string, scanSecrets: boolean) => {
    const read = await budget.read(join(home, root, path), `~/${root}/${path}`, scanSecrets);
    if (read) globalFiles.push({ root, path, ...read });
  };
  if (options.globalGuidance)
    for (const [root, path] of globalGuidanceFiles) await addGlobal(root, path, true);
  if (options.globalSettings) {
    for (const [root, path] of globalSettingsFiles) await addGlobal(root, path, true);
    for (const [name, reason] of refusedGlobalSettings) budget.hold(name!, reason!);
  }
  if (options.globalSkills)
    for (const root of globalRoots)
      for (const path of await skillFiles(join(home, root))) await addGlobal(root, path, false);
  const exported = exportLibrary(store);
  const wanted = new Set(projects.flatMap((project) => project.kit?.entryIds ?? []));
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
  for (const project of projects)
    if (project.kit) project.kit.entryIds = project.kit.entryIds.filter((id) => sent.has(id));
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
      sourceHome: home,
      projects,
      ...(globalFiles.length ? { globalFiles } : {}),
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

/** Text is re-mapped from the sending machine's paths; files that are not UTF-8 text are copied unchanged. */
function remapped(content: string, remap: [string, string][]): Buffer {
  const bytes = Buffer.from(content, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return bytes;
  return Buffer.from(remap.reduce((value, [from, to]) => value.split(from).join(to), text));
}

async function copyPlan(
  store: Store,
  root: string,
  prefix: string,
  files: CopiedFiles,
  remap: [string, string][],
  reason: string,
): Promise<Plan | undefined> {
  const changes: Change[] = [];
  for (const file of files) {
    const path = prefix ? `${prefix}/${file.path}` : file.path;
    const target = await assertWritePath(root, path);
    const after = remapped(file.content, remap);
    const before = await planFile(target);
    if (before?.equals(after)) continue;
    const mode = before ? (await lstat(target)).mode & 0o777 : undefined;
    changes.push({
      path,
      beforeHash: before ? hash(before) : null,
      before: before ? before.toString('base64') : null,
      after: after.toString('base64'),
      reason,
      beforeMode: mode,
      afterMode: file.executable ? 0o700 : (mode ?? 0o600),
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
    warnings: ['Files that exist only on this machine are kept.'],
    status: 'planned',
    purpose: 'document',
    rootIdentity: await rootIdentity(root),
    createdDirectories: await missingDirectories(root, changes),
  };
  store.put('plan', plan);
  store.event('sync.planned', `${changes.length} copied files under ${root}`);
  return plan;
}

async function copyResult(
  work: () => Promise<Plan | undefined>,
): Promise<{ planId?: string; files: number } | { error: string }> {
  try {
    const plan = await work();
    return { planId: plan?.id, files: plan?.changes.length ?? 0 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not prepare the copy.' };
  }
}

async function existingFolder(path: string, missing: string): Promise<string> {
  if (!(await lstat(path).catch(() => undefined))?.isDirectory()) throw new Error(missing);
  return path;
}

/** Runs on the server: imports the sent Library additively, then prepares plans per matched clone without writing files. */
export async function prepareSync(
  store: Store,
  raw: unknown,
  roots: string[],
  options: { replaceDirectives?: boolean; home?: string } = {},
) {
  const request = SyncRequestSchema.parse(raw);
  const home = options.home ?? homedir();
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
    const remap: [string, string][] = [
      [project.sourceProject, clone.path],
      [request.sourceHome, home],
    ];
    const result: PreparedProject = { repository: project.repository, path: clone.path };
    if (project.kit)
      try {
        const plan = await createPlan(store, {
          projectPath: clone.path,
          providers: project.kit.providers,
          entryIds: project.kit.entryIds,
          presetId:
            project.kit.presetId && store.get('preset', project.kit.presetId)
              ? project.kit.presetId
              : undefined,
          requirements: project.kit.requirements ?? '',
          includeRules: true,
          allowReviewed: true,
        });
        Object.assign(result, {
          planId: plan.id,
          files: plan.changes.length,
          warnings: plan.warnings,
        });
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Could not prepare the plan.';
      }
    if (project.localFiles) {
      const local = await copyResult(() =>
        copyPlan(
          store,
          clone.path,
          '',
          project.localFiles!,
          remap,
          'Copy a local agent file that Git does not track',
        ),
      );
      Object.assign(
        result,
        'error' in local
          ? { localError: local.error }
          : { localPlanId: local.planId, localFiles: local.files },
      );
    }
    if (project.memory) {
      const memory = await copyResult(async () =>
        copyPlan(
          store,
          await existingFolder(
            join(home, '.claude/projects'),
            'Claude Code has not created ~/.claude/projects here yet. Run Claude Code once, then sync memory.',
          ),
          `${claudeMemoryKey(clone.path)}/memory`,
          project.memory!,
          remap,
          'Sync opted-in Claude memory from the other machine',
        ),
      );
      Object.assign(
        result,
        'error' in memory
          ? { memoryError: memory.error }
          : { memoryPlanId: memory.planId, memoryFiles: memory.files },
      );
    }
    projects.push(result);
  }
  const global: PreparedGlobal[] = [];
  for (const root of new Set((request.globalFiles ?? []).map((file) => file.root))) {
    const files = (request.globalFiles ?? []).filter((file) => file.root === root);
    const copied = await copyResult(async () =>
      copyPlan(
        store,
        await existingFolder(
          join(home, root),
          `~/${root} does not exist here; install that agent first.`,
        ),
        '',
        files,
        [[request.sourceHome, home]],
        'Copy global agent configuration from the other machine',
      ),
    );
    global.push({ root, ...copied });
  }
  return { library: { entries: library.entries }, directives, projects, global };
}
