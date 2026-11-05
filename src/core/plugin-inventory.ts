import { readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pluginRoots } from './ai-files';
import type { AiConfigRoot } from './inventory-paths';
import type { Entry, Project } from './model';
import { localPluginModules, pluginConfigs } from './plugin-config';
import { pluginPathAllowed, readPluginFile } from './plugin-files';
import {
  inspectPluginManifest,
  nativePluginId,
  type PluginManifest,
  type PluginRegistry,
} from './plugin-manifests';
import type { PluginEvidence, PluginReference } from './plugin-model';
import { pluginProject, recordPluginLocation, savePluginReference } from './plugin-records';
import { object } from './providers';
import { hash, inside } from './safety';
import type { Store } from './store';

type Provider = PluginReference['provider'];
interface PackageCandidate {
  path: string;
  provider: string;
  project?: Project;
  nativeId?: string;
  evidence?: PluginEvidence;
}
interface PackageRecord {
  root: string;
  provider: Provider;
  nativeId: string;
  manifest?: PluginManifest;
  entry: Entry;
}
interface PackageBase {
  path: string;
  provider: Provider;
  directory: 'cache' | 'marketplaces' | 'bundled-marketplaces';
}
export interface NativePluginInput {
  roots: AiConfigRoot[];
  projects: {
    project: Project;
    contexts: string[];
    plugins: { path: string; provider: string }[];
    partial: boolean;
  }[];
  globals?: { plugins: { path: string; provider: string }[]; partial: boolean };
  registries: PluginRegistry[];
  boundaries: string[];
  warnings: string[];
}
const MAX_NATIVE_PLUGIN_LOCATIONS = 10000;

async function marketplaceCandidates(input: NativePluginInput): Promise<PackageCandidate[]> {
  const candidates: PackageCandidate[] = [];
  const indexes = new Set<string>();
  for (const root of input.roots.filter((root) => ['claude', 'codex'].includes(root.provider))) {
    const locations: { path: string; name: string }[] = [];
    const known = await readPluginFile(
      join(root.path, 'plugins/known_marketplaces.json'),
      input.boundaries,
      input.warnings,
    );
    if (known) {
      try {
        for (const [name, value] of Object.entries(object(JSON.parse(known.text))).slice(0, 256)) {
          const path = object(value).installLocation;
          if (typeof path === 'string' && isAbsolute(path)) locations.push({ path, name });
        }
      } catch {
        input.warnings.push(
          `${known.path}: Invalid marketplace metadata; previous inventory retained.`,
        );
      }
    }
    for (const directory of ['marketplaces', 'bundled-marketplaces'])
      for (const entry of (
        await readdir(join(root.path, 'plugins', directory), { withFileTypes: true }).catch(
          () => [],
        )
      ).slice(0, 256))
        if (entry.isDirectory() || entry.isSymbolicLink())
          locations.push({
            path: join(root.path, 'plugins', directory, entry.name),
            name: entry.name,
          });
    for (const location of locations) {
      const canonical = await realpath(location.path).catch(() => undefined);
      if (!canonical || !pluginPathAllowed(canonical, input.boundaries)) {
        input.warnings.push(
          `${location.path}: Marketplace path outside the allowed AI/project roots was not read.`,
        );
        continue;
      }
      for (const path of await pluginRoots(canonical, input.boundaries, input.warnings))
        candidates.push({ path, provider: root.provider, evidence: 'catalog' });
      for (const manifest of [
        '.claude-plugin/marketplace.json',
        '.codex-plugin/marketplace.json',
        'marketplace.json',
      ]) {
        const file = await readPluginFile(
          join(canonical, manifest),
          input.boundaries,
          input.warnings,
        );
        if (!file || indexes.has(`${root.provider}:${file.path}`)) continue;
        indexes.add(`${root.provider}:${file.path}`);
        try {
          const raw = object(JSON.parse(file.text));
          const name = nativePluginId(raw.name) || nativePluginId(location.name);
          if (!name || !Array.isArray(raw.plugins)) continue;
          if (raw.plugins.length > 2048)
            input.warnings.push(
              `${file.path}: Marketplace entry limit reached; inventory is partial.`,
            );
          for (const value of raw.plugins.slice(0, 2048)) {
            const plugin = object(value);
            const pluginName = nativePluginId(plugin.name);
            if (!pluginName || typeof plugin.source !== 'string' || !plugin.source.startsWith('./'))
              continue;
            const path = resolve(canonical, plugin.source);
            if (!inside(canonical, path)) {
              input.warnings.push(`${file.path}: External marketplace package source excluded.`);
              continue;
            }
            candidates.push({
              path,
              provider: root.provider,
              nativeId: `${pluginName}@${name}`,
              evidence: 'catalog',
            });
          }
        } catch {
          input.warnings.push(
            `${file.path}: Invalid marketplace catalog; other packages were still inspected.`,
          );
        }
      }
    }
  }
  return candidates;
}

function packageIdentity(
  path: string,
  manifest: PluginManifest | undefined,
  candidate: PackageCandidate,
  bases: PackageBase[],
) {
  for (const base of bases) {
    if (!inside(base.path, path)) continue;
    const { directory, provider } = base;
    const evidence = directory === 'cache' ? ('cached' as const) : ('catalog' as const);
    const parts = relative(base.path, path).split(sep);
    if (directory === 'cache' && parts.length >= 2)
      return {
        nativeId: candidate.nativeId || `${parts[1]}@${parts[0]}`,
        evidence,
        provider,
      };
    if (evidence === 'catalog' && manifest)
      return {
        nativeId: candidate.nativeId || `${manifest.name}@${parts[0]}`,
        evidence,
        provider,
      };
  }
  return {
    nativeId: candidate.nativeId || manifest?.name,
    evidence: candidate.evidence || 'local',
    provider: candidate.provider.startsWith('codex') ? ('codex' as const) : ('claude' as const),
  };
}

async function collectPackages(
  store: Store,
  input: NativePluginInput,
  observed: Set<string>,
): Promise<PackageRecord[]> {
  const candidates: PackageCandidate[] = [
    ...(input.globals?.plugins || []),
    ...input.projects.flatMap(({ project, plugins }) =>
      plugins.map((plugin) => ({ ...plugin, project })),
    ),
    ...(await marketplaceCandidates(input)),
    ...input.registries.flatMap((registry) =>
      registry.records
        .filter((record) => record.installPath && isAbsolute(record.installPath))
        .map((record) => ({
          path: record.installPath!,
          provider: 'claude',
          nativeId: record.nativeId,
          evidence: 'local' as const,
        })),
    ),
  ];
  const result: PackageRecord[] = [];
  const seen = new Set<string>();
  const bases: PackageBase[] = [];
  for (const root of input.roots.filter((root) => ['claude', 'codex'].includes(root.provider)))
    for (const directory of ['cache', 'marketplaces', 'bundled-marketplaces'] as const) {
      const path = await realpath(join(root.path, 'plugins', directory)).catch(() => undefined);
      if (path && !bases.some((base) => base.provider === root.provider && base.path === path))
        bases.push({ path, provider: root.provider as Provider, directory });
    }
  const manifests = new Map<string, PluginManifest | undefined>();
  if (candidates.length > MAX_NATIVE_PLUGIN_LOCATIONS)
    input.warnings.push('Native Plugin package limit reached; previous inventory retained.');
  // Explicit native IDs from catalog/registry records take precedence over directory hints.
  candidates.sort(
    (left, right) => Number(Boolean(right.nativeId)) - Number(Boolean(left.nativeId)),
  );
  for (const candidate of candidates.slice(0, MAX_NATIVE_PLUGIN_LOCATIONS)) {
    const root = await realpath(candidate.path).catch(() => undefined);
    if (!root || !pluginPathAllowed(root, input.boundaries)) continue;
    if (!manifests.has(root))
      manifests.set(root, await inspectPluginManifest(root, input.boundaries, input.warnings));
    const manifest = manifests.get(root);
    const identity = packageIdentity(root, manifest, candidate, bases);
    const provider =
      candidate.provider === 'native-plugin' && manifest?.format === 'codex'
        ? 'codex'
        : identity.provider;
    if (
      !identity.nativeId ||
      !nativePluginId(identity.nativeId) ||
      seen.has(`${provider}:${root}:${identity.nativeId}`)
    )
      continue;
    if (!manifest && !candidate.nativeId) continue;
    seen.add(`${provider}:${root}:${identity.nativeId}`);
    const entry = savePluginReference(
      store,
      {
        format: 'kitfold-native-plugin-reference',
        provider,
        nativeId: identity.nativeId,
        version: manifest?.version,
        manifest: manifest?.format || 'reference',
        components: manifest?.components || [],
        contentDigest: manifest?.contentDigest,
      },
      manifest?.description,
    );
    const project =
      identity.evidence === 'local'
        ? candidate.project ||
          input.projects
            .map((value) => value.project)
            .filter((project) => inside(project.path, root))
            .sort((left, right) => right.path.length - left.path.length)[0]
        : undefined;
    recordPluginLocation(
      store,
      entry,
      manifest?.file || root,
      { nativeId: identity.nativeId, evidence: identity.evidence, version: manifest?.version },
      observed,
      project,
    );
    result.push({ root, provider, nativeId: identity.nativeId, manifest, entry });
  }
  return result;
}

function nativeReference(provider: Provider, nativeId: string, version?: string): PluginReference {
  return {
    format: 'kitfold-native-plugin-reference',
    provider,
    nativeId,
    version,
    manifest: 'reference',
    components: [],
  };
}

async function recordModule(
  store: Store,
  file: { path: string; text: string },
  observed: Set<string>,
  project?: Project,
  configuration?: string,
  enabled?: boolean,
  scope?: 'user' | 'project' | 'local',
) {
  const entry = savePluginReference(
    store,
    {
      ...nativeReference('opencode', basename(file.path)),
      manifest: 'module',
      contentDigest: hash(file.text),
    },
    'Local OpenCode Plugin module. Discovery reads metadata and never executes the module.',
  );
  recordPluginLocation(
    store,
    entry,
    configuration || file.path,
    {
      nativeId: entry.plugin!.nativeId,
      evidence: configuration ? 'configured' : 'local',
      enabled,
      declaredScope: scope,
    },
    observed,
    project,
  );
}

export async function inventoryNativePlugins(
  store: Store,
  input: NativePluginInput,
): Promise<{
  observed: Set<string>;
  checked: Set<string>;
  projectSkills: { root: string; project: Project; paths: [string, string][] }[];
}> {
  const observed = new Set<string>();
  const checked = new Set<string>();
  const packages = await collectPackages(store, input, observed);
  for (const plugin of packages) if (plugin.manifest) checked.add(plugin.manifest.file);
  for (const registry of input.registries) {
    if (registry.complete) checked.add(registry.path);
    for (const record of registry.records) {
      const path = record.installPath
        ? await realpath(record.installPath).catch(() => undefined)
        : undefined;
      const found = packages.find(
        (plugin) =>
          plugin.provider === 'claude' &&
          plugin.root === path &&
          plugin.nativeId === record.nativeId,
      );
      const matchesVersion =
        !record.version || !found?.manifest?.version || record.version === found.manifest.version;
      const entry =
        found && matchesVersion
          ? found.entry
          : savePluginReference(store, nativeReference('claude', record.nativeId, record.version));
      recordPluginLocation(
        store,
        entry,
        registry.path,
        {
          nativeId: record.nativeId,
          evidence: 'installed',
          version: record.version,
          declaredScope: record.scope,
        },
        observed,
        pluginProject(store, record.projectPath, 'claude'),
      );
    }
  }
  const configs = await pluginConfigs(
    input.roots,
    input.projects,
    input.boundaries,
    input.warnings,
  );
  for (const config of configs) {
    for (const reference of config.refs) {
      if (reference.modulePath) {
        const module = await readPluginFile(reference.modulePath, input.boundaries, input.warnings);
        if (module && /\.[cm]?[jt]s$/i.test(module.path))
          await recordModule(
            store,
            module,
            observed,
            config.project,
            config.path,
            reference.enabled,
            config.scope,
          );
        else {
          config.complete = false;
          input.warnings.push(
            `${config.path}: Referenced local Plugin module unavailable or unsupported; previous inventory retained.`,
          );
        }
        continue;
      }
      const entry = savePluginReference(store, {
        ...nativeReference(config.provider, reference.id),
        manifest: config.provider === 'opencode' ? 'npm' : 'reference',
      });
      recordPluginLocation(
        store,
        entry,
        config.path,
        {
          nativeId: reference.id,
          evidence: 'configured',
          enabled: reference.enabled,
          declaredScope: config.scope,
        },
        observed,
        config.project,
      );
    }
    if (config.complete) checked.add(config.path);
  }
  const moduleRoots = [
    ...input.roots
      .filter((root) => root.provider === 'opencode')
      .map((root) => ({ path: root.path, project: undefined as Project | undefined })),
    ...input.projects.flatMap(({ project, contexts }) =>
      contexts.map((context) => ({ path: join(context, '.opencode'), project })),
    ),
  ];
  const modules = new Set<string>();
  for (const root of moduleRoots)
    for (const file of await localPluginModules(root.path, input.boundaries, input.warnings)) {
      if (modules.has(`${root.project?.id || ''}:${file.path}`)) continue;
      modules.add(`${root.project?.id || ''}:${file.path}`);
      await recordModule(store, file, observed, root.project);
    }
  const projectSkills: { root: string; project: Project; paths: [string, string][] }[] = [];
  for (const plugin of packages) {
    if (!plugin.manifest) continue;
    const project = input.projects
      .map((value) => value.project)
      .filter((project) => inside(project.path, plugin.root))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (!project) continue;
    const paths: [string, string][] = [];
    for (const path of plugin.manifest.skills) {
      const target = resolve(plugin.root, path);
      const canonical = await realpath(target).catch(() => undefined);
      if (
        canonical &&
        inside(plugin.root, canonical) &&
        pluginPathAllowed(canonical, [plugin.root])
      )
        paths.push([path, `${plugin.provider}-plugin`]);
      else if (path !== 'skills')
        input.warnings.push(
          `${plugin.manifest.file}: Missing or external Plugin Skill directory excluded.`,
        );
    }
    if (paths.length) projectSkills.push({ root: plugin.root, project, paths });
  }
  return { observed, checked, projectSkills };
}
