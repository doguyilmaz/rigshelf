import { z } from 'zod';
import { AiConnectionsSchema } from './ai-connections';
import { MAX_PROJECT_KIT_ENTRIES } from './kit-limits';
import type { PluginLocation, PluginReference } from './plugin-model';

export const SCHEMA_VERSION = 1;
export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 2000;
const providerIds = ['claude', 'codex', 'kiro', 'opencode', 'antigravity', 'grok'] as const;
export const ProviderSchema = z.enum(providerIds);
export const ProvidersSchema = z
  .array(ProviderSchema)
  .min(1)
  .max(providerIds.length)
  .refine((values) => new Set(values).size === values.length, 'Choose each harness only once.');
export type Provider = z.infer<typeof ProviderSchema>;
export const KindSchema = z.enum(['skill', 'mcp', 'plugin', 'resource']);
export type Kind = z.infer<typeof KindSchema>;
const TagSchema = z.string().min(1).max(64);
export const RecordIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const SafeName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
export const McpSchema = z
  .object({
    transport: z.enum(['stdio', 'http', 'sse']),
    command: z.string().trim().min(1).max(512).optional(),
    args: z.array(z.string().max(2000)).max(100).default([]),
    url: z
      .string()
      .max(4096)
      .refine((value) => {
        try {
          const template = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)
            ? 'https://rigshelf.invalid'
            : value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'placeholder');
          const url = new URL(template);
          return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Remote MCP endpoints must use HTTP(S) without embedded credentials.')
      .optional(),
    env: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(200),
        z.string().max(2000),
      )
      .default({}),
    headers: z
      .record(
        z
          .string()
          .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
          .max(200),
        z
          .string()
          .max(2000)
          .refine(
            (value) => !/[\r\n\0]/.test(value),
            'Header values cannot contain control separators.',
          ),
      )
      .default({}),
    cwd: z.string().max(4096).optional(),
    allowedTools: z.array(z.string().min(1).max(200)).max(500).optional(),
    deniedTools: z.array(z.string().min(1).max(200)).max(500).optional(),
  })
  .refine(
    (value) => (value.transport === 'stdio' ? Boolean(value.command) : Boolean(value.url)),
    'MCP needs a command or URL',
  );
export type Mcp = z.infer<typeof McpSchema>;
export interface Finding {
  code: string;
  level: 'info' | 'review' | 'block';
  message: string;
  file?: string;
}
export interface Entry {
  id: string;
  name: string;
  description: string;
  kind: Kind;
  tags: string[];
  sourceId: string;
  digest: string;
  custom: boolean;
  body: string;
  findings: Finding[];
  updatedAt: string;
  upstreamPath?: string;
  upstreamRef?: string;
  mcp?: Mcp;
  archived?: boolean;
  derivedFrom?: string;
  plugin?: PluginReference;
  origins?: { sourceId: string; url?: string; path?: string; ref?: string }[];
}
export interface Source {
  id: string;
  name: string;
  url: string;
  type: 'github' | 'local' | 'listing' | 'plugin' | 'resource';
  recipe: string;
  status: 'unchecked' | 'reachable' | 'unavailable';
  checkedAt?: string;
  notes: string;
  latestRef?: string;
  skillCount?: number;
  focusSkill?: string;
  categories?: string[];
  recipeKind?: 'suggested' | 'explicit';
  previousUrls?: { url: string; checkedAt?: string; ref?: string }[];
  repository?: {
    owner: string;
    url: string;
    license?: string;
    archived: boolean;
    description?: string;
    checkedAt: string;
  };
}
export interface Installation {
  entryId: string;
  projectId: string | null;
  provider: string;
  path: string;
  scope: 'project' | 'global';
  lastSeen: string;
  storage?: 'project-config' | 'user-config' | 'user-project-config' | 'plugin-cache';
  plugin?: PluginLocation;
}
export interface DocumentLocation {
  id: string;
  path: string;
  sourcePath: string;
  canonicalPath: string;
  root: string;
  rootIdentity: string;
  relativePath: string;
  provider: string;
  scope: 'project' | 'user-project' | 'global';
  kind: 'instruction' | 'memory' | 'rule' | 'agent' | 'command' | 'config' | 'plugin' | 'hook';
  readOnly: boolean;
  aliases?: string[];
}
export interface Project {
  id: string;
  name: string;
  path: string;
  stacks: string[];
  dependencies: string[];
  providers: string[];
  documents: string[];
  documentLocations?: DocumentLocation[];
  aiFileLocations?: DocumentLocation[];
  inventoryWarnings?: string[];
  detectedAt: string;
  requirements: string;
  warnings?: string[];
  workspaces?: { name: string; path: string; stacks: string[] }[];
  discovery?: 'files' | 'configuration';
}
export const PresetSchema = z.object({
  id: SafeName,
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  parentId: SafeName.nullable(),
  stacks: z.array(TagSchema).max(50),
  selectors: z.array(z.string().min(1).max(100)).max(100),
  entryIds: z.array(z.string().min(1).max(150)).max(100).default([]),
  excludedIds: z.array(z.string().min(1).max(150)).max(1000).default([]),
  providers: ProvidersSchema,
});
export type Preset = z.infer<typeof PresetSchema>;
export const RuleSchema = z.object({
  id: SafeName,
  name: z.string().min(1).max(100),
  scope: z.string().min(1).max(200),
  content: z.string().max(MAX_TEXT_BYTES),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(1000),
  provenance: z.string().max(1000).default('Custom'),
});
export type Rule = z.infer<typeof RuleSchema>;
export const SetupSchema = z.object({
  projectPath: z.string().min(1).max(4096),
  providers: ProvidersSchema,
  presetId: z.string().optional(),
  entryIds: z.array(z.string()).max(MAX_PROJECT_KIT_ENTRIES),
  requirements: z.string().max(10000).default(''),
  includeRules: z.boolean().default(true),
  allowReviewed: z.boolean().default(false),
  replaceExisting: z.boolean().default(false),
});
export type SetupRequest = z.input<typeof SetupSchema>;
export interface PackedFile {
  path: string;
  content: string;
  executable: boolean;
}
export interface Change {
  path: string;
  beforeHash: string | null;
  before: string | null;
  after: string | null;
  reason: string;
  beforeMode?: number;
  afterMode?: number;
}
export interface Plan {
  id: string;
  projectPath: string;
  providers: Provider[];
  entries: string[];
  createdAt: string;
  changes: Change[];
  warnings: string[];
  status: 'planned' | 'applied' | 'rolled-back';
  requirements?: string;
  presetId?: string;
  purpose?: 'setup' | 'document';
  rootIdentity?: string | null;
  ownershipBefore?: import('./ownership').Ownership;
  ownershipAfter?: import('./kit').Kit;
  manifestHash?: string;
  requiresAdoption?: boolean;
  createdDirectories?: string[];
}
export const SettingsSchema = z.object({
  roots: z.array(z.string().min(1)).max(20),
  scanGlobals: z.boolean(),
  aiConfigRoots: z
    .array(
      z
        .object({
          path: z
            .string()
            .trim()
            .min(1)
            .max(4096)
            .refine(
              (path) => /^(?:\/|~\/|[A-Za-z]:[\\/])/.test(path),
              'Choose an absolute AI configuration folder.',
            ),
          provider: z.enum([
            'claude',
            'codex',
            'kiro',
            'opencode',
            'antigravity',
            'gemini',
            'grok',
            'custom',
          ]),
        })
        .strict(),
    )
    .max(20)
    .default([]),
  defaultProviders: ProvidersSchema,
  aiRunner: z
    .enum([
      'none',
      'session',
      'claude',
      'codex',
      'kiro',
      'opencode',
      'antigravity',
      'grok',
      'ollama',
      'compatible',
    ])
    .default('none'),
  ollamaModel: z.string().max(100).default(''),
  aiModel: z.string().max(100).default(''),
  aiConnections: AiConnectionsSchema,
  discoveryDays: z.number().int().min(0).max(365).default(0),
  discoveryQueries: z.array(z.string().min(2).max(100)).max(20).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;
