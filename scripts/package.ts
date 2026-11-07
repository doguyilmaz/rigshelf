import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { VERSION } from '../src/version';
import { dependencyNotices } from './dependency-notices';
import { type Delivery, writeReleaseArchive } from './release-archive';
import { installReadme, stageNativeDocuments, stagePublicFiles } from './release-content';
import { assertReleasePrivacy, releaseDirectory, releaseTree } from './release-files';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, '.local/releases');
const nativeTargets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-arm64',
  'bun-linux-x64',
  'bun-linux-arm64-musl',
  'bun-linux-x64-musl',
  'bun-windows-arm64',
  'bun-windows-x64',
] as const;
type NativeTarget = (typeof nativeTargets)[number];

function launcher(command: string): string {
  return `#!/bin/sh
set -eu
script=$0
case "$script" in /*) ;; *) script=$PWD/$script ;; esac
remaining_links=40
while [ -L "$script" ]; do
  if [ "$remaining_links" -eq 0 ]; then
    printf '%s\\n' 'Rigshelf launcher has too many symbolic links.' >&2
    exit 1
  fi
  remaining_links=$((remaining_links - 1))
  directory=$(CDPATH= cd "$(/usr/bin/dirname "$script")" && pwd -P)
  target=$(/usr/bin/readlink "$script")
  case "$target" in /*) script=$target ;; *) script=$directory/$target ;; esac
done
location=$(CDPATH= cd "$(/usr/bin/dirname "$script")" && pwd -P)
exec ${command}
`;
}

async function portable(stage: string): Promise<void> {
  const built = await Bun.build({
    entrypoints: [join(root, 'src/cli.ts')],
    target: 'bun',
    minify: true,
    env: 'disable',
    sourcemap: 'none',
    outdir: join(stage, 'bin'),
    naming: 'rigshelf.js',
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  await writeFile(join(stage, 'bunfig.toml'), '# Packaged runtime configuration.\n');
  await writeFile(
    join(stage, 'bin/rigshelf'),
    launcher(
      'bun --no-env-file --no-install --config="$location/../bunfig.toml" "$location/rigshelf.js" "$@"',
    ),
    { mode: 0o755 },
  );
  await writeFile(join(stage, 'bin/kitfold'), launcher('"$location/rigshelf" "$@"'), {
    mode: 0o755,
  });
  await writeFile(
    join(stage, 'package.json'),
    `${JSON.stringify({ name: 'rigshelf-local', version: VERSION, private: true, type: 'module', bin: { rigshelf: 'bin/rigshelf', kitfold: 'bin/kitfold' } }, null, 2)}\n`,
  );
  await installReadme(stage, 'portable');
}

async function archive(stage: string, delivery: Delivery, replace: boolean): Promise<string> {
  const files = await releaseTree(stage, '.payload');
  assertReleasePrivacy(files, [root, homedir()]);
  const artifact = join(output, `rigshelf-${VERSION}-${delivery}.tar.gz`);
  await writeReleaseArchive(
    artifact,
    files.map((file) => ({ ...file, path: file.path.slice('.payload/'.length) })),
    delivery,
    replace,
  );
  return artifact;
}

async function native(
  portableStage: string,
  nativeStage: string,
  target: NativeTarget,
  executable: string | undefined,
): Promise<void> {
  const name = target.includes('windows') ? 'rigshelf.exe' : 'rigshelf';
  const command = [
    process.execPath,
    'build',
    'rigshelf.js',
    '--compile',
    `--target=${target}`,
    '--asset',
    'dist',
    '--outfile',
    join(nativeStage, name),
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
  await copyFile(join(portableStage, 'bin/rigshelf.js'), join(portableStage, 'rigshelf.js'));
  try {
    const child = Bun.spawn(command, { cwd: portableStage, stdout: 'inherit', stderr: 'inherit' });
    if ((await child.exited) !== 0) throw new Error('Native compilation failed.');
  } finally {
    await rm(join(portableStage, 'rigshelf.js'), { force: true });
  }
  await chmod(join(nativeStage, name), 0o755);
  if (!target.includes('windows'))
    await writeFile(join(nativeStage, 'kitfold'), launcher('"$location/rigshelf" "$@"'), {
      mode: 0o755,
    });
  else await writeFile(join(nativeStage, 'kitfold.cmd'), '@echo off\r\n"%~dp0rigshelf.exe" %*\r\n');
  await stageNativeDocuments(root, nativeStage);
  await installReadme(nativeStage, target);
  await copyFile(
    join(portableStage, 'DEPENDENCY-LICENSES.txt'),
    join(nativeStage, 'DEPENDENCY-LICENSES.txt'),
  );
  const assets = await releaseTree(portableStage, 'dist');
  await writeFile(
    join(nativeStage, 'web-assets.json'),
    `${JSON.stringify(
      assets.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256 })),
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      native: { type: 'boolean' },
      target: { type: 'string' },
      'executable-path': { type: 'string' },
      replace: { type: 'boolean' },
    },
  });
  if (values.target && !values.native) throw new Error('--target requires --native.');
  const target = values.target || `bun-${process.platform}-${process.arch}`;
  if (values.native && !nativeTargets.includes(target as NativeTarget))
    throw new Error(`Unsupported target. Choose ${nativeTargets.join(', ')}.`);
  await releaseDirectory(root, '.local/releases');
  const temporary = await mkdtemp(join(output, '.stage-'));
  const payload = join(temporary, '.payload');
  try {
    await releaseDirectory(temporary, '.payload');
    await stagePublicFiles(root, payload);
    await portable(payload);
    await dependencyNotices(root, payload);
    const artifacts = [await archive(temporary, 'portable', values.replace || false)];
    if (values.native) {
      const nativeRoot = join(temporary, 'native');
      await releaseDirectory(temporary, 'native/.payload');
      await native(
        payload,
        join(nativeRoot, '.payload'),
        target as NativeTarget,
        values['executable-path'],
      );
      artifacts.push(await archive(nativeRoot, target as NativeTarget, values.replace || false));
    }
    for (const path of artifacts) process.stdout.write(`Prepared ${path}\n`);
    process.stdout.write(
      'Local artifacts only. Inspect checksums and installation smoke results before publishing.\n',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
