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

/** Guidance each agent reads from home, with the agent it belongs to. */
export const globalGuidanceFiles: [GlobalRoot, string, string][] = [
  ['.claude', 'CLAUDE.md', 'claude'],
  ['.codex', 'AGENTS.md', 'codex'],
  ['.gemini', 'GEMINI.md', 'gemini'],
];
/** Claude folders of directives and subagents; `hooks` holds scripts and travels only with hooks. */
export const claudeRuleFolders = ['rules', 'agents', 'commands'];
export const CLAUDE_SETTINGS = '.claude/settings.json';
/** Settings keys that run commands; they stay on each machine unless sent explicitly. */
export const SETTINGS_COMMAND_KEYS = ['hooks', 'statusLine'];
/** Account state and per-path trust; reported by name, never copied. */
export const accountFiles: [string, string][] = [
  ['.claude.json', 'Holds Claude Code account and project trust; sign in on the server instead.'],
  ['.codex/config.toml', 'Holds Codex project trust; trust projects on the server yourself.'],
];
export const junkFiles = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** True when machine sync brings this global inventory item to the other machine. */
export function syncsGlobalItem(key: string, group: string): boolean {
  return (
    group === 'skill' ||
    group === 'guidance' ||
    key === CLAUDE_SETTINGS ||
    /^\.claude\/(?:rules|agents|commands|hooks)\//.test(key)
  );
}

/** Claude Code `@file` imports of Markdown files, as written: relative, `~/` or absolute. */
export function guidanceImports(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)@((?:~\/|\/)?[\w./-]+\.md)(?![\w./-])/gm)].map(
    (match) => match[1]!,
  );
}

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
