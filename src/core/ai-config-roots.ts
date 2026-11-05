import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { type AiConfigRoot, skillPaths } from './inventory-paths';
import { inside } from './safety';

const MAX_PROFILES = 128;
const PROFILE_PROVIDERS = ['claude', 'codex'] as const;
export async function userAiRoots(
  home: string,
  skipped: string[],
  environment: NodeJS.ProcessEnv = home === homedir() ? process.env : {},
): Promise<AiConfigRoot[]> {
  const roots: AiConfigRoot[] = skillPaths.map(([path, provider]) => ({
    path: join(home, path.split('/')[0]!),
    provider,
    origin: 'default',
  }));
  roots.push(
    ...[
      ['.config/opencode', 'opencode'],
      ['.gemini/config', 'antigravity'],
      ['.gemini/antigravity', 'antigravity'],
    ].map(([path, provider]) => ({
      path: join(home, path!),
      provider: provider!,
      origin: 'default' as const,
    })),
  );
  for (const [name, provider] of [
    ['CLAUDE_CONFIG_DIR', 'claude'],
    ['CODEX_HOME', 'codex'],
  ] as const)
    if (environment[name])
      roots.push({
        path: resolve(environment[name]!),
        provider,
        origin: 'environment',
        ...(provider === 'claude' &&
        environment.CLAUDE_CODE_PROJECT_DIR_NAME &&
        /^[^/\\\0\r\n]{1,256}$/.test(environment.CLAUDE_CODE_PROJECT_DIR_NAME) &&
        !['.', '..'].includes(environment.CLAUDE_CODE_PROJECT_DIR_NAME)
          ? { memoryProjectName: environment.CLAUDE_CODE_PROJECT_DIR_NAME }
          : {}),
      });
  const profileBase = join(home, '.aims/profiles');
  const canonicalBase = await realpath(profileBase).catch(() => undefined);
  for (const provider of PROFILE_PROVIDERS) {
    const profiles = await readdir(join(profileBase, provider), { withFileTypes: true }).catch(
      () => [],
    );
    if (profiles.length > MAX_PROFILES)
      skipped.push(`${profileBase}/${provider}: AI profile limit reached.`);
    for (const profile of profiles.slice(0, MAX_PROFILES)) {
      if (!profile.isDirectory() && !profile.isSymbolicLink()) continue;
      const path = join(profileBase, provider, profile.name);
      const canonical = await realpath(path).catch(() => undefined);
      if (canonical && canonicalBase && inside(canonicalBase, canonical))
        roots.push({ path, provider, origin: 'aims' });
      else skipped.push(`${path}: External AI profile directory excluded.`);
    }
  }
  const seen = new Set<string>();
  const result: AiConfigRoot[] = [];
  for (const root of roots) {
    const info = await lstat(root.path).catch(() => undefined);
    if (!info || (!info.isDirectory() && !info.isSymbolicLink())) continue;
    const canonical = await realpath(root.path).catch(() => undefined);
    if (
      !canonical ||
      canonical.split(sep).some((part) => ['.ssh', '.aws', '.gnupg', '.azure'].includes(part))
    ) {
      skipped.push(`${root.path}: Private account or unavailable AI config target excluded.`);
      continue;
    }
    const key = `${root.provider}:${resolve(root.path)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(root);
    } else if (root.memoryProjectName)
      result.find(
        (item) => item.provider === root.provider && resolve(item.path) === resolve(root.path),
      )!.memoryProjectName = root.memoryProjectName;
  }
  return result;
}
