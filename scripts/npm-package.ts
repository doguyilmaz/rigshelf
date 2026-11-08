import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version';
import { dependencyNotices } from './dependency-notices';
import { bundleCli } from './release-build';
import { runtimeAsset } from './release-content';
import { releaseFile, releaseTree, stageFile } from './release-files';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stage = resolve(process.argv[2] || join(root, '.local/releases/npm'));
const publicFiles = ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md'];

await rm(stage, { recursive: true, force: true });
const assets = (await releaseTree(root, 'dist')).filter((file) => runtimeAsset(file.path));
if (!assets.some((file) => file.path === 'dist/index.html'))
  throw new Error('Build the web interface before assembling the npm package.');
for (const file of assets) await stageFile(stage, file);
for (const path of publicFiles) await stageFile(stage, await releaseFile(root, path));
await dependencyNotices(root, stage);

const bundle = await bundleCli(root, join(stage, 'bin'));
if (!(await readFile(bundle, 'utf8')).startsWith('#!/usr/bin/env bun\n'))
  throw new Error('The CLI entry must start with a Bun shebang.');
await chmod(bundle, 0o755);

await writeFile(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: '@doguyilmaz/rigshelf',
      version: VERSION,
      description:
        'Set up project-scoped Skills, MCP servers and guidance for coding agents from your private library.',
      keywords: ['skills', 'mcp', 'agents', 'claude-code', 'codex', 'project-setup'],
      homepage: 'https://github.com/doguyilmaz/rigshelf',
      bugs: { url: 'https://github.com/doguyilmaz/rigshelf/issues' },
      repository: { type: 'git', url: 'git+https://github.com/doguyilmaz/rigshelf.git' },
      license: 'MIT',
      author: 'Dogu Yilmaz',
      type: 'module',
      bin: { rigshelf: './bin/rigshelf.js' },
      files: [
        'bin',
        'dist',
        'LICENSE',
        'README.md',
        'THIRD_PARTY_NOTICES.md',
        'DEPENDENCY-LICENSES.txt',
      ],
      engines: { bun: '>=1.4.4' },
      publishConfig: { access: 'public' },
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Prepared ${stage}\n`);
