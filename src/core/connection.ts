import { z } from 'zod';
import { McpSchema, ProviderSchema } from './model';
import { adapter, mergeMcp } from './providers';
import { checkedProject } from './safety';

const ConnectionSchema = z.object({
  provider: ProviderSchema,
  writable: z.boolean().default(false),
  projectPath: z.string().max(4096).default(''),
});
export async function connection(raw: unknown) {
  const input = ConnectionSchema.parse(raw);
  if (input.writable && !input.projectPath.trim())
    throw new Error('Choose an explicit project root for a writable connection.');
  const project = input.writable ? await checkedProject(input.projectPath) : undefined;
  const definition = McpSchema.parse({
    transport: 'stdio',
    command: 'kitfold',
    args: ['mcp', ...(project ? ['--write', '--root', project] : [])],
  });
  const spec = adapter(input.provider);
  return {
    file: spec.mcpFile,
    content: mergeMcp(null, input.provider, { kitfold: definition }),
    writable: input.writable,
    note: spec.note,
  };
}
