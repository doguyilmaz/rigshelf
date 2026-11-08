import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { VERSION } from '../version';
import { ignoredDirectories, instructionNames, skillPaths } from './inventory-paths';
import { readLocalBytes } from './local-files';
import { mentionsPath, replacePaths } from './machine-paths';
import { claudeMemoryKey } from './memory-locations';
import { redact } from './safety';
import type { Store } from './store';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 50_000;
const MAX_FILES_PER_FOLDER = 2_000;
const MAX_PROJECTS = 300;
const MAX_PROJECT_DEPTH = 4;
const MAX_INVENTORY_TEXT = 32 * 1024 * 1024;

export const machineGroups = ['skill', 'guidance', 'mcp', 'settings', 'rules', 'memory'] as const;
export type MachineGroup = (typeof machineGroups)[number];
const privacyLevels = ['portable', 'machine-specific', 'private'] as const;
type Privacy = (typeof privacyLevels)[number];

const RelativeKey = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes('\0') &&
      !value.includes('\\') &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Inventory keys must be relative paths inside their root.',
  );
const ItemSchema = z.object({
  key: RelativeKey,
  group: z.enum(machineGroups),
  harness: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.number().int().min(0).max(MAX_FILES_PER_FOLDER),
  bytes: z.number().int().min(0),
  privacy: z.enum(privacyLevels),
});
const InventorySchema = z.object({
  version: z.literal(1),
  rigshelf: z.string().max(50),
  global: z.array(ItemSchema).max(MAX_ITEMS),
  projects: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        repository: z.string().max(300).nullable(),
        items: z.array(ItemSchema).max(MAX_ITEMS),
      }),
    )
    .max(MAX_PROJECTS),
});
export type MachineItem = z.infer<typeof ItemSchema>;
export type MachineInventory = z.infer<typeof InventorySchema>;
export type MachineProject = MachineInventory['projects'][number];

export function parseMachineInventory(text: string): MachineInventory {
  if (text.length > MAX_INVENTORY_TEXT) throw new Error('The machine inventory is too large.');
  return InventorySchema.parse(JSON.parse(text));
}

const globalFiles: [string, MachineGroup, string][] = [
  ['.claude/CLAUDE.md', 'guidance', 'claude'],
  ['.claude/settings.json', 'settings', 'claude'],
  ['.claude.json', 'settings', 'claude'],
  ['.codex/AGENTS.md', 'guidance', 'codex'],
  ['.codex/config.toml', 'settings', 'codex'],
  ['.kiro/settings/mcp.json', 'mcp', 'kiro'],
  ['.config/opencode/opencode.json', 'settings', 'opencode'],
  ['.gemini/GEMINI.md', 'guidance', 'gemini'],
  ['.gemini/settings.json', 'settings', 'gemini'],
  ['.grok/config.toml', 'settings', 'grok'],
];
const projectFiles: [string, MachineGroup, string][] = [
  ['.mcp.json', 'mcp', 'claude'],
  ['.claude/settings.json', 'settings', 'claude'],
  ['.claude/settings.local.json', 'settings', 'claude'],
  ['.codex/config.toml', 'mcp', 'codex'],
  ['.kiro/settings/mcp.json', 'mcp', 'kiro'],
  ['opencode.json', 'mcp', 'opencode'],
  ['opencode.jsonc', 'mcp', 'opencode'],
  ['.agents/mcp_config.json', 'mcp', 'antigravity'],
  ['.grok/config.toml', 'mcp', 'grok'],
];
const globalSkillRoots: [string, string][] = [
  ...skillPaths,
  ['.config/opencode/skills', 'opencode'],
];
const ruleFolders = ['rules', 'agents', 'commands', 'hooks'];
const privateName = /(^|\/)(?:\.claude\.json|settings\.local\.json|\.env(?:\.[^/]*)?)$/;
interface Hashed {
  digest: string;
  bytes: number;
  privacy: Privacy;
}

function privacyOf(key: string, bytes: Buffer, roots: string[], scanSecrets: boolean): Privacy {
  if (privateName.test(key)) return 'private';
  const text = bytes.toString('utf8');
  if (scanSecrets && redact(text) !== text) return 'private';
  return roots.some((root) => mentionsPath(text, root)) ? 'machine-specific' : 'portable';
}

async function hashFile(
  path: string,
  key: string,
  roots: string[],
  scanSecrets = true,
): Promise<Hashed | undefined> {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return;
  const bytes = await readLocalBytes(path, MAX_FILE_BYTES);
  const privacy = privacyOf(key, bytes, roots, scanSecrets);
  return {
    digest: createHash('sha256')
      .update(
        privacy === 'machine-specific' ? withoutMachinePaths(bytes.toString('utf8'), roots) : bytes,
      )
      .digest('hex'),
    bytes: bytes.length,
    privacy,
  };
}

/** `roots[0]` is the home folder; a scan root that is the home folder itself counts as home. */
function withoutMachinePaths(text: string, roots: string[]): string {
  const [home, ...others] = roots;
  return replacePaths(text, [
    ...others.filter((root) => root !== home).map((root): [string, string] => [root, '\0root\0']),
    ...(home ? [[home, '\0home\0'] as [string, string]] : []),
  ]);
}

async function folderFiles(folder: string, base = folder, out: string[] = []): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (out.length >= MAX_FILES_PER_FOLDER) break;
    const path = join(folder, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
      await folderFiles(path, base, out);
    else if (entry.isFile()) out.push(relative(base, path).split('\\').join('/'));
  }
  return out;
}

const rank = (privacy: Privacy) => privacyLevels.indexOf(privacy);

/** A Skill folder digest covers each file's relative path and bytes, so a moved or renamed file counts as a change. */
async function hashFolder(
  folder: string,
  key: string,
  roots: string[],
): Promise<Hashed | undefined> {
  const target = await realpath(folder).catch(() => undefined);
  if (!target || !(await lstat(target)).isDirectory()) return;
  const files = await folderFiles(target);
  if (!files.length) return;
  const digest = createHash('sha256');
  let bytes = 0;
  let privacy: Privacy = 'portable';
  for (const file of files) {
    const hashed = await hashFile(join(target, file), `${key}/${file}`, roots, false);
    if (!hashed) continue;
    digest.update(`${file}\0${hashed.digest}\n`);
    bytes += hashed.bytes;
    if (rank(hashed.privacy) > rank(privacy)) privacy = hashed.privacy;
  }
  return { digest: digest.digest('hex'), bytes, privacy };
}

async function skillItems(root: string, roots: [string, string][], identity: string[]) {
  const items: MachineItem[] = [];
  for (const [folder, harness] of roots)
    for (const entry of await readdir(join(root, folder), { withFileTypes: true }).catch(
      () => [],
    )) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const key = `${folder}/${entry.name}`;
      const hashed = await hashFolder(join(root, key), key, identity);
      if (hashed)
        items.push({
          key,
          group: 'skill',
          harness,
          files: (await folderFiles(await realpath(join(root, key)))).length,
          ...hashed,
        });
    }
  return items;
}

async function fileItems(
  root: string,
  files: [string, MachineGroup, string][],
  identity: string[],
) {
  const items: MachineItem[] = [];
  for (const [key, group, harness] of files) {
    const hashed = await hashFile(join(root, key), key, identity);
    if (hashed) items.push({ key, group, harness, files: 1, ...hashed });
  }
  return items;
}

async function ruleItems(root: string, prefix: string, identity: string[]) {
  const items: MachineItem[] = [];
  for (const folder of ruleFolders)
    for (const file of await folderFiles(join(root, folder))) {
      const hashed = await hashFile(
        join(root, folder, file),
        `${prefix}${folder}/${file}`,
        identity,
      );
      if (hashed)
        items.push({
          key: `${prefix}${folder}/${file}`,
          group: 'rules',
          harness: 'claude',
          files: 1,
          ...hashed,
        });
    }
  return items;
}

async function gitConfigPath(project: string): Promise<string | undefined> {
  const marker = join(project, '.git');
  const info = await lstat(marker).catch(() => undefined);
  if (info?.isDirectory()) return join(marker, 'config');
  if (!info?.isFile()) return;
  const pointer = (await readLocalBytes(marker, 8192)).toString('utf8').trim();
  if (!pointer.startsWith('gitdir: ')) return;
  const gitdir = resolve(project, pointer.slice(8));
  return basename(dirname(gitdir)) === 'worktrees'
    ? join(dirname(dirname(gitdir)), 'config')
    : join(gitdir, 'config');
}

export async function repositoryKey(project: string): Promise<string | undefined> {
  const config = await gitConfigPath(project);
  if (!config) return;
  const text = await readLocalBytes(config, 64 * 1024)
    .then((bytes) => bytes.toString('utf8'))
    .catch(() => '');
  const url = text.match(/\[remote "origin"\][^[]*?^\s*url\s*=\s*(\S+)/m)?.[1];
  if (!url) return;
  return url
    .replace(/^[a-z][\w+.-]*:\/\/(?:[^@/]+@)?/i, '')
    .replace(/^(?:[^@/]+@)?([^:/]+):(?!\d+\/)/, '$1/')
    .replace(/^([^/:]+):\d+\//, '$1/')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
}

async function findProjects(root: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (out.length >= MAX_PROJECTS) return out;
  if (await lstat(join(root, '.git')).catch(() => undefined)) {
    out.push(root);
    return out;
  }
  if (depth >= MAX_PROJECT_DEPTH) return out;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)))
    if (entry.isDirectory() && !entry.name.startsWith('.') && !ignoredDirectories.has(entry.name))
      await findProjects(join(root, entry.name), depth + 1, out);
  return out;
}

export async function inventoryRoots(store: Store, roots?: string[]): Promise<string[]> {
  const candidates = roots?.length ? roots : store.settings().roots;
  const existing = [];
  for (const root of candidates)
    if ((await lstat(root).catch(() => undefined))?.isDirectory()) existing.push(root);
  return existing.length ? existing : [homedir()];
}

export async function machineProjects(
  roots: string[],
): Promise<{ path: string; name: string; repository: string | null }[]> {
  const projects: string[] = [];
  for (const root of roots) await findProjects(resolve(root), 0, projects);
  return Promise.all(
    projects.slice(0, MAX_PROJECTS).map(async (path) => ({
      path,
      name: basename(path),
      repository: (await repositoryKey(path)) ?? null,
    })),
  );
}

async function projectInventory(project: string, home: string): Promise<MachineProject> {
  const identity = [home, project];
  const memory = join(home, '.claude/projects', claudeMemoryKey(project), 'memory');
  const memoryItems: MachineItem[] = [];
  for (const file of await folderFiles(memory)) {
    const hashed = await hashFile(join(memory, file), `memory/${file}`, identity);
    if (hashed)
      memoryItems.push({
        key: `memory/${file}`,
        group: 'memory',
        harness: 'claude',
        files: 1,
        ...hashed,
        privacy: hashed.privacy === 'private' ? 'private' : 'machine-specific',
      });
  }
  return {
    name: basename(project),
    repository: (await repositoryKey(project)) ?? null,
    items: [
      ...(await skillItems(project, skillPaths, identity)),
      ...(await fileItems(
        project,
        [...instructionNames].map((name) => [
          name,
          'guidance',
          name.startsWith('CLAUDE') ? 'claude' : 'shared',
        ]),
        identity,
      )),
      ...(await fileItems(project, projectFiles, identity)),
      ...(await ruleItems(join(project, '.claude'), '.claude/', identity)),
      ...memoryItems,
    ],
  };
}

export async function buildMachineInventory(options: {
  home: string;
  roots: string[];
}): Promise<MachineInventory> {
  const { home } = options;
  const projects: string[] = [];
  for (const root of options.roots) await findProjects(resolve(root), 0, projects);
  const identity = [home, ...options.roots.map((root) => resolve(root))];
  return {
    version: 1,
    rigshelf: VERSION,
    global: [
      ...(await skillItems(home, globalSkillRoots, identity)),
      ...(await fileItems(home, globalFiles, identity)),
      ...(await ruleItems(join(home, '.claude'), '.claude/', identity)),
    ],
    projects: await Promise.all(
      projects.slice(0, MAX_PROJECTS).map((project) => projectInventory(project, home)),
    ),
  };
}
