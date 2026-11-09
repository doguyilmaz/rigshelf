import { lstat, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { readLocalBytes } from '../src/core/local-files';

const PackageSchema = z.object({
  name: z.string().max(200),
  version: z.string().max(100),
  license: z.unknown().optional(),
});
const LockSchema = z.object({ packages: z.record(z.string(), z.array(z.unknown())) });
const NOTICE_NAME = /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i;
const MAX_NOTICE_BYTES = 1024 * 1024;
const MAX_TOTAL_NOTICE_BYTES = 8 * 1024 * 1024;
const MAX_LOCKFILE_BYTES = 8 * 1024 * 1024;

function dependencyDirectory(root: string, key: string): string {
  const names = key.match(/(?:@[^/]+\/)?[^/]+/g) || [];
  if (
    names.join('/') !== key ||
    names.some(
      (name) =>
        !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) ||
        name.split('/').some((part) => part === '.' || part === '..'),
    )
  )
    throw new Error('Unsupported dependency key in lockfile.');
  return join(root, ...names.flatMap((name) => ['node_modules', name]));
}

async function installedDirectory(root: string, key: string): Promise<string | undefined> {
  const directory = dependencyDirectory(root, key);
  const parts = relative(root, directory).split(sep);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) return undefined;
    if (!info.isDirectory())
      throw new Error('Linked dependency directory excluded from packaging.');
  }
  return directory;
}

async function noticeText(directory: string): Promise<string[]> {
  const texts: string[] = [];
  for (const name of (await readdir(directory)).filter((name) => NOTICE_NAME.test(name)).sort()) {
    const path = join(directory, name);
    texts.push(`${name}\n${(await readLocalBytes(path, MAX_NOTICE_BYTES)).toString('utf8')}`);
  }
  return texts;
}

export async function dependencyNotices(root: string, destination: string): Promise<void> {
  const lock = LockSchema.parse(
    parse((await readLocalBytes(join(root, 'bun.lock'), MAX_LOCKFILE_BYTES)).toString('utf8')),
  );
  const identities = new Set(Object.values(lock.packages).map((entry) => entry[0]));
  const sections = [
    'Dependency notices for the installed, locked build inputs. Some packages are build-only.\n',
  ];
  let total = 0;
  for (const name of Object.keys(lock.packages).sort()) {
    const directory = await installedDirectory(root, name);
    if (!directory) continue;
    const metadataPath = join(directory, 'package.json');
    const metadata = PackageSchema.parse(
      JSON.parse((await readLocalBytes(metadataPath, MAX_NOTICE_BYTES)).toString('utf8')),
    );
    if (!identities.has(`${metadata.name}@${metadata.version}`))
      throw new Error('Installed dependency differs from lockfile.');
    const notices = await noticeText(directory);
    const license = typeof metadata.license === 'string' ? metadata.license : 'See package notices';
    const section = `\n${metadata.name}@${metadata.version}\nLicense: ${license}\n${notices.join('\n\n') || 'No root notice file supplied by this package.'}\n`;
    total += Buffer.byteLength(section);
    if (total > MAX_TOTAL_NOTICE_BYTES)
      throw new Error('Dependency notices exceed the release limit.');
    sections.push(section);
  }
  await writeFile(join(destination, 'DEPENDENCY-LICENSES.txt'), sections.join('\n'));
}
