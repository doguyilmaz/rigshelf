import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  type AiConfigRoot,
  aiDirectoryNames,
  dependencyDirectories,
  ignoredDirectories,
  instructionNames,
  privateRuntimeDirectories,
} from './inventory-paths';
import { claudeMemoryKey, configuredMemoryDirectory, memoryProjectPaths } from './memory-locations';
import { type DocumentLocation, MAX_TEXT_BYTES } from './model';
import { readPluginFile } from './plugin-files';
import { portablePlugin } from './plugin-manifests';
import { hash, inside } from './safety';

const MAX_DIRECTORIES = 4096;
const MAX_CONTEXTS = 256;
const MAX_DOCUMENTS = 2048;
const MAX_CANDIDATES = MAX_DOCUMENTS * 8;
const MAX_DEPTH = 12;
const MAX_AI_DEPTH = 5;
const ruleDirectories = [
  '.claude/rules',
  '.codex/rules',
  '.agents/rules',
  '.agent/rules',
  '.gemini/rules',
  '.cursor/rules',
  '.kiro/steering',
  '.kiro/rules',
  '.windsurf/rules',
  '.clinerules',
  '.roo/rules',
  '.continue/rules',
  '.github/instructions',
  '.aims/rules',
];
const memoryDirectories = [
  '.claude/memory',
  '.claude/agent-memory',
  '.claude/agent-memory-local',
  '.agents/memory',
  '.codex/memory',
  '.aims/memory',
  '.ai/memory',
];
type Context = Pick<DocumentLocation, 'scope' | 'provider' | 'kind'> & {
  base: string;
  project?: string;
};
type Boundary = { root: string; identity: string };
async function aiCanonicalPath(path: string, warnings: string[]): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ENOTDIR'].includes(String(error.code))
      )
    )
      warnings.push(`${path}: AI location unavailable; inventory is partial.`);
    return;
  }
}
async function aiDirectoryEntries(path: string, warnings: string[]): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ENOTDIR'].includes(String(error.code))
      )
    )
      warnings.push(`${path}: AI directory unavailable; inventory is partial.`);
    return [];
  }
}
function excludedLocation(root: string, canonical: string): boolean {
  return (
    canonical.split(sep).some((part) => ['.ssh', '.aws', '.gnupg', '.azure'].includes(part)) ||
    canonical.split(sep).some((part) => dependencyDirectories.has(part)) ||
    relative(root, canonical)
      .split(sep)
      .some((part) => privateRuntimeDirectories.has(part))
  );
}
interface ProjectAiContexts {
  paths: string[];
  warnings: string[];
}

/** Read directory names only; source files and dependency/build/cache directories are never read. */
export async function projectAiContexts(root: string): Promise<ProjectAiContexts> {
  const paths = new Set([root]);
  const warnings: string[] = [];
  const pending = [{ path: root, depth: 0 }];
  let visited = 0;
  let limited = false;
  const unity =
    (
      await lstat(join(root, 'ProjectSettings/ProjectVersion.txt')).catch(() => undefined)
    )?.isFile() && (await lstat(join(root, 'Assets')).catch(() => undefined))?.isDirectory();
  const generated = unity
    ? new Set([
        'Library',
        'Temp',
        'Obj',
        'obj',
        'Logs',
        'Build',
        'Builds',
        'MemoryCaptures',
        'Recordings',
      ])
    : new Set<string>();
  while (pending.length && visited < MAX_DIRECTORIES && paths.size < MAX_CONTEXTS) {
    const current = pending.shift()!;
    visited++;
    let entries: Dirent[];
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      warnings.push(`${current.path}: AI directory discovery unavailable.`);
      continue;
    }
    if (
      entries.some((entry) => instructionNames.has(entry.name) || aiDirectoryNames.has(entry.name))
    )
      paths.add(current.path);
    if (current.depth >= MAX_DEPTH) {
      if (
        entries.some(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !ignoredDirectories.has(entry.name) &&
            (current.path !== root || !generated.has(entry.name)),
        )
      )
        warnings.push(`${current.path}: Nested AI discovery depth limit reached.`);
      continue;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        ignoredDirectories.has(entry.name) ||
        (current.path === root && generated.has(entry.name))
      )
        continue;
      if (pending.length + visited >= MAX_DIRECTORIES) {
        limited = true;
        break;
      }
      pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }
  if (pending.length || limited)
    warnings.push(
      `${root}: AI directory discovery limit reached (visited ${visited}/${MAX_DIRECTORIES} directories, found ${paths.size}/${MAX_CONTEXTS} AI locations); inventory is partial.`,
    );
  return { paths: [...paths], warnings };
}

async function boundaries(roots: string[]): Promise<Boundary[]> {
  const result = new Map<string, Boundary>();
  for (const root of roots) {
    const canonical = await realpath(root).catch(() => undefined);
    if (!canonical || result.has(canonical)) continue;
    const info = await stat(canonical).catch(() => undefined);
    if (info?.isDirectory())
      result.set(canonical, { root: canonical, identity: `${info.dev}:${info.ino}` });
  }
  return [...result.values()].sort((left, right) => right.root.length - left.root.length);
}

async function describeFile(
  path: string,
  context: Context,
  allowed: Boundary[],
  warnings: string[],
): Promise<DocumentLocation | undefined> {
  const canonical = await aiCanonicalPath(path, warnings);
  if (!canonical) return;
  const boundary = allowed.find((item) => inside(item.root, canonical));
  if (!boundary) {
    warnings.push(`${path}: External instruction or memory link excluded.`);
    return;
  }
  if (
    excludedLocation(boundary.root, canonical) ||
    (!instructionNames.has(basename(canonical)) &&
      !(
        context.kind === 'config' || context.kind === 'plugin' || context.kind === 'hook'
          ? /\.(?:md|mdc|rules|jsonc?|toml|ya?ml|[cm]?[jt]s|sh|py|ps1)$/i
          : /\.(?:md|mdc|rules|toml|ya?ml)$/i
      ).test(canonical)) ||
    /^\.?(?:auth|credentials?|tokens?|secrets?)(?:[._-]|$)/i.test(basename(canonical)) ||
    (['config', 'plugin', 'hook'].includes(context.kind) && basename(canonical) !== basename(path))
  ) {
    warnings.push(`${path}: Non-guidance or private runtime target excluded.`);
    return;
  }
  const info = await lstat(canonical).catch(() => undefined);
  if (!info?.isFile()) return;
  if (info.nlink !== 1 || info.size > MAX_TEXT_BYTES) {
    warnings.push(`${path}: Linked or oversized instruction/memory file excluded.`);
    return;
  }
  const local = context.project && inside(resolve(context.project), canonical);
  const scope = context.scope === 'project' && !local ? 'global' : context.scope;
  return {
    id: `document-${hash(canonical).slice(0, 24)}`,
    path: relative(context.base, path).split('\\').join('/'),
    sourcePath: path,
    canonicalPath: canonical,
    root: boundary.root,
    rootIdentity: boundary.identity,
    relativePath: relative(boundary.root, canonical).split('\\').join('/'),
    scope,
    provider: context.provider,
    kind: context.kind,
    readOnly:
      scope !== 'project' ||
      canonical !== resolve(path) ||
      !['instruction', 'memory', 'rule'].includes(context.kind),
  };
}

function mergeFiles(files: DocumentLocation[]): DocumentLocation[] {
  const result = new Map<string, DocumentLocation>();
  for (const file of files) {
    const previous = result.get(file.id);
    if (!previous) result.set(file.id, file);
    else if (previous.sourcePath !== file.sourcePath)
      previous.aliases = [...new Set([...(previous.aliases || []), file.sourcePath])];
  }
  return [...result.values()];
}

async function markdownFiles(
  root: string,
  allowed: Boundary[],
  warnings: string[],
  pattern = /\.(?:md|mdc|rules)$/i,
): Promise<string[]> {
  const found: string[] = [];
  const visited = new Set<string>();
  async function visit(path: string, depth: number): Promise<void> {
    const canonical = await aiCanonicalPath(path, warnings);
    if (!canonical || visited.has(canonical)) return;
    const boundary = allowed.find((item) => inside(item.root, canonical));
    if (!boundary || excludedLocation(boundary.root, canonical)) {
      warnings.push(`${path}: External AI document directory excluded.`);
      return;
    }
    if (visited.size >= MAX_DIRECTORIES || depth > MAX_AI_DEPTH || found.length >= MAX_DOCUMENTS) {
      warnings.push(`${root}: AI document limit reached; inventory is partial.`);
      return;
    }
    visited.add(canonical);
    for (const entry of await aiDirectoryEntries(path, warnings)) {
      if (
        ignoredDirectories.has(entry.name) ||
        ['backups', 'runs', 'meter', 'rollout_summaries'].includes(entry.name)
      )
        continue;
      const child = join(path, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (pattern.test(entry.name)) found.push(child);
        else await visit(child, depth + 1);
      } else if (entry.isFile() && pattern.test(entry.name)) found.push(child);
      if (found.length >= MAX_DOCUMENTS) break;
    }
  }
  await visit(root, 0);
  return found;
}

async function collect(
  candidates: { path: string; context: Context }[],
  allowed: Boundary[],
  warnings: string[],
) {
  const files: DocumentLocation[] = [];
  if (candidates.length > MAX_CANDIDATES)
    warnings.push('Instruction/memory file limit reached; inventory is partial.');
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    if (files.length >= MAX_DOCUMENTS) {
      warnings.push('Instruction/memory file limit reached; inventory is partial.');
      break;
    }
    const file = await describeFile(candidate.path, candidate.context, allowed, warnings);
    if (file) files.push(file);
  }
  return mergeFiles(files);
}

export async function localGuidance(
  project: string,
  contexts: string[],
  userRoots: AiConfigRoot[] = [],
  home = homedir(),
) {
  const warnings: string[] = [];
  const allowed = await boundaries([project, ...userRoots.map((item) => item.path)]);
  const candidates: { path: string; context: Context }[] = [];
  for (const directory of contexts) {
    if (candidates.length >= MAX_CANDIDATES) {
      warnings.push(`${project}: AI document candidate limit reached; inventory is partial.`);
      break;
    }
    const context: Context = {
      base: project,
      project,
      scope: 'project',
      provider: 'project',
      kind: 'instruction',
    };
    for (const name of instructionNames)
      candidates.push({
        path: join(directory, name),
        context: {
          ...context,
          kind: /MEMORY/i.test(name) ? 'memory' : /rules$/i.test(name) ? 'rule' : 'instruction',
        },
      });
    for (const name of [
      '.claude/CLAUDE.md',
      '.claude/CLAUDE.local.md',
      '.claude/MEMORY.md',
      '.codex/AGENTS.md',
      '.github/copilot-instructions.md',
      '.aims/AGENTS.md',
      '.aims/MEMORY.md',
      '.ai/AGENTS.md',
      '.ai/MEMORY.md',
      '.gemini/GEMINI.md',
      '.agents/AGENTS.md',
      '.agent/AGENTS.md',
      '.opencode/AGENTS.md',
      '.kiro/AGENTS.md',
    ])
      candidates.push({
        path: join(directory, name),
        context: { ...context, kind: /MEMORY/i.test(name) ? 'memory' : 'instruction' },
      });
    for (const path of [...ruleDirectories, ...memoryDirectories])
      for (const file of await markdownFiles(join(directory, path), allowed, warnings))
        candidates.push({
          path: file,
          context: {
            ...context,
            provider: path.split('/')[0]!.replace(/^\./, ''),
            kind: memoryDirectories.includes(path) ? 'memory' : 'rule',
          },
        });
    for (const name of ['.claude/settings.json', '.claude/settings.local.json']) {
      const memory = await configuredMemoryDirectory(
        join(directory, name),
        home,
        [project, ...userRoots.map((root) => root.path)],
        warnings,
      );
      if (!memory) continue;
      const canonical = await realpath(memory).catch(() => undefined);
      if (!canonical || !allowed.some((root) => inside(root.root, canonical))) {
        warnings.push(
          `${memory}: Project-configured memory is outside the inspected AI roots; it was not followed.`,
        );
        continue;
      }
      const memoryContext: Context = inside(resolve(project), canonical)
        ? { ...context, kind: 'memory' }
        : { base: memory, scope: 'user-project', provider: 'claude', kind: 'memory' };
      for (const file of await markdownFiles(memory, allowed, warnings))
        candidates.push({ path: file, context: memoryContext });
    }
  }
  return { files: await collect(candidates, allowed, warnings), warnings };
}

export async function globalGuidance(roots: AiConfigRoot[], home = homedir()) {
  const warnings: string[] = [];
  const custom: { path: string; provider: string }[] = [];
  for (const root of roots.filter((item) => item.provider === 'claude')) {
    const path = await configuredMemoryDirectory(
      join(root.path, 'settings.json'),
      home,
      roots.map((item) => item.path),
      warnings,
    );
    if (path) custom.push({ path, provider: root.provider });
  }
  const allowed = await boundaries([
    ...roots.map((item) => item.path),
    ...custom.map((item) => item.path),
  ]);
  const candidates: { path: string; context: Context }[] = [];
  for (const root of roots) {
    if (candidates.length >= MAX_CANDIDATES) {
      warnings.push('Global AI document candidate limit reached; inventory is partial.');
      break;
    }
    const context: Context = {
      base: root.path,
      scope: 'global',
      provider: root.provider,
      kind: 'instruction',
    };
    for (const entry of await aiDirectoryEntries(root.path, warnings))
      if ((entry.isFile() || entry.isSymbolicLink()) && /\.md$/i.test(entry.name))
        candidates.push({
          path: join(root.path, entry.name),
          context: { ...context, kind: /memory/i.test(entry.name) ? 'memory' : 'instruction' },
        });
    for (const directory of ['rules', 'steering', 'memory', 'agent-memory'])
      for (const file of await markdownFiles(join(root.path, directory), allowed, warnings))
        candidates.push({
          path: file,
          context: { ...context, kind: directory.includes('memory') ? 'memory' : 'rule' },
        });
    if (root.provider === 'codex')
      for (const name of ['MEMORY.md', 'memory_summary.md'])
        candidates.push({
          path: join(root.path, 'memories', name),
          context: { ...context, kind: 'memory' },
        });
  }
  for (const memory of custom) {
    const context: Context = {
      base: memory.path,
      scope: 'global',
      provider: memory.provider,
      kind: 'memory',
    };
    for (const file of await markdownFiles(memory.path, allowed, warnings))
      candidates.push({ path: file, context });
  }
  return { files: await collect(candidates, allowed, warnings), warnings };
}

/** Exact full-path keys only: another repository with the same basename is never associated. */
export async function userProjectMemory(project: string, roots: AiConfigRoot[]) {
  const warnings: string[] = [];
  const allowed = await boundaries(roots.map((item) => item.path));
  const paths = await memoryProjectPaths(project);
  const candidates: { path: string; context: Context }[] = [];
  for (const root of roots.filter((item) => item.provider === 'claude'))
    for (const path of paths) {
      const key = root.memoryProjectName || claudeMemoryKey(path);
      const memory = join(root.path, 'projects', key, 'memory');
      const context: Context = {
        base: memory,
        scope: 'user-project',
        provider: 'claude',
        kind: 'memory',
      };
      for (const file of await markdownFiles(memory, allowed, warnings))
        candidates.push({ path: file, context });
    }
  return { files: await collect(candidates, allowed, warnings), warnings };
}

export function mergedGuidance(...groups: DocumentLocation[][]): DocumentLocation[] {
  return mergeFiles(groups.flat()).sort(
    (left, right) => left.scope.localeCompare(right.scope) || left.path.localeCompare(right.path),
  );
}

/** Known native files are data for inspection, never executable installation instructions. */
export async function nativeAiFiles(directory: string, context: Context, roots: string[]) {
  const warnings: string[] = [];
  const allowed = await boundaries(roots);
  const candidates: { path: string; context: Context }[] = [];
  const rootFiles =
    context.provider === 'project'
      ? ['.mcp.json', 'opencode.json', 'opencode.jsonc']
      : [
          'settings.json',
          'settings.local.json',
          'config.toml',
          'config.json',
          'opencode.json',
          'opencode.jsonc',
          'mcp.json',
          'mcp_config.json',
          'settings/mcp.json',
          '.mcp.json',
          '.lsp.json',
          'hooks.json',
          'plugins/installed_plugins.json',
          'plugins/known_marketplaces.json',
        ];
  for (const name of rootFiles)
    candidates.push({ path: join(directory, name), context: { ...context, kind: 'config' } });
  for (const name of [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.codex-plugin/plugin.json',
    '.codex-plugin/marketplace.json',
  ])
    candidates.push({ path: join(directory, name), context: { ...context, kind: 'plugin' } });
  const portable = await readPluginFile(
    join(directory, 'plugin.json'),
    allowed.map((boundary) => boundary.root),
    warnings,
  );
  if (portable) {
    try {
      if (portablePlugin(JSON.parse(portable.text)))
        candidates.push({ path: portable.path, context: { ...context, kind: 'plugin' } });
    } catch {
      warnings.push(`${portable.path}: Invalid portable Plugin manifest.`);
    }
  }
  if (context.provider !== 'project') {
    const groups = [
      ['agents', 'agent'],
      ['agent', 'agent'],
      ['commands', 'command'],
      ['command', 'command'],
      ['prompts', 'command'],
      ['workflows', 'command'],
      ['output-styles', 'instruction'],
      ['hooks', 'hook'],
    ] as const;
    for (const [name, kind] of groups)
      for (const path of await markdownFiles(
        join(directory, name),
        allowed,
        warnings,
        kind === 'hook' ? /\.(?:json|sh|py|[cm]?[jt]s|ps1)$/i : /\.(?:md|toml|ya?ml)$/i,
      ))
        candidates.push({ path, context: { ...context, kind } });
    for (const entry of await aiDirectoryEntries(join(directory, 'plugins'), warnings))
      if ((entry.isFile() || entry.isSymbolicLink()) && /\.[cm]?[jt]s$/i.test(entry.name))
        candidates.push({
          path: join(directory, 'plugins', entry.name),
          context: { ...context, kind: 'plugin' },
        });
  }
  return { files: await collect(candidates, allowed, warnings), warnings };
}
