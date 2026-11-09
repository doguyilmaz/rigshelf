import { z } from 'zod';

export const PluginReferenceSchema = z
  .object({
    format: z.literal('rigshelf-native-plugin-reference'),
    provider: z.enum(['claude', 'codex', 'opencode']),
    nativeId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\0\r\n\\]+$/),
    version: z.string().max(100).optional(),
    manifest: z.enum(['claude', 'codex', 'portable', 'module', 'npm', 'reference']),
    components: z
      .array(z.enum(['skills', 'agents', 'commands', 'hooks', 'mcp', 'apps', 'extensions']))
      .max(7),
    contentDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type PluginReference = z.infer<typeof PluginReferenceSchema>;
export type PluginEvidence = 'installed' | 'configured' | 'cached' | 'catalog' | 'local';
export interface PluginLocation {
  evidence: PluginEvidence;
  nativeId: string;
  version?: string;
  enabled?: boolean;
  declaredScope?: 'user' | 'project' | 'local';
}
