import { join } from 'node:path';
import type { Provider } from './model';
import { adapter } from './providers';

export async function projectMcpFile(project: string, provider: Provider): Promise<string | null> {
  if (provider !== 'opencode') return adapter(provider).mcpFile;
  const json = await Bun.file(join(project, 'opencode.json')).exists();
  const jsonc = await Bun.file(join(project, 'opencode.jsonc')).exists();
  if (json && jsonc)
    throw new Error(
      'Both opencode.json and opencode.jsonc exist. Choose one active project configuration before setup.',
    );
  return jsonc ? 'opencode.jsonc' : 'opencode.json';
}
