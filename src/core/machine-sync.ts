import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { exportLibrary, importLibrary } from './backup';
import { ignoredDirectories } from './inventory-paths';
import { readKit } from './kit';
import { MAX_PROJECT_KIT_ENTRIES } from './kit-limits';
import { readLocalBytes } from './local-files';
import {
  folderFiles,
  importedGuidance,
  type MachineInventory,
  machineProjects,
} from './machine-inventory';
import { replacePaths } from './machine-paths';
import {
  accountFiles,
  CLAUDE_MANAGED_SKILLS,
  claudeRuleFolders,
  SETTINGS_COMMAND_KEYS as commandKeys,
  type GlobalRoot,
  globalGuidanceFiles,
  globalRoots,
  skillRoots,
} from './machine-scope';
import { claudeMemoryKey } from './memory-locations';
import { type Change, type Plan, ProvidersSchema, type Rule, RuleSchema } from './model';
import { rootIdentity } from './ownership';
import { planFile } from './plan-limits';
import { createPlan, missingDirectories } from './planner';
import {
  assertWritePath,
  hash,
  hasKnownSecretFormat,
  inside,
  now,
  redact,
  safeRelative,
} from './safety';
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
const CLAUDE_SETTINGS = 'settings.json';

const privateName = /(^|\/)(?:settings\.local\.json|\.env(?:\.[^/]*)?)$/;
/** Skill docs are reference text: their examples (`token: process.env.X`) are not credentials. Scripts are scanned fully. */
const skillDoc = (path: string) =>
  /(?:^|\/)skills\//.test(path) && /\.(?:md|mdx|txt|rst)$/i.test(path);
const MCP_APPROVAL = /enableAllProjectMcpServers|enabledMcpjsonServers/;
const MCP_APPROVAL_REASON = 'Approves MCP servers; approve them on the server yourself.';
const CONFIG_FILE = /\.(?:json|jsonc|toml)$/;
/** Only agent configuration can approve servers; Skills and guidance may mention these keys. */
const grantsMcpApproval = (path: string, text: string) =>
  CONFIG_FILE.test(path) &&
  MCP_APPROVAL.test(
    text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    ),
  );
const noMcpApproval = (file: { path: string; content: string }) =>
  !grantsMcpApproval(file.path, Buffer.from(file.content, 'base64').toString('utf8'));
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
  }, 'Copied paths must stay inside their folder.')
  .refine(
    (value) =>
      !privateName.test(value) && !value.split('/').some((part) => ignoredDirectories.has(part)),
    'Copied paths must not include private files, Git metadata or dependency folders.',
  );
const CopiedFileShape = z.object({
  path: SafePath,
  content: z.string().max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4),
  executable: z.boolean().default(false),
});
const CopiedFile = CopiedFileShape.refine(noMcpApproval, MCP_APPROVAL_REASON);
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
  settingsCommands: z.boolean().default(false),
  globalFiles: z
    .array(
      CopiedFileShape.extend({ root: z.enum(globalRoots) })
        .refine(noMcpApproval, MCP_APPROVAL_REASON)
        .refine(
          (file) => !(file.root === '.codex' && file.path === 'config.toml'),
          'Codex configuration holds project trust and is never copied.',
        ),
    )
    .max(MAX_COPY_FILES)
    .optional(),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
type CopiedFiles = z.infer<typeof Files>;
type Withheld = { id: string; name: string; reason: string };
export interface PreparedProject {
  repository: string;
  skipped?: string[];
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
  skipped?: string[];
  planId?: string;
  files?: number;
  error?: string;
}

class FileBudget {
  private bytes = 0;
  private count = 0;
  constructor(private readonly withheld: Withheld[]) {}
  /** Skill files are reference text, so only recognizable credential formats hold them back. */
  async read(absolute: string, name: string, reference = false) {
    const info = await lstat(absolute).catch(() => undefined);
    if (!info?.isFile()) return;
    if (privateName.test(name)) return this.hold(name, 'Private file; set it up by hand.');
    if (info.size > MAX_FILE_BYTES) return this.hold(name, 'Larger than 1 MiB.');
    if (this.count >= MAX_COPY_FILES || this.bytes + info.size > MAX_BUNDLE_FILE_BYTES)
      return this.hold(name, 'The sync bundle is full; sync fewer projects at once.');
    const bytes = await readLocalBytes(absolute, MAX_FILE_BYTES);
    const text = bytes.toString('utf8');
    if (reference ? hasKnownSecretFormat(text) : redact(text) !== text)
      return this.hold(name, 'Possible credential; set it up by hand.');
    if (grantsMcpApproval(name, text)) return this.hold(name, MCP_APPROVAL_REASON);
    this.count++;
    this.bytes += bytes.length;
    return { content: bytes.toString('base64'), executable: (info.mode & 0o111) !== 0 };
  }
  hold(name: string, reason: string): undefined {
    this.withheld.push({ id: name, name, reason });
    return undefined;
  }
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
    ...(
      await Promise.all(
        localFolders.map((folder) =>
          folderFiles(join(project.path, folder), project.path, Infinity),
        ),
      )
    ).flat(),
    ...localFiles,
  ];
  const tracked = await trackedFiles(project.path, candidates);
  if (!tracked) return;
  const files: CopiedFiles = [];
  for (const path of candidates) {
    if (tracked.has(path) || managed.has(path)) continue;
    const read = await budget.read(
      join(project.path, path),
      `${project.name}/${path}`,
      skillDoc(path),
    );
    if (read) files.push({ path, ...read });
  }
  return files;
}

/** Lists `skills/<name>/…` files; a linked Skill folder is followed only to a Skill inside the same home. */
async function skillFiles(home: string, root: string, budget: FileBudget): Promise<string[]> {
  const files: string[] = [];
  const realHome = await realpath(home).catch(() => home);
  const entries = await readdir(join(root, 'skills'), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    if (`${relative(home, root)}/skills/${entry.name}` === CLAUDE_MANAGED_SKILLS) continue;
    const name = `~/${relative(home, root)}/skills/${entry.name}`;
    const folder = await realpath(join(root, 'skills', entry.name)).catch(() => undefined);
    if (!folder || !(await lstat(folder)).isDirectory()) continue;
    if (folder === realHome || !inside(realHome, folder)) {
      budget.hold(name, 'Links outside the home folder are not followed; copy it by hand.');
      continue;
    }
    if (!(await lstat(join(folder, 'SKILL.md')).catch(() => undefined))?.isFile()) {
      budget.hold(name, 'No SKILL.md at the top of this folder.');
      continue;
    }
    for (const path of await folderFiles(folder, folder, Infinity))
      files.push(`skills/${entry.name}/${path}`);
  }
  return files;
}

async function collectMemory(home: string, project: string, budget: FileBudget) {
  const folder = join(home, '.claude/projects', claudeMemoryKey(project), 'memory');
  const files: CopiedFiles = [];
  for (const path of await folderFiles(folder, folder, Infinity)) {
    const read = await budget.read(join(folder, path), `memory/${path}`);
    if (read) files.push({ path, ...read });
  }
  return files;
}

export interface SyncScope {
  home?: string;
  /** Untracked agent files in each project; on by default. */
  localFiles?: boolean;
  /** Claude memory of each matched project; on by default. */
  memory?: boolean;
  /** Global guidance, Claude settings and Skills; on by default. */
  global?: boolean;
  /** Hooks and status line commands from Claude settings; off by default. */
  commands?: boolean;
  /** Agents installed on the server; Skills go to `.agents` and their folders. Unset fills every folder. */
  remoteAgents?: string[];
  /** Repository keys the server has a clone of; other projects are never read. */
  onlyRepositories?: Iterable<string>;
}

function parsedSettings(base64: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function withoutCommands(base64: string): { content: string; removed: string[] } | undefined {
  const settings = parsedSettings(base64);
  if (!settings) return;
  const removed = commandKeys.filter((key) => key in settings);
  if (!removed.length) return { content: base64, removed };
  for (const key of removed) delete settings[key];
  return {
    content: Buffer.from(`${JSON.stringify(settings, null, 2)}\n`).toString('base64'),
    removed,
  };
}

export function serverRepositories(inventory: MachineInventory): string[] {
  return inventory.projects.flatMap((project) => (project.repository ? [project.repository] : []));
}

export async function buildSyncRequest(
  store: Store,
  roots: string[],
  options: SyncScope = {},
): Promise<{
  request: SyncRequest;
  skipped: { name: string; reason: string }[];
  withheld: Withheld[];
}> {
  const home = options.home ?? homedir();
  const skipped: { name: string; reason: string }[] = [];
  const withheld: Withheld[] = [];
  const budget = new FileBudget(withheld);
  const projects: SyncRequest['projects'] = [];
  const onServer = options.onlyRepositories && new Set(options.onlyRepositories);
  for (const project of await machineProjects(roots)) {
    if (!project.repository) {
      skipped.push({ name: project.name, reason: 'no Git origin to match on the server' });
      continue;
    }
    if (onServer && !onServer.has(project.repository)) {
      skipped.push({ name: project.name, reason: 'no matching project on the server' });
      continue;
    }
    if (projects.some((sent) => sent.repository === project.repository)) {
      skipped.push({
        name: project.name,
        reason: 'another checkout of this repository is already sent',
      });
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
      options.memory === false ? undefined : await collectMemory(home, project.path, budget);
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
      ...(memory?.length ? { memory } : {}),
    });
  }
  const globalFiles: NonNullable<SyncRequest['globalFiles']> = [];
  const addGlobal = async (root: GlobalRoot, path: string) => {
    const read = await budget.read(join(home, root, path), `~/${root}/${path}`, skillDoc(path));
    if (read) globalFiles.push({ root, path, ...read });
  };
  if (options.global ?? true) {
    const installed = (agent: string) =>
      !options.remoteAgents || options.remoteAgents.includes(agent);
    for (const [root, path, agent] of [...globalGuidanceFiles, ...(await importedGuidance(home))])
      if (installed(agent)) await addGlobal(root, path);
    if (installed('claude')) {
      await addGlobal('.claude', CLAUDE_SETTINGS);
      for (const folder of [...claudeRuleFolders, ...(options.commands ? ['hooks'] : [])])
        for (const path of await folderFiles(
          join(home, '.claude', folder),
          join(home, '.claude'),
          Infinity,
        ))
          await addGlobal('.claude', path);
    }
    const settings = globalFiles.find(
      (file) => file.root === '.claude' && file.path === CLAUDE_SETTINGS,
    );
    if (settings && !options.commands) {
      const stripped = withoutCommands(settings.content);
      if (stripped === undefined) {
        globalFiles.splice(globalFiles.indexOf(settings), 1);
        budget.hold('~/.claude/settings.json', 'Not valid JSON; copy it by hand.');
      } else if (stripped.removed.length) {
        settings.content = stripped.content;
        budget.hold(
          `~/.claude/settings.json ${stripped.removed.join(', ')}`,
          'Runs commands; the server keeps its own unless you send them with hooks.',
        );
      }
    }
    for (const [key, reason] of accountFiles)
      if (await lstat(join(home, key)).catch(() => undefined)) budget.hold(`~/${key}`, reason);
    for (const root of skillRoots(options.remoteAgents))
      for (const path of await skillFiles(home, join(home, root), budget))
        await addGlobal(root, path);
  }
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
      settingsCommands: options.commands ?? false,
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
  return Buffer.from(replacePaths(text, remap));
}

async function copyPlan(
  store: Store,
  root: string,
  prefix: string,
  files: CopiedFiles,
  remap: [string, string][],
  reason: string,
): Promise<{ plan?: Plan; skipped: string[] }> {
  const changes: Change[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const path = prefix ? `${prefix}/${file.path}` : file.path;
    const target = await assertWritePath(root, path).catch((error: Error) => {
      skipped.push(`${path}: ${error.message}`);
      return undefined;
    });
    if (!target) continue;
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
  if (!changes.length) return { skipped };
  const plan: Plan = {
    id: randomUUID(),
    projectPath: root,
    providers: [],
    entries: [],
    createdAt: now(),
    changes,
    warnings: [
      'Files that exist only on this machine are kept.',
      ...skipped.map((value) => `Skipped ${value}`),
    ],
    status: 'planned',
    purpose: 'document',
    rootIdentity: await rootIdentity(root),
    createdDirectories: await missingDirectories(root, changes),
  };
  store.put('plan', plan);
  store.event('sync.planned', `${changes.length} copied files under ${root}`);
  return { plan, skipped };
}

async function copyResult(
  work: () => Promise<{ plan?: Plan; skipped: string[] }>,
): Promise<{ planId?: string; files: number; skipped: string[] } | { error: string }> {
  try {
    const { plan, skipped } = await work();
    return { planId: plan?.id, files: plan?.changes.length ?? 0, skipped };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not prepare the copy.' };
  }
}

/** A folder to write into; a link is followed only to a folder inside the same home, such as a dotfiles checkout. */
async function writableFolder(path: string, home: string, missing: string): Promise<string> {
  const info = await lstat(path).catch(() => undefined);
  if (info?.isSymbolicLink()) {
    const target = await realpath(path).catch(() => undefined);
    const realHome = await realpath(home).catch(() => home);
    if (!target || target === realHome || !inside(realHome, target))
      throw new Error(`${path} links outside the home folder; Rigshelf does not write there.`);
    if (!(await lstat(target)).isDirectory()) throw new Error(missing);
    return target;
  }
  if (!info?.isDirectory()) throw new Error(missing);
  return path;
}

/** `.agents` is a plain shared folder, so an empty one is created when missing; agent folders must exist first. */
async function globalTarget(home: string, root: GlobalRoot) {
  const path = join(home, root);
  if (root === '.agents' && !(await lstat(path).catch(() => undefined)))
    await mkdir(path, { mode: 0o755 });
  return writableFolder(path, home, `~/${root} does not exist here; install that agent first.`);
}

/** Without sent commands, the server keeps its own hooks and status line. */
async function keepServerCommands(file: { content: string }, existing: string): Promise<string> {
  const incoming = parsedSettings(file.content);
  const current = parsedSettings(
    (await planFile(existing).catch(() => undefined))?.toString('base64') ?? '',
  );
  if (!incoming || !current) return file.content;
  const kept = commandKeys.filter((key) => key in current && !(key in incoming));
  if (!kept.length) return file.content;
  for (const key of kept) incoming[key] = current[key];
  return Buffer.from(`${JSON.stringify(incoming, null, 2)}\n`).toString('base64');
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
    const skipped: string[] = [];
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
      if ('skipped' in local) skipped.push(...local.skipped);
    }
    if (project.memory) {
      const memory = await copyResult(async () =>
        copyPlan(
          store,
          await writableFolder(
            join(home, '.claude/projects'),
            home,
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
      if ('skipped' in memory) skipped.push(...memory.skipped);
    }
    if (skipped.length) result.skipped = skipped;
    projects.push(result);
  }
  const global: PreparedGlobal[] = [];
  for (const root of new Set((request.globalFiles ?? []).map((file) => file.root))) {
    const files = (request.globalFiles ?? []).filter((file) => file.root === root);
    const copied = await copyResult(async () => {
      const folder = await globalTarget(home, root);
      if (root === '.claude' && !request.settingsCommands)
        for (const file of files)
          if (file.path === CLAUDE_SETTINGS)
            file.content = await keepServerCommands(file, join(folder, CLAUDE_SETTINGS));
      return copyPlan(
        store,
        folder,
        '',
        files,
        [[request.sourceHome, home]],
        'Copy global agent configuration from the other machine',
      );
    });
    global.push({
      root,
      ...('error' in copied
        ? copied
        : {
            planId: copied.planId,
            files: copied.files,
            ...(copied.skipped.length ? { skipped: copied.skipped } : {}),
          }),
    });
  }
  return { library: { entries: library.entries }, directives, projects, global };
}
