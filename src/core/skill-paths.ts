import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { assertWritePath, inside, safeRelative } from './safety';

const skillPath = /^(\.(?:agents|claude|codex|kiro|grok)\/skills)\/([^/]+)\/(.+)$/;
/** Follow only project-local aliases for the same skill; never follow a global installation. */
export async function skillOutputPath(project: string, path: string): Promise<string> {
  safeRelative(path);
  const original = path.match(skillPath);
  if (!original) return path;
  let ancestor = join(project, path);
  const suffix: string[] = [];
  while (ancestor !== project && inside(project, ancestor)) {
    try {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink()) {
        const target = join(await realpath(ancestor), ...suffix);
        const resolved = relative(project, target).split('\\').join('/');
        const destination = resolved.match(skillPath);
        if (
          !inside(project, target) ||
          !destination ||
          original[2] !== destination[2] ||
          original[3] !== destination[3]
        )
          throw new Error(
            `Refusing linked output: ${path}. The alias leaves its project-local skill location; copy it into the project before setup.`,
          );
        await assertWritePath(project, resolved);
        return resolved;
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const parent = dirname(ancestor);
    suffix.unshift(relative(parent, ancestor));
    ancestor = parent;
  }
  return path;
}
