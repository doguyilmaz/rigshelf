import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from 'tar-stream';
import { dependencyNotices } from '../scripts/dependency-notices';
import { extractPackage } from '../scripts/package-extract';
import { writeReleaseArchive } from '../scripts/release-archive';
import { runtimeAsset } from '../scripts/release-content';
import {
  assertReleasePrivacy,
  releaseFile,
  releasePath,
  releaseTree,
} from '../scripts/release-files';

await mkdir('.local/tests', { recursive: true });
const root = await mkdtemp(join(process.cwd(), '.local/tests/release-'));
afterAll(async () => rm(root, { recursive: true, force: true }));

test('packaging refuses linked input and traversal instead of copying outside bytes', async () => {
  const directory = join(root, 'links');
  await mkdir(directory);
  await writeFile(join(directory, 'ordinary.txt'), 'fixture');
  await symlink('ordinary.txt', join(directory, 'alias.txt'));
  await expect(releaseFile(root, 'links/alias.txt')).rejects.toThrow();
  await link(join(directory, 'ordinary.txt'), join(directory, 'hardlink.txt'));
  await expect(releaseFile(root, 'links/hardlink.txt')).rejects.toThrow();
  await symlink(directory, join(root, 'linked-directory'));
  await expect(releaseTree(root, 'linked-directory')).rejects.toThrow();
  for (const path of ['../outside', '/absolute', 'dir/../outside', 'dir\\outside'])
    expect(() => releasePath(path)).toThrow();
});

test('runtime allowlist excludes incidental data and prototypes from the release', () => {
  for (const path of [
    'dist/catalog.sqlite',
    'dist/credentials.json',
    'dist/.env',
    'dist/assets/private-123456.json',
    'dist/prototypes/library.js',
    'dist/assets/main-123456.js.map',
  ])
    expect(runtimeAsset(path)).toBe(false);
  for (const path of [
    'dist/index.html',
    'dist/assets/main-Ab12_cd.js',
    'dist/fonts/newsreader.ttf',
  ])
    expect(runtimeAsset(path)).toBe(true);
});

async function unpack(bytes: Buffer): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const reader = extract();
  reader.on('entry', (header, stream, next) => {
    const parts: Buffer[] = [];
    stream.on('data', (part: unknown) => {
      if (!(part instanceof Uint8Array)) throw new Error('Unexpected fixture archive chunk.');
      parts.push(Buffer.from(part));
    });
    stream.on('end', () => {
      files.set(header.name, Buffer.concat(parts));
      next();
    });
  });
  const finished = new Promise<void>((accept, reject) => {
    reader.on('finish', accept);
    reader.on('error', reject);
  });
  reader.end(Bun.gunzipSync(new Uint8Array(bytes)));
  await finished;
  return files;
}

test('release inventory, archive bytes and checksum agree; unsafe replacement is refused', async () => {
  const directory = join(root, 'payload');
  await mkdir(directory);
  await writeFile(join(directory, 'fixture.txt'), 'deliberate public fixture');
  const file = await releaseFile(root, 'payload/fixture.txt');
  expect(() =>
    assertReleasePrivacy(
      [{ ...file, bytes: Buffer.from('embedded /home/private-developer/build path') }],
      ['/home/private-developer'],
    ),
  ).toThrow();
  const destination = join(root, 'fixture.tar.gz');
  await writeReleaseArchive(destination, [file], 'portable', false);
  const bytes = await readFile(destination);
  const files = await unpack(bytes);
  expect([...files.keys()]).toEqual(['payload/fixture.txt', 'manifest.json']);
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  expect(manifest.files).toEqual([
    { path: file.path, bytes: file.bytes.length, mode: 0o644, sha256: file.sha256 },
  ]);
  expect(files.get(file.path)).toEqual(file.bytes);
  expect(await readFile(`${destination}.sha256`, 'utf8')).toBe(
    `${createHash('sha256').update(bytes).digest('hex')}  fixture.tar.gz\n`,
  );
  await expect(writeReleaseArchive(destination, [file], 'portable', false)).rejects.toThrow();
  const alias = join(root, 'output-alias.tar.gz');
  await symlink(destination, alias);
  await expect(writeReleaseArchive(alias, [file], 'portable', true)).rejects.toThrow();
  await expect(
    writeReleaseArchive(
      join(root, 'tampered.tar.gz'),
      [{ ...file, bytes: Buffer.from('changed') }],
      'portable',
      false,
    ),
  ).rejects.toThrow();
  await expect(
    writeReleaseArchive(
      join(root, 'traversal.tar.gz'),
      [{ ...file, path: '../outside' }],
      'portable',
      false,
    ),
  ).rejects.toThrow();
});

test('package inspection rejects duplicate manifest claims even with a matching archive checksum', async () => {
  const directory = join(root, 'duplicate-manifest');
  await mkdir(directory);
  await writeFile(join(directory, 'A.txt'), 'alpha');
  await writeFile(join(directory, 'B.txt'), 'omega');
  const first = await releaseFile(root, 'duplicate-manifest/A.txt');
  const second = await releaseFile(root, 'duplicate-manifest/B.txt');
  const archive = join(root, 'duplicate-manifest.tar.gz');
  await writeReleaseArchive(archive, [first, second], 'portable', false);
  const compressed = await readFile(archive);
  const original = Buffer.from(Bun.gunzipSync(new Uint8Array(compressed))).toString('utf8');
  const tampered = original
    .replace(`"path": "${second.path}"`, `"path": "${first.path}"`)
    .replace(second.sha256, first.sha256);
  expect(tampered).not.toBe(original);
  const bytes = Bun.gzipSync(new Uint8Array(Buffer.from(tampered)));
  await writeFile(archive, bytes);
  await writeFile(
    `${archive}.sha256`,
    `${createHash('sha256').update(bytes).digest('hex')}  duplicate-manifest.tar.gz\n`,
  );
  const destination = join(root, 'duplicate-manifest-extracted');
  await mkdir(destination);
  await expect(extractPackage(archive, destination)).rejects.toThrow('Invalid manifest entry');
});

test('release notices include nested locked dependencies and omit unrelated local packages', async () => {
  const directory = join(root, 'license-input');
  const destination = join(root, 'license-output');
  const parent = join(directory, 'node_modules/parent');
  const child = join(parent, 'node_modules/child');
  const unrelated = join(directory, 'node_modules/private-local');
  for (const path of [child, unrelated, destination]) await mkdir(path, { recursive: true });
  await writeFile(
    join(directory, 'bun.lock'),
    JSON.stringify({
      packages: {
        parent: ['parent@1.0.0'],
        'parent/child': ['child@2.0.0'],
      },
    }),
  );
  await writeFile(
    join(parent, 'package.json'),
    JSON.stringify({ name: 'parent', version: '1.0.0', license: 'MIT' }),
  );
  await writeFile(
    join(child, 'package.json'),
    JSON.stringify({ name: 'child', version: '2.0.0', license: 'MIT' }),
  );
  await writeFile(join(parent, 'LICENSE'), 'Fictional parent notice.');
  await writeFile(join(child, 'LICENSE'), 'Fictional nested notice.');
  await writeFile(join(unrelated, 'LICENSE'), 'Private local package fixture: do not package.');
  await dependencyNotices(directory, destination);
  const result = await readFile(join(destination, 'DEPENDENCY-LICENSES.txt'), 'utf8');
  expect(result).toContain('child@2.0.0');
  expect(result).toContain('Fictional nested notice.');
  expect(result).not.toContain('Private local package fixture');
  expect(result).not.toContain(directory);
});

for (const kind of ['notice-hardlink', 'metadata-hardlink', 'ancestor-symlink']) {
  test(`release notices reject ${kind} inputs before retaining any outside bytes`, async () => {
    const directory = join(root, kind);
    const input = join(directory, 'input');
    const output = join(directory, 'output');
    const dependency = join(input, 'node_modules/fixture-package');
    await mkdir(dependency, { recursive: true });
    await mkdir(output);
    await writeFile(
      join(input, 'bun.lock'),
      JSON.stringify({
        packages: {
          'fixture-package': ['fixture-package@1.0.0'],
        },
      }),
    );
    const metadata = JSON.stringify({ name: 'fixture-package', version: '1.0.0', license: 'MIT' });
    await writeFile(join(dependency, 'package.json'), metadata);
    await writeFile(join(dependency, 'LICENSE'), 'Public fixture notice.');
    if (kind === 'ancestor-symlink') {
      const external = join(directory, 'external-modules');
      await rename(join(input, 'node_modules'), external);
      await symlink(external, join(input, 'node_modules'));
    } else {
      const name = kind === 'notice-hardlink' ? 'LICENSE' : 'package.json';
      const privateFile = join(directory, 'private-fixture.txt');
      await writeFile(
        privateFile,
        name === 'LICENSE' ? 'Private dummy bytes: never package.' : metadata,
      );
      await rm(join(dependency, name));
      await link(privateFile, join(dependency, name));
    }
    await expect(dependencyNotices(input, output)).rejects.toThrow();
    expect(await Bun.file(join(output, 'DEPENDENCY-LICENSES.txt')).exists()).toBe(false);
  });
}
