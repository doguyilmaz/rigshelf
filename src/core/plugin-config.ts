import { readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiConfigRoot } from './inventory-paths';
import type { Project } from './model';
import { readPluginFile } from './plugin-files';
import { nativePluginId, type PluginRegistry, readPluginRegistry } from './plugin-manifests';
import type { PluginReference } from './plugin-model';
import { object, readConfig } from './providers';

interface PluginConfig {
  path: string;
  provider: PluginReference['provider'];
  project?: Project;
  scope: 'user' | 'project' | 'local';
  refs: { id: string; enabled?: boolean; modulePath?: string }[];
  complete: boolean;
}
const MAX_PLUGIN_REFS = 2048;
const moduleName = (value: string) =>
  value.length > 0 && value.length <= 200 && !/[\0\r\n]/.test(value);
const definitions = {
  claude: [
    ['settings.json', 'json'],
    ['settings.local.json', 'json'],
  ],
  codex: [['config.toml', 'toml']],
  opencode: [
    ['opencode.json', 'jsonc'],
    ['opencode.jsonc', 'jsonc'],
  ],
} as const;

export async function pluginRegistries(
  roots: AiConfigRoot[],
  boundaries: string[],
  warnings: string[],
): Promise<PluginRegistry[]> {
  const result: PluginRegistry[] = [];
  const seen = new Set<string>();
  for (const root of roots.filter((root) => root.provider === 'claude')) {
    const registry = await readPluginRegistry(
      join(root.path, 'plugins/installed_plugins.json'),
      boundaries,
      warnings,
    );
    if (registry && !seen.has(registry.path)) {
      result.push(registry);
      seen.add(registry.path);
    }
  }
  return result;
}

export async function pluginConfigs(
  roots: AiConfigRoot[],
  projects: { project: Project; contexts: string[] }[],
  boundaries: string[],
  warnings: string[],
): Promise<PluginConfig[]> {
  const candidates: {
    path: string;
    provider: keyof typeof definitions;
    format: 'json' | 'toml' | 'jsonc';
    project?: Project;
    scope: PluginConfig['scope'];
  }[] = [];
  for (const root of roots) {
    if (!Object.hasOwn(definitions, root.provider)) continue;
    const provider = root.provider as keyof typeof definitions;
    for (const [name, format] of definitions[provider])
      if (name !== 'settings.local.json')
        candidates.push({ path: join(root.path, name), provider, format, scope: 'user' });
  }
  for (const { project, contexts } of [...projects].sort(
    (left, right) => right.project.path.length - left.project.path.length,
  ))
    for (const context of contexts)
      for (const provider of ['claude', 'codex', 'opencode'] as const) {
        const base = join(context, `.${provider}`);
        for (const [name, format] of definitions[provider]) {
          candidates.push({
            path: join(base, name),
            provider,
            format,
            project,
            scope: name === 'settings.local.json' ? 'local' : 'project',
          });
          if (provider === 'opencode')
            candidates.push({
              path: join(context, name),
              provider,
              format,
              project,
              scope: 'project',
            });
        }
      }
  const seen = new Set<string>();
  const result: PluginConfig[] = [];
  for (const candidate of candidates) {
    const canonical = await realpath(candidate.path).catch(() => undefined);
    if (canonical && seen.has(`${candidate.provider}:${canonical}`)) continue;
    const file = await readPluginFile(candidate.path, boundaries, warnings);
    if (!file || seen.has(`${candidate.provider}:${file.path}`)) continue;
    seen.add(`${candidate.provider}:${file.path}`);
    try {
      const raw = readConfig(file.text, candidate.format);
      const value =
        raw[
          candidate.provider === 'claude'
            ? 'enabledPlugins'
            : candidate.provider === 'codex'
              ? 'plugins'
              : 'plugin'
        ];
      const refs: PluginConfig['refs'] = [];
      let complete = true;
      if (candidate.provider === 'opencode') {
        if (value !== undefined && !Array.isArray(value)) complete = false;
        const values = Array.isArray(value) ? value : [];
        if (values.length > MAX_PLUGIN_REFS) complete = false;
        for (const item of values.slice(0, MAX_PLUGIN_REFS)) {
          if (typeof item !== 'string') {
            complete = false;
            continue;
          }
          if (
            item.startsWith('file:') ||
            item.startsWith('./') ||
            item.startsWith('../') ||
            item.startsWith('/')
          ) {
            try {
              const path = item.startsWith('file:')
                ? fileURLToPath(item)
                : resolve(dirname(file.path), item);
              if (!moduleName(basename(path))) {
                complete = false;
                continue;
              }
              refs.push({ id: basename(path), modulePath: path, enabled: true });
            } catch {
              complete = false;
            }
          } else if (nativePluginId(item) && !item.includes(':'))
            refs.push({ id: item, enabled: true });
          else complete = false;
        }
      } else {
        if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
          complete = false;
        const entries = Object.entries(object(value));
        if (entries.length > MAX_PLUGIN_REFS) complete = false;
        for (const [id, entry] of entries.slice(0, MAX_PLUGIN_REFS)) {
          const enabled = candidate.provider === 'claude' ? entry : object(entry).enabled;
          if (!nativePluginId(id) || typeof enabled !== 'boolean') {
            complete = false;
            continue;
          }
          refs.push({ id, enabled });
        }
      }
      if (!complete)
        warnings.push(
          `${file.path}: Invalid or excessive Plugin declarations; previous inventory retained.`,
        );
      result.push({ ...candidate, path: file.path, refs, complete });
    } catch {
      warnings.push(
        `${file.path}: Plugin settings could not be parsed; previous inventory retained.`,
      );
    }
  }
  return result;
}

export async function localPluginModules(
  root: string,
  boundaries: string[],
  warnings: string[],
): Promise<{ path: string; text: string }[]> {
  const result: { path: string; text: string }[] = [];
  const directories = ['plugins', 'plugin'];
  for (const name of directories) {
    const entries = await readdir(join(root, name), { withFileTypes: true }).catch(
      (error: unknown) => {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            ['ENOENT', 'ENOTDIR'].includes(String(error.code))
          )
        )
          warnings.push(
            `${root}: Local Plugin directory unavailable; previous inventory retained.`,
          );
        return [];
      },
    );
    if (entries.length > MAX_PLUGIN_REFS)
      warnings.push(`${root}: Local Plugin module limit reached; inventory is partial.`);
    for (const entry of entries.slice(0, MAX_PLUGIN_REFS))
      if ((entry.isFile() || entry.isSymbolicLink()) && /\.[cm]?[jt]s$/i.test(entry.name)) {
        if (!moduleName(entry.name)) {
          warnings.push(
            `${root}: Unsupported local Plugin module name; previous inventory retained.`,
          );
          continue;
        }
        const file = await readPluginFile(join(root, name, entry.name), boundaries, warnings);
        if (file) result.push(file);
      }
  }
  return result;
}
