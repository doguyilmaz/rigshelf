import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { readPluginFile } from './plugin-files';
import type { PluginReference } from './plugin-model';
import { object } from './providers';
import { hash, redact } from './safety';

const pluginManifestNames = [
  'plugin.json',
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
] as const;
export interface PluginManifest {
  file: string;
  name: string;
  description: string;
  version?: string;
  format: PluginReference['manifest'];
  components: PluginReference['components'];
  contentDigest: string;
  skills: string[];
}
export const nativePluginId = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length <= 200 &&
  /^[A-Za-z0-9@][A-Za-z0-9@._:/+-]*$/.test(value)
    ? value
    : undefined;
const pluginVersion = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(value) ? value : undefined;
export const portablePlugin = (value: Record<string, unknown>): boolean =>
  typeof value.$schema === 'string' &&
  /^https:\/\/agent-plugins\.org\/schemas\/[\w.-]+\/plugin\.schema\.json$/.test(value.$schema);

export async function inspectPluginManifest(
  root: string,
  boundaries: string[],
  warnings: string[],
): Promise<PluginManifest | undefined> {
  for (const name of pluginManifestNames) {
    const file = await readPluginFile(join(root, name), boundaries, warnings);
    if (!file) continue;
    let raw: Record<string, unknown>;
    try {
      raw = object(JSON.parse(file.text));
    } catch {
      warnings.push(`${file.path}: Invalid Plugin manifest; other locations were still inspected.`);
      continue;
    }
    if (name === 'plugin.json' && !portablePlugin(raw)) continue;
    const identifier = nativePluginId(raw.name);
    if (!identifier || identifier.includes('/') || identifier.includes('@')) {
      warnings.push(`${file.path}: Invalid Plugin name; previous inventory retained.`);
      continue;
    }
    const components = new Set<PluginReference['components'][number]>();
    const extension = name === 'plugin.json' ? object(object(raw.extensions)['com.openai']) : raw;
    for (const component of [
      'skills',
      'agents',
      'commands',
      'hooks',
      'apps',
      'extensions',
    ] as const)
      if (
        raw[component] !== undefined ||
        extension[component] !== undefined ||
        (await lstat(join(root, component)).catch(() => undefined))?.isDirectory()
      )
        components.add(component);
    if (
      raw.mcpServers !== undefined ||
      extension.mcpServers !== undefined ||
      (await lstat(join(root, '.mcp.json')).catch(() => undefined)) ||
      (await lstat(join(root, 'mcp.json')).catch(() => undefined))
    )
      components.add('mcp');
    const skills =
      name === 'plugin.json' ? [] : Array.isArray(raw.skills) ? raw.skills : [raw.skills];
    return {
      file: file.path,
      name: identifier,
      description:
        typeof raw.description === 'string' ? redact(raw.description).slice(0, 2000) : '',
      version: pluginVersion(raw.version),
      format: name === 'plugin.json' ? 'portable' : name.startsWith('.codex') ? 'codex' : 'claude',
      components: [...components],
      contentDigest: hash(file.text),
      skills: [
        ...new Set([
          'skills',
          ...skills.filter((value): value is string => typeof value === 'string'),
        ]),
      ],
    };
  }
  return;
}

export interface PluginRegistryRecord {
  nativeId: string;
  scope: 'user' | 'project' | 'local';
  installPath?: string;
  projectPath?: string;
  version?: string;
}
export interface PluginRegistry {
  path: string;
  records: PluginRegistryRecord[];
  complete: boolean;
}
export async function readPluginRegistry(
  path: string,
  boundaries: string[],
  warnings: string[],
): Promise<PluginRegistry | undefined> {
  const file = await readPluginFile(path, boundaries, warnings);
  if (!file) return;
  let raw: Record<string, unknown>;
  try {
    raw = object(JSON.parse(file.text));
  } catch {
    warnings.push(
      `${file.path}: Invalid Plugin installation registry; previous inventory retained.`,
    );
    return;
  }
  if (
    (raw.version !== 1 && raw.version !== 2) ||
    !raw.plugins ||
    typeof raw.plugins !== 'object' ||
    Array.isArray(raw.plugins)
  ) {
    warnings.push(`${file.path}: Unsupported Plugin registry format; previous inventory retained.`);
    return;
  }
  const records: PluginRegistryRecord[] = [];
  let complete = true;
  const entries = Object.entries(object(raw.plugins));
  if (entries.length > 2048) complete = false;
  for (const [identifier, values] of entries.slice(0, 2048)) {
    if (!nativePluginId(identifier)) {
      complete = false;
      continue;
    }
    const locations = Array.isArray(values) ? values : [values];
    if (locations.length > 1024) complete = false;
    for (const value of locations.slice(0, 1024)) {
      const record = object(value);
      const scope = record.scope ?? (raw.version === 1 ? 'user' : undefined);
      const validPath = (value: unknown): value is string =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 4096 &&
        !/[\0\r\n]/.test(value);
      if (
        !['user', 'project', 'local'].includes(String(scope)) ||
        (scope !== 'user' && (!validPath(record.projectPath) || !isAbsolute(record.projectPath)))
      ) {
        complete = false;
        continue;
      }
      if (
        record.installPath !== undefined &&
        (!validPath(record.installPath) || !isAbsolute(record.installPath))
      )
        complete = false;
      records.push({
        nativeId: identifier,
        scope: scope as PluginRegistryRecord['scope'],
        installPath:
          validPath(record.installPath) && isAbsolute(record.installPath)
            ? record.installPath
            : undefined,
        projectPath: scope === 'user' ? undefined : (record.projectPath as string),
        version: pluginVersion(record.version),
      });
    }
  }
  if (!complete)
    warnings.push(
      `${file.path}: Plugin registry contains invalid entries or exceeds limits; previous inventory retained.`,
    );
  return { path: file.path, records, complete };
}
