/** Home folders that machine sync writes. `.agents` is the shared Skills folder and always syncs. */
export const globalRoots = [
  '.claude',
  '.agents',
  '.codex',
  '.kiro',
  '.gemini',
  '.grok',
  '.config/opencode',
] as const;
export type GlobalRoot = (typeof globalRoots)[number];

const agentRoots: Record<string, GlobalRoot> = {
  claude: '.claude',
  codex: '.codex',
  kiro: '.kiro',
  gemini: '.gemini',
  grok: '.grok',
  opencode: '.config/opencode',
};

/** Claude Code keeps Skills synced from claude.ai here and manages the folder itself. */
export const CLAUDE_MANAGED_SKILLS = '.claude/skills/synced';

/** Skill folders worth filling on a machine: `.agents` plus the folders of agents installed there; every folder when unknown. */
export function skillRoots(installed?: string[]): GlobalRoot[] {
  if (!installed) return [...globalRoots];
  return [
    '.agents',
    ...installed.flatMap((agent) => (agentRoots[agent] ? [agentRoots[agent]] : [])),
  ];
}

export function installedAgents(harnesses: Record<string, boolean>): string[] {
  return Object.entries(harnesses).flatMap(([agent, installed]) => (installed ? [agent] : []));
}
