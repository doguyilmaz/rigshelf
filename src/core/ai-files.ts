import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { mergedGuidance, nativeAiFiles } from './guidance-inventory';
import {
  type AiConfigRoot,
  ignoredDirectories,
  privateRuntimeDirectories,
  skillPaths,
} from './inventory-paths';
import type { DocumentLocation } from './model';
import { inside } from './safety';

const MAX_PLUGIN_DIRECTORIES = 4096;
const MAX_PLUGIN_DEPTH = 6;
const MAX_PLUGINS = 256;
const MAX_FILES = 4096;
export interface AiFileInventory {
  files: DocumentLocation[];
  warnings: string[];
  plugins: { path: string; provider: string }[];
}

async function pluginRoots(
  root: string,
  boundaries: string[],
  warnings: string[],
): Promise<string[]> {
  const pending = [{ path: root, depth: 0 }];
  const visited = new Set<string>();
  const found: string[] = [];
  let limited = false;
  while (pending.length && visited.size < MAX_PLUGIN_DIRECTORIES && found.length < MAX_PLUGINS) {
    const current = pending.shift()!;
    const canonical = await realpath(current.path).catch(() => undefined);
    if (!canonical || visited.has(canonical)) continue;
    if (
      !boundaries.some(
        (base) =>
          inside(base, canonical) &&
          !relative(base, canonical)
            .split(sep)
            .some((part) => ignoredDirectories.has(part) || privateRuntimeDirectories.has(part)),
      ) ||
      canonical.split(sep).some((part) => ['.ssh', '.aws', '.gnupg', '.azure'].includes(part))
    ) {
      warnings.push(`${current.path}: External or private Plugin directory excluded.`);
      continue;
    }
    visited.add(canonical);
    const entries = await readdir(current.path, { withFileTypes: true }).catch(() => []);
    const marker =
      (await lstat(join(current.path, '.claude-plugin/plugin.json')).catch(() => undefined)) ||
      (await lstat(join(current.path, '.codex-plugin/plugin.json')).catch(() => undefined));
    if (
      marker?.isFile() ||
      (current.depth >= 2 &&
        entries.some(
          (entry) => entry.isDirectory() && ['agents', 'commands', 'hooks'].includes(entry.name),
        ))
    ) {
      found.push(current.path);
      continue;
    }
    if (current.depth >= MAX_PLUGIN_DEPTH) {
      limited ||= entries.some((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
      continue;
    }
    for (const entry of entries)
      if (
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        !entry.name.startsWith('.') &&
        !ignoredDirectories.has(entry.name) &&
        !privateRuntimeDirectories.has(entry.name)
      ) {
        if (pending.length + visited.size >= MAX_PLUGIN_DIRECTORIES) {
          limited = true;
          break;
        }
        pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
  }
  if (limited || pending.length)
    warnings.push(`${root}: Plugin discovery limit reached; inventory is partial.`);
  return found;
}

async function appendNative(
  result: AiFileInventory,
  directory: string,
  provider: string,
  roots: string[],
  project?: string,
) {
  if (result.files.length >= MAX_FILES) {
    const warning = 'AI file limit reached; inventory is partial.';
    if (!result.warnings.includes(warning)) result.warnings.push(warning);
    return;
  }
  if (!(await lstat(directory).catch(() => undefined))) return;
  const value = await nativeAiFiles(
    directory,
    {
      base: project || directory,
      project,
      provider,
      scope: project ? 'project' : 'global',
      kind: 'config',
    },
    roots,
  );
  const combined = mergedGuidance(result.files, value.files);
  result.files = combined.slice(0, MAX_FILES);
  result.warnings.push(...value.warnings);
  if (combined.length > MAX_FILES)
    result.warnings.push('AI file limit reached; inventory is partial.');
}

export async function projectAiFiles(
  project: string,
  contexts: string[],
  configRoots: AiConfigRoot[],
): Promise<AiFileInventory> {
  const result: AiFileInventory = { files: [], warnings: [], plugins: [] };
  const roots = [project, ...configRoots.map((root) => root.path)];
  const canonical = (
    await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)))
  ).filter((root): root is string => Boolean(root));
  for (const directory of contexts) {
    await appendNative(result, directory, 'project', roots, project);
    await appendNative(result, join(directory, '.vscode'), 'copilot', roots, project);
    for (const [name, provider] of skillPaths) {
      const config = join(directory, name.split('/')[0]!);
      await appendNative(result, config, provider, roots, project);
      if (!['claude', 'codex'].includes(provider)) continue;
      for (const path of await pluginRoots(join(config, 'plugins'), canonical, result.warnings))
        result.plugins.push({ path, provider: `${provider}-plugin` });
    }
    if (
      (
        await lstat(join(directory, '.claude-plugin/plugin.json')).catch(() => undefined)
      )?.isFile() ||
      (await lstat(join(directory, '.codex-plugin/plugin.json')).catch(() => undefined))?.isFile()
    )
      result.plugins.push({ path: directory, provider: 'native-plugin' });
  }
  for (const plugin of result.plugins)
    await appendNative(result, plugin.path, plugin.provider, roots, project);
  result.files = mergedGuidance(result.files);
  result.warnings = [...new Set(result.warnings)];
  return result;
}

export async function globalAiFiles(configRoots: AiConfigRoot[]): Promise<AiFileInventory> {
  const result: AiFileInventory = { files: [], warnings: [], plugins: [] };
  const roots = configRoots.map((root) => root.path);
  const canonical = (
    await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)))
  ).filter((root): root is string => Boolean(root));
  for (const root of configRoots) {
    await appendNative(result, root.path, root.provider, roots);
    if (!['claude', 'codex'].includes(root.provider)) continue;
    for (const name of ['cache', 'marketplaces'])
      for (const path of await pluginRoots(
        join(root.path, 'plugins', name),
        canonical,
        result.warnings,
      ))
        result.plugins.push({ path, provider: `${root.provider}-plugin` });
  }
  for (const plugin of result.plugins)
    await appendNative(result, plugin.path, plugin.provider, roots);
  result.files = mergedGuidance(result.files);
  result.warnings = [...new Set(result.warnings)];
  return result;
}
