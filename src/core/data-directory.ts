import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface DirectoryEnvironment {
  RIGSHELF_DATA_DIR?: string;
  KITFOLD_DATA_DIR?: string;
}

/** Resolve storage without moving, copying, merging or opening either catalog. */
export function defaultDataDirectory(
  options: { home?: string; environment?: DirectoryEnvironment } = {},
): string {
  const environment = options.environment ?? process.env;
  const explicit = environment.RIGSHELF_DATA_DIR || environment.KITFOLD_DATA_DIR;
  if (explicit) return explicit;
  const home = options.home ?? homedir();
  // Storage names are compatibility keys; changing the display brand must not change them.
  const current = join(home, '.local', 'share', 'rigshelf');
  const legacy = join(home, '.local', 'share', 'kitfold');
  const currentCatalog = existsSync(join(current, 'catalog.sqlite'));
  const legacyCatalog = existsSync(join(legacy, 'catalog.sqlite'));
  if (currentCatalog && legacyCatalog)
    throw new Error(
      'Both Rigshelf and legacy Kitfold catalogs exist. Set RIGSHELF_DATA_DIR to the catalog directory you want to open. Neither catalog was moved or merged.',
    );
  if (currentCatalog) return current;
  // Retain even a partial legacy folder; changing its name must not strand recovery files.
  return legacyCatalog || existsSync(legacy) ? legacy : current;
}

export function usesLegacyDirectoryName(directory: string): boolean {
  return basename(resolve(directory)) === 'kitfold';
}
