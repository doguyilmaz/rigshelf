import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version';
import type { Delivery } from './release-archive';
import { releaseFile, releaseTree, stageFile } from './release-files';

const documents = [
  ...new Bun.Glob('docs/*.md').scanSync(fileURLToPath(new URL('..', import.meta.url))),
].sort();
const publicFiles = [
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'web/public/fonts/instrumentsans-OFL.txt',
  'web/public/fonts/newsreader-OFL.txt',
  'plugin/skills/rigshelf/SKILL.md',
  ...documents,
];

export function runtimeAsset(path: string): boolean {
  return (
    path === 'dist/index.html' ||
    path === 'dist/favicon.svg' ||
    /^dist\/assets\/[\w-]+-[\w-]{6,}\.(?:js|css)$/.test(path) ||
    /^dist\/fonts\/(?:instrument-sans\.ttf|newsreader\.ttf|instrumentsans-OFL\.txt|newsreader-OFL\.txt)$/.test(
      path,
    )
  );
}

export async function stagePublicFiles(root: string, stage: string): Promise<void> {
  const assets = (await releaseTree(root, 'dist')).filter((file) => runtimeAsset(file.path));
  if (!assets.some((file) => file.path === 'dist/index.html'))
    throw new Error('Build the web interface before packaging.');
  for (const file of assets) await stageFile(stage, file);
  await stageNativeDocuments(root, stage);
}

export async function stageNativeDocuments(root: string, stage: string): Promise<void> {
  for (const path of publicFiles) {
    const file = await releaseFile(root, path);
    await stageFile(stage, { ...file, path: path === 'README.md' ? 'SOURCE-README.md' : path });
  }
}

export async function installReadme(stage: string, delivery: Delivery): Promise<void> {
  const portable = delivery === 'portable';
  const command = portable
    ? './bin/rigshelf'
    : delivery.includes('windows')
      ? '.\\rigshelf.exe'
      : './rigshelf';
  await writeFile(
    join(stage, 'README.md'),
    `# Rigshelf ${VERSION}

${portable ? 'Requires Bun 1.4.4 or newer. Dependencies and the complete web interface are bundled.' : `Standalone executable for ${delivery}. Bun and the web interface are included; no separate runtime installation is needed.`}

## Start

Keep this directory together. From a terminal in this directory:

\`\`\`sh
${command} ui
\`\`\`

Open the private URL printed in the terminal. Rigshelf listens on your own machine only. Keep that access URL private. Ctrl-C stops the server after owned operations finish.

Choose a project, select a focused kit and its Harnesses, review the file changes, then Apply. Library content stays separate from activation. [First-use walkthrough](docs/QUICKSTART.md).

## CLI and MCP

\`\`\`sh
${command} --help
${command} --version
${command} mcp
\`\`\`

Add ${portable ? 'the bin directory' : 'this directory'} to your own PATH for short commands. Preserve the kitfold compatibility launcher alongside Rigshelf; generated MCP bridges use it. [MCP connection guide](docs/MCP.md).

## Data and updates

Application files are separate from your private catalog. Fresh installs use ~/.local/share/rigshelf; existing Kitfold data stays in place. RIGSHELF_DATA_DIR chooses another private directory. Replacing this application directory does not move or remove that data. Use the [reviewed backup flow](docs/BACKUP-SYNC.md) before changing machines.

The archive checksum sidecar and manifest.json identify exact bytes. They do not establish publisher identity or certify third-party instructions. Native artifacts are local builds without Rigshelf publisher signing or notarization. Verify a target before advertising it as supported.

[Delivery details](docs/DISTRIBUTION.md) · [Security](SECURITY.md) · [Source overview](SOURCE-README.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
`,
  );
}
