import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultDataDirectory(
  options: { home?: string; environment?: { RIGSHELF_DATA_DIR?: string } } = {},
): string {
  const environment = options.environment ?? process.env;
  return (
    environment.RIGSHELF_DATA_DIR || join(options.home ?? homedir(), '.local', 'share', 'rigshelf')
  );
}
