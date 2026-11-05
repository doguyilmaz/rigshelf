import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectProject, exists, ignoredDirectories, inferTags, readText } from './detect';
import { importSkillDirectory } from './ingest';
import type { Kit } from './kit';
import { mcpLocationGroups } from './mcp-locations';
import { type Entry, McpSchema, type Project, type Source } from './model';
import { ownedProject } from './ownership';
import { canonicalMcp, object, readConfig } from './providers';
import { hash, inside, now, redact, scanText } from './safety';
import { pinnedMcp, pinnedSkill } from './scan-pinned';
import type { Store } from './store';

export interface ScanResult {
  projects: number;
  skills: number;
  mcps: number;
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
const skillPaths: [string, string][] = [
  ['.agents/skills', 'agents'],
  ['.claude/skills', 'claude'],
  ['.codex/skills', 'codex'],
  ['.kiro/skills', 'kiro'],
  ['.opencode/skills', 'opencode'],
  ['.agent/skills', 'antigravity'],
  ['.gemini/skills', 'gemini'],
  ['.cursor/skills', 'cursor'],
  ['.windsurf/skills', 'windsurf'],
  ['.cline/skills', 'cline'],
  ['.roo/skills', 'roo'],
  ['.factory/skills', 'factory'],
  ['.github/skills', 'copilot'],
  ['.continue/skills', 'continue'],
  ['.trae/skills', 'trae'],
  ['.goose/skills', 'goose'],
  ['.crush/skills', 'crush'],
  ['.grok/skills', 'grok'],
];
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
        ].includes(name) || name.endsWith('.xcodeproj'),
    )
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
  if (!bounds.roots.some((allowed) => inside(allowed, canonical))) {
    bounds.skipped.push(
      `${root}: External ${bounds.scope} skill link excluded. Import its target explicitly, or include its known global skill root in the scan.`,
    );
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
  return {
    ...mcp,
    command: mcp.command ? redact(mcp.command) : undefined,
    args: mcp.args.map((argument, index) =>
      /(?:token|secret|password|api-key|api_key|auth|credential|license-key)$/i.test(
        mcp.args[index - 1] || '',
      )
        ? '${KITFOLD_SECRET}'
        : redact(argument).replace(
            /(--[\w-]*(?:token|secret|password|key|auth|credential)=).+/i,
            '$1${KITFOLD_SECRET}',
          ),
    ),
    url: mcp.url
      ? redact(mcp.url).replace(
          /([?&](?:token|key|api_key|access_token)=)[^&]+/gi,
          '$1${KITFOLD_SECRET}',
        )
      : undefined,
    env: Object.fromEntries(
      Object.entries(mcp.env).map(([key, value]) => [
        key,
        value.includes('${')
          ? value
          : /^(?:NODE_ENV|BUN_ENV|MODE|LOG_LEVEL|DEBUG|PORT|TZ|LANG|LC_ALL|NO_COLOR|FORCE_COLOR|CI|MCP_TRANSPORT|MCP_PORT|MCP_HOST)$/i.test(
                key,
              )
            ? redact(value)
            : `\${${key}}`,
      ]),
    ),
    headers: Object.fromEntries(
      Object.entries(mcp.headers).map(([key, value]) => [
        key,
        /^(?:Bearer )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ||
        /^(?:accept|content-type|x-region|mcp-protocol-version)$/i.test(key)
          ? value
          : `\${KITFOLD_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}}`,
      ]),
    ),
  };
}

async function importMcp(
  store: Store,
  root: string,
  project: Project | undefined,
  skipped: string[],
  observed: Set<string>,
  configurations: Set<string>,
  kit?: Kit,
): Promise<number> {
  let count = 0;
  const paths = project
    ? mcpPaths
    : ([
        ...mcpPaths,
        ['.claude.json', 'claude', 'mcpServers', 'json'],
        ['.config/opencode/opencode.json', 'opencode', 'mcp', 'jsonc'],
        ['.config/opencode/opencode.jsonc', 'opencode', 'mcp', 'jsonc'],
        ['.gemini/config/mcp_config.json', 'antigravity', 'mcpServers', 'json'],
        ['.gemini/antigravity/mcp_config.json', 'antigravity', 'mcpServers', 'json'],
      ] as typeof mcpPaths);
  for (const [localPath, provider, key, format] of paths) {
    const path = join(root, localPath);
    try {
      const text = await readText(path, 4 * 1024 * 1024);
      if (text === undefined) {
        configurations.add(path);
        continue;
      }
      const config = readConfig(text, format);
      configurations.add(path);
      for (const group of mcpLocationGroups(store, config, key, localPath, project))
        for (const [name, raw] of Object.entries(group.servers)) {
          const canonical = canonicalMcp(raw);
          if (!canonical) continue;
          const mcp = McpSchema.parse(sanitizeMcp(canonical));
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
      skipped.push(`${path}: ${error instanceof Error ? error.message : 'Invalid configuration'}`);
    }
  }
  return count;
}

export async function scan(
  store: Store,
  options: { roots?: string[]; globals?: boolean; home?: string } = {},
): Promise<ScanResult> {
  if (scanProgress.state === 'running') throw new Error('A scan is already running.');
  scanProgress = { state: 'running', message: 'Finding project manifests', scanned: 0 };
  const home = options.home || homedir();
  const result: ScanResult = { projects: 0, skills: 0, mcps: 0, skipped: [], completedAt: '' };
  const imported = new Map<string, Entry>();
  const observed = new Set<string>(),
    configurations = new Set<string>(),
    completeRoots: string[] = [];
  try {
    const projects = new Set<string>();
    for (const root of options.roots || store.settings().roots) {
      const expanded = resolve(root.startsWith('~/') ? join(home, root.slice(2)) : root);
      if (await discoverProjects(expanded, projects, result.skipped)) completeRoots.push(expanded);
    }
    const targets: { root: string; project?: Project; paths: [string, string][] }[] = [];
    for (const path of projects) {
      try {
        const project = {
          ...(await detectProject(path)),
          ...store.get<object>('project-override', `project-${hash(path).slice(0, 20)}`),
        };
        store.put('project', project);
        targets.push({ root: path, project, paths: skillPaths });
        result.projects++;
      } catch (error) {
        result.skipped.push(
          `${path}: ${error instanceof Error ? error.message : 'Detection failed'}`,
        );
      }
    }
    if (options.globals ?? store.settings().scanGlobals)
      targets.push({
        root: home,
        paths: [
          ...skillPaths,
          ['.config/opencode/skills', 'opencode'],
          ['.codex/plugins/cache', 'codex-plugin'],
          ['.claude/plugins/cache', 'claude-plugin'],
          ['.gemini/config/skills', 'antigravity'],
          ['.gemini/antigravity/skills', 'antigravity'],
        ],
      });
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
    ).filter((root): root is string => Boolean(root));
    for (const target of targets) {
      const kit = target.project
        ? (
            await ownedProject(store, target.root).catch((error) => {
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
      for (const [localPath, provider] of target.paths)
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
                target.project.providers.push(provider);
                store.put('project', target.project);
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
      result.mcps += await importMcp(
        store,
        target.root,
        target.project,
        result.skipped,
        observed,
        configurations,
        kit,
      );
    }
    result.completedAt = now();
    for (const project of store.projects())
      if (
        completeRoots.some((root) => inside(root, project.path)) &&
        !projects.has(project.path) &&
        project.discovery !== 'configuration'
      )
        store.remove('project', project.id);
    for (const location of store.installations()) {
      if (observed.has(location.path)) continue;
      const [file, name] = location.path.split('#');
      if (name !== undefined && configurations.has(file)) {
        store.removeInstallation(location.path);
        continue;
      }
      const inScope =
        location.scope === 'global'
          ? Boolean(options.globals ?? store.settings().scanGlobals) && inside(home, file)
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
      `Discovered ${result.projects} projects, ${result.skills} skill locations and ${result.mcps} MCP locations; ${result.skipped.length} skipped.`,
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
