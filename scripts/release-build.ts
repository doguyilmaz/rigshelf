import { chmod, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const nativeTargets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-arm64',
  'bun-linux-x64',
  'bun-linux-arm64-musl',
  'bun-linux-x64-musl',
  'bun-windows-arm64',
  'bun-windows-x64',
] as const;
export type NativeTarget = (typeof nativeTargets)[number];

export async function bundleCli(root: string, outdir: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(root, 'src/cli.ts')],
    target: 'bun',
    minify: true,
    env: 'disable',
    sourcemap: 'none',
    outdir,
    naming: 'rigshelf.js',
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  return join(outdir, 'rigshelf.js');
}

/** Compiles a bundled CLI with the staged `dist` web assets embedded; `stage` must contain `dist`. */
export async function compileNative(
  stage: string,
  bundle: string,
  target: NativeTarget,
  outfile: string,
  executable?: string,
): Promise<void> {
  const command = [
    process.execPath,
    'build',
    'rigshelf.js',
    '--compile',
    `--target=${target}`,
    '--asset',
    'dist',
    '--outfile',
    outfile,
    '--minify',
    '--env=disable',
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-tsconfig',
    '--no-compile-autoload-package-json',
  ];
  const runtime =
    executable ||
    (target === `bun-${process.platform}-${process.arch}` ? process.execPath : undefined);
  if (runtime) command.push(`--compile-executable-path=${resolve(runtime)}`);
  const entry = join(stage, 'rigshelf.js');
  if (resolve(bundle) !== entry) await copyFile(bundle, entry);
  try {
    const child = Bun.spawn(command, { cwd: stage, stdout: 'inherit', stderr: 'inherit' });
    if ((await child.exited) !== 0) throw new Error(`Native compilation failed for ${target}.`);
  } finally {
    if (resolve(bundle) !== entry) await rm(entry, { force: true });
  }
  await chmod(outfile, 0o755);
}
