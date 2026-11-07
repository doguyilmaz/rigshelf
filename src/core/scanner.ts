import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { userAiRoots } from './ai-config-roots';
import { type AiFileInventory, globalAiFiles, inspectPortable, projectAiFiles } from './ai-files';
import { detectProject, exists, ignoredDirectories, inferTags, readText } from './detect';
import {
  globalGuidance,
  localGuidance,
  mergedGuidance,
  projectAiContexts,
  userProjectMemory,
} from './guidance-inventory';
import { importSkillDirectory } from './ingest';
import { captureInventoryBaseline } from './inventory-baselines';
import {
  type AiConfigRoot,
  dependencyDirectories,
  instructionNames,
  privateRuntimeDirectories,
  projectSkillPaths,
} from './inventory-paths';
import type { Kit } from './kit';
import { sanitizeMcpDefinition } from './mcp-definition';
import { McpInventoryError, readInventoryMcpConfig } from './mcp-inventory-config';
import { mcpLocationGroups } from './mcp-locations';
import { type DocumentLocation, type Entry, McpSchema, type Project, type Source } from './model';
import { ownedProject } from './ownership';
import { pluginRegistries } from './plugin-config';
import { pluginBoundaries, pluginPathAllowed } from './plugin-files';
import { inventoryNativePlugins } from './plugin-inventory';
import { pluginProject } from './plugin-records';
import { canonicalMcp, object } from './providers';
import { hash, inside, now, scanText } from './safety';
import { pinnedMcp, pinnedSkill } from './scan-pinned';
import type { Store } from './store';

export interface ScanResult {
  projects: number;
  skills: number;
  mcps: number;
  plugins: number;
  skipped: string[];
  completedAt: string;
}
export interface ScanProgress {
  state: 'idle' | 'running' | 'complete' | 'error';
  message: string;
  scanned: number;
  result?: ScanResult;
}
export let scanProgress: ScanProgress = { state: 'idle', message: 'No scan yet', scanned: 0 };
const MAX_REFERENCED_PROJECTS = 512;
const mcpPaths: [string, string, string, 'json' | 'toml' | 'jsonc'][] = [
  ['.mcp.json', 'claude', 'mcpServers', 'json'],
  ['.codex/config.toml', 'codex', 'mcp_servers', 'toml'],
  ['.kiro/settings/mcp.json', 'kiro', 'mcpServers', 'json'],
  ['opencode.json', 'opencode', 'mcp', 'jsonc'],
  ['opencode.jsonc', 'opencode', 'mcp', 'jsonc'],
  ['.agents/mcp_config.json', 'antigravity', 'mcpServers', 'json'],
  ['.cursor/mcp.json', 'cursor', 'mcpServers', 'json'],
  ['.vscode/mcp.json', 'copilot', 'servers', 'json'],
  ['.gemini/settings.json', 'gemini', 'mcpServers', 'json'],
  ['.grok/config.toml', 'grok', 'mcp_servers', 'toml'],
];
function configMcpPaths(root: AiConfigRoot): typeof mcpPaths {
  const paths: Record<string, typeof mcpPaths> = {
    codex: [['config.toml', 'codex', 'mcp_servers', 'toml']],
    claude: [
      ['settings.json', 'claude', 'mcpServers', 'json'],
      ['.claude.json', 'claude', 'mcpServers', 'json'],
    ],
    kiro: [['settings/mcp.json', 'kiro', 'mcpServers', 'json']],
    opencode: [
      ['opencode.json', 'opencode', 'mcp', 'jsonc'],
      ['opencode.jsonc', 'opencode', 'mcp', 'jsonc'],
    ],
    antigravity: [['mcp_config.json', 'antigravity', 'mcpServers', 'json']],
    gemini: [['settings.json', 'gemini', 'mcpServers', 'json']],
    grok: [['config.toml', 'grok', 'mcp_servers', 'toml']],
    cursor: [['mcp.json', 'cursor', 'mcpServers', 'json']],
  };
  return paths[root.provider] || [];
}

async function discoverProjects(
  root: string,
  output: Set<string>,
  skipped: string[],
  depth = 0,
): Promise<boolean> {
  if (depth > 8) {
    skipped.push(`${root}: Project discovery depth limit reached.`);
    return false;
  }
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    skipped.push(`${root}: Directory unavailable; existing inventory retained.`);
    return false;
  }
  const names = entries.map((entry) => entry.name);
  if (
    names.some(
      (name) =>
        [
          '.git',
          '.kitfold',
          'package.json',
          'go.mod',
          'Package.swift',
          'build.gradle.kts',
          'Cargo.toml',
          'AGENTS.md',
          'CLAUDE.md',
        ].includes(name) ||
        instructionNames.has(name) ||
        [
          '.claude',
          '.codex',
          '.agents',
          '.kiro',
          '.opencode',
          '.agent',
          '.gemini',
          '.grok',
          '.aims',
          '.ai',
          '.claude-plugin',
          '.codex-plugin',
          'opencode.json',
          'opencode.jsonc',
          '.mcp.json',
          'SKILL.md',
        ].includes(name) ||
        name.endsWith('.xcodeproj'),
    ) ||
    (names.includes('plugin.json') &&
      (await inspectPortable(root, await pluginBoundaries([root]), skipped)))
  ) {
    output.add(root);
    return true;
  }
  let complete = true;
  for (const entry of entries)
    if (entry.isDirectory() && !entry.name.startsWith('.') && !ignoredDirectories.has(entry.name))
      complete =
        (await discoverProjects(join(root, entry.name), output, skipped, depth + 1)) && complete;
  return complete;
}

async function discoverSkills(
  root: string,
  onSkill: (path: string) => Promise<void>,
  bounds: { roots: string[]; skipped: string[]; scope: 'project' | 'global' },
  visited = new Set<string>(),
  depth = 0,
): Promise<void> {
  if (depth > 12) return;
  const canonical = await realpath(root).catch(() => undefined);
  if (!canonical || visited.has(canonical)) return;
  if (
    canonical
      .split(sep)
      .some(
        (part) =>
          dependencyDirectories.has(part) || ['.ssh', '.aws', '.gnupg', '.azure'].includes(part),
      )
  ) {
    bounds.skipped.push(`${root}: Dependency or private skill target excluded.`);
    return;
  }
  if (!bounds.roots.some((allowed) => inside(allowed, canonical))) {
    bounds.skipped.push(
      `${root}: External ${bounds.scope} skill link excluded. Import its target explicitly, or include its known global skill root in the scan.`,
    );
    return;
  }
  if (
    bounds.roots
      .filter((allowed) => inside(allowed, canonical))
      .every((allowed) =>
        relative(allowed, canonical)
          .split(sep)
          .some((part) => privateRuntimeDirectories.has(part)),
      )
  ) {
    bounds.skipped.push(`${root}: Private runtime skill target excluded.`);
    return;
  }
  visited.add(canonical);
  if (await exists(join(root, 'SKILL.md'))) {
    await onSkill(root);
    return;
  }
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!ignoredDirectories.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()))
      await discoverSkills(join(root, entry.name), onSkill, bounds, visited, depth + 1);
  }
}

export function sanitizeMcp(mcp: NonNullable<ReturnType<typeof canonicalMcp>>): typeof mcp {
  return sanitizeMcpDefinition(mcp);
}

async function importMcp(
  store: Store,
  root: string,
  project: Project | undefined,
  skipped: string[],
  observed: Set<string>,
  configurations: Set<string>,
  kit?: Kit,
  explicitPaths?: typeof mcpPaths,
  seenFiles = new Set<string>(),
  allowedRoots: string[] = [root],
): Promise<number> {
  let count = 0;
  const canonicalRoots = (
    await Promise.all(allowedRoots.map((allowed) => realpath(allowed).catch(() => undefined)))
  ).filter((allowed): allowed is string => Boolean(allowed));
  const paths =
    explicitPaths ||
    (project
      ? mcpPaths
      : ([
          ...mcpPaths,
          ['.claude.json', 'claude', 'mcpServers', 'json'],
          ['.config/opencode/opencode.json', 'opencode', 'mcp', 'jsonc'],
          ['.config/opencode/opencode.jsonc', 'opencode', 'mcp', 'jsonc'],
          ['.gemini/config/mcp_config.json', 'antigravity', 'mcpServers', 'json'],
          ['.gemini/antigravity/mcp_config.json', 'antigravity', 'mcpServers', 'json'],
        ] as typeof mcpPaths));
  for (const [localPath, provider, key, format] of paths) {
    const path = join(root, localPath);
    try {
      const canonicalPath = await realpath(path).catch(() => undefined);
      if (
        canonicalPath &&
        (basename(canonicalPath) !== basename(path) ||
          !canonicalRoots.some(
            (allowed) =>
              inside(allowed, canonicalPath) &&
              !relative(allowed, canonicalPath)
                .split(sep)
                .some((part) => privateRuntimeDirectories.has(part)),
          ) ||
          canonicalPath
            .split(sep)
            .some(
              (part) =>
                dependencyDirectories.has(part) ||
                ['.ssh', '.aws', '.gnupg', '.azure'].includes(part),
            ))
      ) {
        skipped.push(`${path}: Non-configuration or private target excluded.`);
        continue;
      }
      const keyForFile = `${project?.id || 'global'}:${provider}:${canonicalPath || path}`;
      if (canonicalPath && seenFiles.has(keyForFile)) {
        configurations.add(path);
        continue;
      }
      const text = await readText(path, 4 * 1024 * 1024);
      if (text === undefined) {
        configurations.add(path);
        continue;
      }
      const config = readInventoryMcpConfig(text, format);
      seenFiles.add(keyForFile);
      configurations.add(path);
      for (const group of mcpLocationGroups(store, config, key, localPath, project))
        for (const [name, raw] of Object.entries(group.servers)) {
          let canonical: ReturnType<typeof canonicalMcp>;
          try {
            canonical = canonicalMcp(raw);
          } catch (error) {
            skipped.push(
              `${path}#${group.fragment}${name}: ${error instanceof Error ? error.message : 'Unsupported native MCP definition.'}`,
            );
            continue;
          }
          if (!canonical) continue;
          const parsed = McpSchema.safeParse(sanitizeMcp(canonical));
          if (!parsed.success) {
            skipped.push(
              `${path}#${group.fragment}${name}: Invalid MCP definition excluded; other servers in this file were still inspected.`,
            );
            continue;
          }
          const mcp = parsed.data;
          const body = JSON.stringify(mcp, null, 2);
          const findings = scanText(body, localPath);
          if (/(?:\/Users\/|\/home\/|[A-Z]:\\\\)/.test(body))
            findings.push({
              code: 'local-path',
              level: 'review',
              message:
                'MCP refers to a machine-local path. Verify that it is correct for the target project.',
            });
          if (object(raw).disabled === true || object(raw).enabled === false)
            findings.push({
              code: 'disabled-origin',
              level: 'review',
              message:
                'This server was disabled in its original configuration. Applying it will enable the selected server.',
            });
          const digest = hash(body);
          const id = `mcp-${hash(name + body).slice(0, 24)}`;
          const previous = store.entry(id);
          const entry: Entry = pinnedMcp(store, kit, provider, name, canonical) || {
            id,
            name,
            description:
              canonical.transport === 'stdio'
                ? `Local MCP · ${mcp.command}`
                : `Remote MCP · ${mcp.url}`,
            kind: 'mcp',
            tags: previous?.tags || inferTags(name),
            sourceId: previous?.sourceId || 'local-mcp',
            digest,
            custom: previous?.custom || false,
            archived: previous?.archived,
            body,
            mcp,
            findings,
            updatedAt: previous?.updatedAt || now(),
          };
          const source: Source = {
            id: 'local-mcp',
            name: 'Local MCP configurations',
            url: '',
            type: 'local',
            recipe: '',
            status: 'unchecked',
            notes:
              'Directly discovered. Secret values are replaced by environment placeholders. Review environment expansion for the target harness.',
          };
          if (!store.get('source', source.id)) store.put('source', source);
          store.saveEntry(entry);
          observed.add(`${path}#${group.fragment}${name}`);
          store.installation({
            entryId: entry.id,
            projectId: group.project?.id || null,
            provider,
            path: `${path}#${group.fragment}${name}`,
            scope: group.project ? 'project' : 'global',
            storage: group.storage,
            lastSeen: now(),
          });
          count++;
        }
    } catch (error) {
      skipped.push(
        `${path}: ${error instanceof McpInventoryError ? error.message : 'MCP configuration could not be read. Check its size and permissions; previous observations retained.'}`,
      );
    }
  }
  return count;
}

async function inventoryProject(
  store: Store,
  path: string,
  roots: AiConfigRoot[],
  shared: DocumentLocation[],
  home: string,
  refreshGlobals: boolean,
) {
  const previous = store.get<Project>('project', `project-${hash(path).slice(0, 20)}`);
  const project = {
    ...(await detectProject(path)),
    ...store.get<object>('project-override', `project-${hash(path).slice(0, 20)}`),
  };
  const discovered = await projectAiContexts(path);
  const local = await localGuidance(path, discovered.paths, roots, home);
  const memory = await userProjectMemory(path, roots);
  const native = await projectAiFiles(path, discovered.paths, roots);
  const partial =
    discovered.warnings.length > 0 ||
    local.warnings.length > 0 ||
    memory.warnings.length > 0 ||
    native.warnings.length > 0;
  project.documentLocations = mergedGuidance(
    local.files,
    memory.files,
    shared,
    refreshGlobals
      ? []
      : (previous?.documentLocations || []).filter((file) => file.scope !== 'project'),
    partial ? previous?.documentLocations || [] : [],
  );
  project.aiFileLocations = mergedGuidance(
    native.files,
    partial ? previous?.aiFileLocations || [] : [],
  );
  project.documents = project.documentLocations
    .filter((file) => file.scope === 'project' && !file.readOnly)
    .map((file) => file.path);
  project.inventoryWarnings = [
    ...new Set([...discovered.warnings, ...local.warnings, ...memory.warnings, ...native.warnings]),
  ];
  store.put('project', project);
  return { project, contexts: discovered.paths, plugins: native.plugins, partial };
}

export async function scan(
  store: Store,
  options: {
    roots?: string[];
    globals?: boolean;
    home?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<ScanResult> {
  if (scanProgress.state === 'running') throw new Error('A scan is already running.');
  scanProgress = { state: 'running', message: 'Finding project manifests', scanned: 0 };
  const home = options.home || homedir();
  const includeGlobals = options.globals ?? store.settings().scanGlobals;
  const result: ScanResult = {
    projects: 0,
    skills: 0,
    mcps: 0,
    plugins: 0,
    skipped: [],
    completedAt: '',
  };
  const imported = new Map<string, Entry>();
  const observed = new Set<string>(),
    configurations = new Set<string>(),
    selectedRoots: string[] = [],
    completeRoots: string[] = [];
  try {
    captureInventoryBaseline(store);
    let globalPartial = false;
    const configRoots = includeGlobals
      ? await userAiRoots(home, result.skipped, options.environment)
      : [];
    const sharedGuidance = await globalGuidance(configRoots, home);
    const nativeGlobal = includeGlobals ? await globalAiFiles(configRoots) : undefined;
    if (nativeGlobal) {
      const previous = store.get<AiFileInventory>('global-ai-inventory', 'main');
      nativeGlobal.warnings = [
        ...new Set([...nativeGlobal.warnings, ...sharedGuidance.warnings, ...result.skipped]),
      ];
      if (
        previous?.files.some(
          (file) =>
            !configRoots.some(
              (root) => inside(root.path, file.sourcePath) || inside(root.path, file.canonicalPath),
            ),
        )
      )
        nativeGlobal.warnings.push(
          'Some global AI roots were not rediscovered; previous inventory retained.',
        );
      globalPartial = nativeGlobal.warnings.length > 0;
      store.put('global-ai-inventory', {
        ...nativeGlobal,
        id: 'main',
        files: mergedGuidance(
          nativeGlobal.files,
          nativeGlobal.warnings.length ? previous?.files || [] : [],
        ),
      });
      result.skipped.push(...nativeGlobal.warnings);
    }
    result.skipped.push(...sharedGuidance.warnings);
    const contexts = new Map<string, string[]>();
    const pluginProjects = new Map<string, Awaited<ReturnType<typeof inventoryProject>>>();
    const partialProjects = new Set<string>();
    const projects = new Set<string>();
    for (const root of options.roots || store.settings().roots) {
      const expanded = resolve(root.startsWith('~/') ? join(home, root.slice(2)) : root);
      selectedRoots.push(expanded);
      if (await discoverProjects(expanded, projects, result.skipped)) completeRoots.push(expanded);
    }
    const completeBoundaries = await pluginBoundaries(completeRoots);
    const nativeBoundaries = await pluginBoundaries([
      ...configRoots.map((root) => root.path),
      ...selectedRoots,
    ]);
    const registries = await pluginRegistries(configRoots, nativeBoundaries, result.skipped);
    for (const record of registries.flatMap((registry) => registry.records)) {
      const referenced = pluginProject(store, record.projectPath, 'claude');
      if (!referenced || projects.has(referenced.path)) continue;
      if (projects.size >= MAX_REFERENCED_PROJECTS) {
        result.skipped.push('Referenced project limit reached; Plugin inventory is partial.');
        break;
      }
      const canonical = await realpath(referenced.path).catch(() => undefined);
      if (
        canonical &&
        selectedRoots.some((root) => inside(root, referenced.path)) &&
        pluginPathAllowed(canonical, nativeBoundaries) &&
        !relative(selectedRoots.find((root) => inside(root, referenced.path))!, referenced.path)
          .split(sep)
          .some((part) => ignoredDirectories.has(part))
      )
        projects.add(referenced.path);
    }
    const targets: {
      root: string;
      project?: Project;
      paths: [string, string][];
      mcpPaths?: typeof mcpPaths;
    }[] = [];
    for (const path of projects) {
      try {
        const detail = await inventoryProject(
          store,
          path,
          configRoots,
          sharedGuidance.files,
          home,
          includeGlobals && !globalPartial,
        );
        const { project } = detail;
        pluginProjects.set(path, detail);
        result.skipped.push(...(project.inventoryWarnings || []));
        contexts.set(path, detail.contexts);
        for (const context of detail.contexts)
          targets.push({
            root: context,
            project,
            paths: [
              ...projectSkillPaths,
              ...((await exists(join(context, 'SKILL.md')))
                ? [['', 'custom'] as [string, string]]
                : []),
            ],
          });
        for (const plugin of detail.plugins)
          targets.push({ root: plugin.path, project, paths: [['skills', plugin.provider]] });
        if (detail.partial) partialProjects.add(project.id);
        result.projects++;
      } catch (error) {
        result.skipped.push(
          `${path}: ${error instanceof Error ? error.message : 'Detection failed'}`,
        );
      }
    }
    if (includeGlobals)
      targets.push({
        root: home,
        paths: [],
      });
    for (const root of configRoots)
      targets.push({
        root: root.path,
        paths: [
          ['skills', root.provider],
          ...(['codex', 'claude'].includes(root.provider)
            ? [['plugins/cache', `${root.provider}-plugin`] as [string, string]]
            : []),
        ],
        mcpPaths: configMcpPaths(root),
      });
    const configBoundaries = (
      await Promise.all(configRoots.map((root) => realpath(root.path).catch(() => undefined)))
    ).filter((root): root is string => Boolean(root));
    const globalRoots = (
      await Promise.all(
        targets
          .filter((target) => !target.project)
          .flatMap((target) =>
            target.paths.map(([local]) =>
              realpath(join(target.root, local)).catch(() => undefined),
            ),
          ),
      )
    ).filter(
      (root): root is string =>
        Boolean(root) &&
        !configBoundaries.some(
          (config) =>
            inside(config, root!) &&
            relative(config, root!)
              .split(sep)
              .some((part) => privateRuntimeDirectories.has(part)),
        ),
    );
    const scannedGlobalSkills = new Set<string>();
    const scannedMcpFiles = new Set<string>();
    const scanSkills = async (target: (typeof targets)[number]) => {
      const kit = target.project
        ? (
            await ownedProject(store, target.project.path).catch((error) => {
              result.skipped.push(
                `${target.root}/.kitfold/kit.json: ${error instanceof Error ? error.message : 'Invalid kit manifest'}`,
              );
              return undefined;
            })
          )?.kit
        : undefined;
      scanProgress.message = target.project
        ? `Reading ${target.project.name}`
        : 'Reading global skills';
      for (const [localPath, provider] of target.paths) {
        if (!target.project) {
          const canonical = await realpath(join(target.root, localPath)).catch(() => undefined);
          if (!canonical || scannedGlobalSkills.has(`${provider}:${canonical}`)) continue;
          scannedGlobalSkills.add(`${provider}:${canonical}`);
        }
        await discoverSkills(
          join(target.root, localPath),
          async (path) => {
            try {
              const canonical = await realpath(path);
              const entry =
                imported.get(canonical) ||
                (target.project
                  ? await pinnedSkill(store, target.project, canonical, kit)
                  : undefined) ||
                (await importSkillDirectory(store, path, home));
              imported.set(canonical, entry);
              observed.add(path);
              store.installation({
                entryId: entry.id,
                projectId: target.project?.id || null,
                provider,
                path,
                scope: target.project ? 'project' : 'global',
                storage: provider.endsWith('plugin')
                  ? 'plugin-cache'
                  : target.project
                    ? 'project-config'
                    : 'user-config',
                lastSeen: now(),
              });
              if (target.project && !target.project.providers.includes(provider)) {
                const current = store.get<Project>('project', target.project.id) || target.project;
                current.providers = [...new Set([...current.providers, provider])];
                store.put('project', current);
              }
              result.skills++;
              scanProgress.scanned++;
            } catch (error) {
              result.skipped.push(
                `${path}: ${error instanceof Error ? error.message : 'Import failed'}`,
              );
            }
          },
          {
            roots: target.project ? [target.project.path, ...globalRoots] : globalRoots,
            skipped: result.skipped,
            scope: target.project ? 'project' : 'global',
          },
        );
      }
    };
    for (const target of targets) {
      await scanSkills(target);
      const kit = target.project
        ? (await ownedProject(store, target.project.path).catch(() => undefined))?.kit
        : undefined;
      result.mcps += await importMcp(
        store,
        target.root,
        target.project,
        result.skipped,
        observed,
        configurations,
        kit,
        target.mcpPaths,
        scannedMcpFiles,
        [target.project?.path || target.root, ...configRoots.map((root) => root.path)],
      );
      if (!target.project) {
        for (const referenced of store.projects()) {
          if (projects.has(referenced.path) || referenced.discovery !== 'configuration') continue;
          if (contexts.size >= MAX_REFERENCED_PROJECTS) {
            const warning = 'Referenced project limit reached; AI inventory is partial.';
            if (!result.skipped.includes(warning)) result.skipped.push(warning);
            break;
          }
          const authorized = completeRoots.some(
            (root) =>
              inside(root, referenced.path) &&
              !relative(root, referenced.path)
                .split(sep)
                .some((part) => ignoredDirectories.has(part)),
          );
          if (!authorized) continue;
          const canonical = await realpath(referenced.path).catch(() => undefined);
          if (!canonical) continue;
          if (
            !completeBoundaries.some(
              (root) =>
                inside(root, canonical) &&
                !relative(root, canonical)
                  .split(sep)
                  .some((part) => ignoredDirectories.has(part)),
            )
          ) {
            result.skipped.push(
              `${referenced.path}: Referenced project target outside selected roots excluded.`,
            );
            continue;
          }
          if (!(await lstat(referenced.path).catch(() => undefined))?.isDirectory()) continue;
          try {
            const detail = await inventoryProject(
              store,
              referenced.path,
              configRoots,
              sharedGuidance.files,
              home,
              includeGlobals && !globalPartial,
            );
            projects.add(referenced.path);
            pluginProjects.set(referenced.path, detail);
            contexts.set(referenced.path, detail.contexts);
            for (const context of detail.contexts)
              targets.push({
                root: context,
                project: detail.project,
                paths: [
                  ...projectSkillPaths,
                  ...((await exists(join(context, 'SKILL.md')))
                    ? [['', 'custom'] as [string, string]]
                    : []),
                ],
              });
            for (const plugin of detail.plugins)
              targets.push({
                root: plugin.path,
                project: detail.project,
                paths: [['skills', plugin.provider]],
              });
            if (detail.partial) partialProjects.add(detail.project.id);
            result.skipped.push(...(detail.project.inventoryWarnings || []));
            result.projects++;
          } catch (error) {
            result.skipped.push(
              `${referenced.path}: ${error instanceof Error ? error.message : 'AI discovery failed'}`,
            );
          }
        }
      }
    }
    scanProgress.message = 'Reading native Plugin registries, settings and packages';
    const pluginWarningStart = result.skipped.length;
    const plugins = await inventoryNativePlugins(store, {
      roots: configRoots,
      projects: [...pluginProjects.values()],
      globals: nativeGlobal ? { plugins: nativeGlobal.plugins, partial: globalPartial } : undefined,
      registries,
      boundaries: nativeBoundaries,
      warnings: result.skipped,
    });
    for (const target of plugins.projectSkills) await scanSkills(target);
    for (const path of plugins.observed) observed.add(path);
    result.plugins = plugins.observed.size;
    const pluginPartial = result.skipped.length > pluginWarningStart;
    // Global configurations can reveal a nested project which source-root grouping did not traverse.
    for (const project of store.projects()) {
      if (!includeGlobals || contexts.has(project.path)) continue;
      const memory = await userProjectMemory(project.path, configRoots);
      project.documentLocations = mergedGuidance(
        (project.documentLocations || []).filter((file) => file.scope === 'project'),
        memory.files,
        sharedGuidance.files,
        globalPartial || memory.warnings.length ? project.documentLocations || [] : [],
      );
      project.inventoryWarnings = [
        ...new Set([...(project.inventoryWarnings || []), ...memory.warnings]),
      ];
      store.put('project', project);
    }
    result.skipped = [...new Set(result.skipped)];
    result.completedAt = now();
    for (const project of store.projects())
      if (
        selectedRoots.some((root) => inside(root, project.path)) &&
        !projects.has(project.path) &&
        project.discovery !== 'configuration'
      )
        store.put('project', {
          ...project,
          inventoryWarnings: [
            ...new Set([
              ...(project.inventoryWarnings || []),
              'Project was not rediscovered. Previous inventory retained; review its path or scan scope.',
            ]),
          ],
        });
    for (const location of store.installations()) {
      if (observed.has(location.path)) continue;
      if (location.plugin) {
        // A failed/partial read must never erase earlier observations or snapshots.
        if (
          pluginPartial ||
          (location.scope === 'global' && globalPartial) ||
          (location.projectId && partialProjects.has(location.projectId))
        )
          continue;
        const file = location.path.split('#plugin:')[0]!;
        if (plugins.checked.has(file)) store.removeInstallation(location.path);
        else if (pluginPathAllowed(file, nativeBoundaries)) {
          try {
            await lstat(file);
          } catch (error) {
            if (
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENOENT' &&
              (await lstat(resolve(file, '..')).catch(() => undefined))?.isDirectory()
            )
              store.removeInstallation(location.path);
          }
        }
        continue;
      }
      if (location.scope === 'global' && globalPartial) continue;
      if (location.projectId && partialProjects.has(location.projectId)) continue;
      const [file, name] = location.path.split('#');
      if (name !== undefined && configurations.has(file)) {
        store.removeInstallation(location.path);
        continue;
      }
      const inScope =
        location.scope === 'global'
          ? includeGlobals &&
            (inside(home, file) || configRoots.some((root) => inside(root.path, file)))
          : completeRoots.some((root) => inside(root, file));
      if (!inScope || name !== undefined) continue;
      try {
        await lstat(join(file, 'SKILL.md'));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
          store.removeInstallation(location.path);
      }
    }
    store.put('scan', { id: 'last', ...result });
    store.event(
      'scan.completed',
      `Discovered ${result.projects} projects, ${result.skills} skill locations, ${result.mcps} MCP locations and ${result.plugins} Plugin evidence locations; ${result.skipped.length} skipped.`,
    );
    scanProgress = {
      state: 'complete',
      message: 'Library refreshed',
      scanned: result.skills,
      result,
    };
    return result;
  } catch (error) {
    scanProgress = {
      state: 'error',
      message: error instanceof Error ? error.message : 'Scan failed',
      scanned: result.skills,
    };
    throw error;
  }
}
