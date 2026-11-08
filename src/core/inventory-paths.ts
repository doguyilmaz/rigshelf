export const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  'Pods',
  '.build',
  'build',
  'dist',
  '.next',
  '.expo',
  'DerivedData',
  'vendor',
  '.venv',
  'venv',
  'target',
  'coverage',
  '.local',
  '.sandbox',
  '.demo',
  'Carthage',
  '.gradle',
  '.bun',
  '.cache',
  '.turbo',
  '.yarn',
  'logs',
  'sessions',
  'transcripts',
]);

export const skillPaths: [string, string][] = [
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
  ['.aims/skills', 'aims'],
  ['.ai/skills', 'custom'],
];
export const projectSkillPaths: [string, string][] = [...skillPaths, ['skills', 'custom']];

export const instructionNames = new Set([
  'AGENTS.md',
  'AGENTS.override.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  'MEMORY.md',
  'MEMORY.local.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
]);
export const dependencyDirectories = new Set([
  'node_modules',
  '.git',
  'Pods',
  'DerivedData',
  'vendor',
  '.venv',
  'venv',
]);
export const privateRuntimeDirectories = new Set([
  'sessions',
  'transcripts',
  'history',
  'logs',
  'rollouts',
  'rollout_summaries',
  'backups',
  'runs',
  'meter',
]);

export const aiDirectoryNames = new Set([
  ...skillPaths.map(([path]) => path.split('/')[0]!),
  '.clinerules',
  '.vscode',
  '.mcp.json',
  '.ai',
  '.claude-plugin',
  '.codex-plugin',
  'skills',
  'SKILL.md',
  'opencode.json',
  'opencode.jsonc',
  'plugin.json',
]);

export interface AiConfigRoot {
  path: string;
  provider: string;
  origin: 'default' | 'aims' | 'environment' | 'custom';
  memoryProjectName?: string;
}
