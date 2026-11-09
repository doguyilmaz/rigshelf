import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { mergedGuidance, nativeAiFiles } from './guidance-inventory';
import {
  type AiConfigRoot,
  ignoredDirectories,
  privateRuntimeDirectories,
  skillPaths,
} from './inventory-paths';
import type { DocumentLocation } from './model';
import { readPluginFile } from './plugin-files';
import { portablePlugin } from './plugin-manifests';
import { object } from './providers';
import { inside } from './safety';

const MAX_PLUGIN_DIRECTORIES = 4096;
const MAX_PLUGIN_DEPTH = 6;
const MAX_PLUGINS = 256;
const MAX_FILES = 4096;
const MAX_CATALOG_ENTRIES = 2048;
export interface AiFileInventory {
  files: DocumentLocation[];
  warnings: string[];
  plugins: { path: string; provider: string }[];
}

async function catalogPackages(
  root: string,
  boundaries: string[],
  warnings: string[],
): Promise<string[] | undefined> {
  for (const name of [
    '.claude-plugin/marketplace.json',
    '.codex-plugin/marketplace.json',
    'marketplace.json',
  ]) {
    const file = await readPluginFile(join(root, name), boundaries, warnings);
    if (!file) continue;
    let raw: Record<string, unknown>;
    try {
      raw = object(JSON.parse(file.text));
    } catch {
      warnings.push(`${file.path}: Invalid marketplace catalog; inventory is partial.`);
      continue;
    }
    if (!Array.isArray(raw.plugins)) continue;
    if (raw.plugins.length > MAX_CATALOG_ENTRIES)
      warnings.push(
        `${file.path}: Marketplace entry limit reached (${MAX_CATALOG_ENTRIES}); inventory is partial.`,
      );
    const paths = new Set<string>();
    for (const item of raw.plugins.slice(0, MAX_CATALOG_ENTRIES)) {
      const source = object(item).source;
      if (typeof source !== 'string' || !(source === '.' || source.startsWith('./'))) continue;
      const target = resolve(root, source);
      if (inside(root, target)) paths.add(target);
      else warnings.push(`${file.path}: External marketplace package source excluded.`);
    }
    return [...paths];
  }
  return;
}

export async function pluginRoots(
  root: string,
  boundaries: string[],
  warnings: string[],
  layout: 'generic' | 'cache' = 'generic',
): Promise<string[]> {
  const pending: { path: string; depth: number; package: boolean; checkout?: string }[] = [
    { path: root, depth: 0, package: false },
  ];
  const visited = new Set<string>();
  const found: string[] = [];
  let limited = false;
  while (pending.length && visited.size < MAX_PLUGIN_DIRECTORIES && found.length < MAX_PLUGINS) {
    const current = pending.shift()!;
    const canonical = await realpath(current.path).catch(() => undefined);
    if (!canonical) {
      if (current.package)
        warnings.push(
          `${current.path}: Declared Plugin package unavailable; inventory is partial.`,
        );
      continue;
    }
    if (visited.has(canonical)) continue;
    if (current.checkout && !inside(current.checkout, canonical)) {
      warnings.push(`${current.path}: External marketplace package link excluded.`);
      continue;
    }
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
    const entries = await readdir(current.path, { withFileTypes: true }).catch(() => {
      warnings.push(`${current.path}: Plugin directory unavailable; inventory is partial.`);
      return [];
    });
    const markers = await Promise.all(
      ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].map((name) =>
        lstat(join(current.path, name)).catch(() => undefined),
      ),
    );
    let portable = false;
    if ((await lstat(join(current.path, 'plugin.json')).catch(() => undefined))?.isFile()) {
      const file = await readPluginFile(join(current.path, 'plugin.json'), boundaries, warnings);
      try {
        portable = Boolean(file && portablePlugin(JSON.parse(file.text)));
      } catch {
        warnings.push(`${current.path}: Invalid portable Plugin manifest.`);
      }
    }
    const cachedPackage = layout === 'cache' && current.depth === 3;
    if (
      markers.some((marker) => marker?.isFile()) ||
      portable ||
      current.package ||
      cachedPackage
    ) {
      found.push(current.path);
      if (!cachedPackage || markers.some((marker) => marker?.isFile()) || portable) continue;
    }
    const packages = await catalogPackages(canonical, boundaries, warnings);
    if (packages) {
      for (const path of packages) {
        if (pending.length + visited.size >= MAX_PLUGIN_DIRECTORIES) {
          limited = true;
          break;
        }
        if (path === canonical) {
          if (!found.includes(current.path)) found.push(current.path);
        } else pending.push({ path, depth: current.depth + 1, package: true, checkout: canonical });
      }
      continue;
    }
    if (cachedPackage) continue;
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
        pending.push({
          path: join(current.path, entry.name),
          depth: current.depth + 1,
          package: false,
        });
      }
  }
  if (limited || pending.length)
    warnings.push(
      `${root}: Plugin discovery limit reached (visited ${visited.size}/${MAX_PLUGIN_DIRECTORIES} directories, found ${found.length}/${MAX_PLUGINS} packages, maximum depth ${MAX_PLUGIN_DEPTH}); inventory is partial.`,
    );
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
      (
        await lstat(join(directory, '.codex-plugin/plugin.json')).catch(() => undefined)
      )?.isFile() ||
      (await inspectPortable(directory, canonical, result.warnings))
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
  const scanned = new Set<string>();
  for (const root of configRoots) {
    await appendNative(result, root.path, root.provider, roots);
    if (!['claude', 'codex'].includes(root.provider)) continue;
    for (const name of ['cache', 'marketplaces', 'bundled-marketplaces']) {
      const path = await realpath(join(root.path, 'plugins', name)).catch(() => undefined);
      if (!path || scanned.has(`${root.provider}:${path}`)) continue;
      scanned.add(`${root.provider}:${path}`);
      if (name !== 'cache')
        for (const entry of await readdir(join(root.path, 'plugins', name), {
          withFileTypes: true,
        }).catch(() => []))
          if (entry.isDirectory() || entry.isSymbolicLink())
            await appendNative(
              result,
              join(root.path, 'plugins', name, entry.name),
              root.provider,
              roots,
            );
      for (const path of await pluginRoots(
        join(root.path, 'plugins', name),
        canonical,
        result.warnings,
        name === 'cache' ? 'cache' : 'generic',
      ))
        result.plugins.push({ path, provider: `${root.provider}-plugin` });
    }
  }
  for (const plugin of result.plugins)
    await appendNative(result, plugin.path, plugin.provider, roots);
  result.files = mergedGuidance(result.files);
  result.warnings = [...new Set(result.warnings)];
  return result;
}

export async function inspectPortable(
  directory: string,
  roots: string[],
  warnings: string[],
): Promise<boolean> {
  const file = await readPluginFile(join(directory, 'plugin.json'), roots, warnings);
  if (!file) return false;
  try {
    return portablePlugin(JSON.parse(file.text));
  } catch {
    warnings.push(`${file.path}: Invalid portable Plugin manifest.`);
    return false;
  }
}
