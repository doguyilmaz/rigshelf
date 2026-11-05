import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { type Header, pack } from 'tar-stream';
import { parseRepositoryArchive } from '../src/core/github-archive';

const ref = 'a'.repeat(40);
async function archive(
  entries: { header: Partial<Header> & { name: string }; body?: string }[],
): Promise<Uint8Array> {
  const tar = pack();
  const response = new Response(tar as unknown as ReadableStream);
  for (const entry of entries) tar.entry(entry.header, entry.body || '');
  tar.finalize();
  return gzipSync(new Uint8Array(await response.arrayBuffer()));
}
test('public archives preserve safe bytes and executable modes while leaving links inert', async () => {
  const bytes = await archive([
    { header: { name: `skills-${ref}/`, type: 'directory' } },
    { header: { name: `skills-${ref}/guide/SKILL.md`, mode: 0o644 }, body: 'Skill bytes.\n' },
    {
      header: { name: `skills-${ref}/guide/scripts/check.sh`, mode: 0o755 },
      body: '#!/bin/sh\nexit 0\n',
    },
    { header: { name: `skills-${ref}/guide/linked`, type: 'symlink', linkname: '/private/value' } },
  ]);
  const files = await parseRepositoryArchive(bytes, 'example/skills', ref);
  expect(files).toHaveLength(3);
  expect(Buffer.from(files[0].data!).toString()).toBe('Skill bytes.\n');
  expect(files[1].mode).toBe('100755');
  expect(files[2].mode).toBe('120000');
  expect(files[2].data).toBeUndefined();
});
test('public archive parsing rejects traversal, duplicate paths, special files and false commit roots', async () => {
  await expect(
    parseRepositoryArchive(
      await archive([{ header: { name: `skills-${ref}/../escape` }, body: 'No writes.' }]),
      'example/skills',
      ref,
    ),
  ).rejects.toThrow('Unsafe');
  await expect(
    parseRepositoryArchive(
      await archive([
        { header: { name: `skills-${ref}/same` }, body: 'First' },
        { header: { name: `skills-${ref}/same` }, body: 'Second' },
      ]),
      'example/skills',
      ref,
    ),
  ).rejects.toThrow('Duplicate');
  await expect(
    parseRepositoryArchive(
      await archive([{ header: { name: `skills-${ref}/device`, type: 'fifo' } }]),
      'example/skills',
      ref,
    ),
  ).rejects.toThrow('special file');
  await expect(
    parseRepositoryArchive(
      await archive([{ header: { name: `other-${ref}/SKILL.md` }, body: 'Wrong repository.' }]),
      'example/skills',
      ref,
    ),
  ).rejects.toThrow('root');
});
