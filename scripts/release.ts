import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version';
import { bundleCli, compileNative } from './release-build';
import { stagePublicFiles } from './release-content';
import { releaseDirectory } from './release-files';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseTargets = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'windows-x64',
] as const;
const output = resolve(process.argv[2] || join(root, '.local/releases/tapster'));

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(VERSION))
  throw new Error(`package.json version must be SemVer, got ${VERSION}.`);

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed in ${cwd}.`);
}

await mkdir(output, { recursive: true });
await releaseDirectory(root, '.local/releases');
const temporary = await mkdtemp(join(root, '.local/releases/.tapster-'));
try {
  await releaseDirectory(temporary, 'stage');
  const stage = join(temporary, 'stage');
  await stagePublicFiles(root, stage);
  const bundle = await bundleCli(root, stage);
  for (const target of releaseTargets) {
    const windows = target.startsWith('windows');
    const name = windows ? 'rigshelf.exe' : 'rigshelf';
    const folder = join(temporary, target);
    await mkdir(folder);
    await compileNative(stage, bundle, `bun-${target}`, join(folder, name));
    const [os, arch] = target.replace('x64', 'amd64').split('-');
    const archive = join(output, `rigshelf_${VERSION}_${os}_${arch}.${windows ? 'zip' : 'tar.gz'}`);
    await rm(archive, { force: true });
    if (windows) await run(['zip', '-qX', archive, name], folder);
    else await run(['tar', '-C', folder, '-czf', archive, name], folder);
    process.stdout.write(`Prepared ${archive}\n`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
