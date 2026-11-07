export const projects = {
  expo: {
    name: 'Fieldnotes',
    stack: 'Expo / React Native',
    number: '01',
    skills: ['Native UI', 'React Native practices'],
    directive: 'Mobile conventions',
  },
  web: {
    name: 'Papertrail',
    stack: 'React / TypeScript',
    number: '02',
    skills: ['React composition', 'Web accessibility'],
    directive: 'Web conventions',
  },
  api: {
    name: 'Relay',
    stack: 'Bun / Hono',
    number: '03',
    skills: ['API design', 'Auth patterns'],
    directive: 'Backend conventions',
  },
  swift: {
    name: 'Daylight',
    stack: 'Swift / SwiftUI',
    number: '04',
    skills: ['SwiftUI patterns', 'Apple accessibility'],
    directive: 'Apple conventions',
  },
} as const;
export type ProjectKey = keyof typeof projects;

export const library = [
  { name: 'Native UI', kind: 'Skill', code: 'S', projects: ['expo'] },
  { name: 'React composition', kind: 'Skill', code: 'S', projects: ['web'] },
  { name: 'API design', kind: 'Skill', code: 'S', projects: ['api'] },
  { name: 'SwiftUI patterns', kind: 'Skill', code: 'S', projects: ['swift'] },
  { name: 'React Native practices', kind: 'Skill', code: 'S', projects: ['expo'] },
  { name: 'Web accessibility', kind: 'Skill', code: 'S', projects: ['web'] },
  { name: 'Auth patterns', kind: 'Skill', code: 'S', projects: ['api'] },
  { name: 'Apple accessibility', kind: 'Skill', code: 'S', projects: ['swift'] },
  { name: 'Project docs', kind: 'MCP', code: 'M', projects: ['expo', 'web', 'api', 'swift'] },
  {
    name: 'Your conventions',
    kind: 'Directive',
    code: 'R',
    projects: ['expo', 'web', 'api', 'swift'],
  },
  { name: 'Design Plugin', kind: 'Native reference', code: 'P', projects: [] },
  { name: 'Deployment guide', kind: 'Skill', code: 'S', projects: [] },
] as const;

export const harnesses = {
  claude: {
    name: 'Claude Code',
    skill: '.claude/skills/',
    guidance: 'CLAUDE.md',
    mcp: '.mcp.json',
  },
  codex: {
    name: 'Codex',
    skill: '.agents/skills/',
    guidance: 'AGENTS.md',
    mcp: '.codex/config.toml',
  },
  kiro: {
    name: 'Kiro',
    skill: '.kiro/skills/',
    guidance: 'AGENTS.md',
    mcp: '.kiro/settings/mcp.json',
  },
  opencode: {
    name: 'OpenCode',
    skill: '.agents/skills/',
    guidance: 'AGENTS.md',
    mcp: 'opencode.json',
  },
  antigravity: {
    name: 'Antigravity',
    skill: '.agents/skills/',
    guidance: 'AGENTS.md',
    mcp: '.agents/mcp_config.json',
  },
  grok: {
    name: 'Grok CLI',
    skill: '.grok/skills/',
    guidance: 'AGENTS.md',
    mcp: '.grok/config.toml',
  },
} as const;
export type HarnessKey = keyof typeof harnesses;
