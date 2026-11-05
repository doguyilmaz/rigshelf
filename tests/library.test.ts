import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { exportArchive, importArchive } from '../src/core/archive';
import { exportLibrary, importLibrary } from '../src/core/backup';
import { importSkillDirectory, saveSkill, snapshotDigest } from '../src/core/ingest';
import { hash, scanText } from '../src/core/safety';
import { route } from '../src/core/service';
import { reviseSkill } from '../src/core/skill-revisions';
import { addSource, editSource } from '../src/core/source-library';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
async function setup() {
  const value = await fixture();
  cleanups.push(value.cleanup);
  return value;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('library revisions and portable archives', () => {
  test('portable MCP snapshots reject opaque fields and exports report unsafe legacy bodies', async () => {
    const { store } = await setup();
    const original = (await route(store, 'POST', 'mcp', {
      name: 'portable-service',
      mcp: { transport: 'stdio', command: 'server' },
    })) as { id: string };
    const bundle = exportLibrary(store);
    const imported = bundle.entries.find((value) => value.entry.id === original.id)!;
    imported.entry.body = JSON.stringify({
      ...JSON.parse(imported.entry.body),
      metadata: { token: 'fictional-private-value' },
    });
    imported.entry.digest = hash(imported.entry.body);
    const other = await setup();
    expect(() => importLibrary(other.store, bundle, true)).toThrow();
    expect(other.store.entries()).toHaveLength(0);
    store.saveEntry(imported.entry);
    const exported = exportLibrary(store);
    expect(exported.entries).toHaveLength(0);
    expect(exported.excluded.some((value) => value.id === original.id)).toBe(true);
  });
  test('forks preserve assets, executable modes, frontmatter and immutable upstream identity', async () => {
    const { store, root, home } = await setup();
    const directory = join(root, 'upstream');
    await mkdir(join(directory, 'scripts'), { recursive: true });
    await Bun.write(
      join(directory, 'SKILL.md'),
      '---\nname: focused-guide\ndescription: Use for focused work.\nlicense: MIT\ndisable-model-invocation: true\n---\n\nOriginal instructions.\n',
    );
    await Bun.write(join(directory, 'scripts/check.sh'), '#!/bin/sh\nexit 0\n');
    const original = await importSkillDirectory(store, directory, home);
    const originalBody = original.body;
    const originalDigest = original.digest;
    const fork = reviseSkill(store, original.id, { body: 'Revised instructions.' });
    expect(fork.custom).toBe(true);
    expect(fork.derivedFrom).toBe(original.id);
    expect(fork.id).not.toBe(original.id);
    expect(fork.body).toContain('license: MIT');
    expect(fork.body).toContain('disable-model-invocation: true');
    expect(store.files(fork.id).find((file) => file.path === 'scripts/check.sh')?.content).toBe(
      store.files(original.id).find((file) => file.path === 'scripts/check.sh')?.content,
    );
    expect(store.entry(original.id)?.body).toBe(originalBody);
    expect(store.entry(original.id)?.digest).toBe(originalDigest);
    const revised = reviseSkill(store, fork.id, {
      file: {
        path: 'scripts/check.sh',
        content: Buffer.from('#!/bin/sh\nexit 2\n').toString('base64'),
        executable: true,
      },
    });
    expect(revised.derivedFrom).toBe(fork.id);
    expect(revised.digest).not.toBe(fork.digest);
    expect(snapshotDigest(store.files(revised.id))).toBe(revised.digest);
    expect(
      store.files(revised.id).find((file) => file.path === 'scripts/check.sh')?.executable,
    ).toBe(true);
    expect(() =>
      reviseSkill(store, fork.id, { file: { path: '../escape', content: '', executable: false } }),
    ).toThrow('Unsafe');
  });

  test('archives retain archived revisions and provenance but never copy trust permissions', async () => {
    const { store } = await setup();
    const entry = sampleSkill(store);
    entry.archived = true;
    entry.origins = [
      {
        sourceId: entry.sourceId,
        url: 'https://github.com/example/skills',
        path: 'skills/project-guide',
        ref: 'abc123',
      },
    ];
    store.saveEntry(entry);
    store.put('trust', { id: entry.id, digest: entry.digest });
    const archive = exportArchive(store);
    const other = await setup();
    expect(importArchive(other.store, archive.bytes, true).applied).toBe(true);
    expect(other.store.entry(entry.id)?.archived).toBe(true);
    expect(other.store.entry(entry.id)?.origins).toEqual(entry.origins);
    expect(other.store.entries()).toHaveLength(0);
    expect(other.store.get('trust', entry.id)).toBeUndefined();
    expect(() => importArchive(other.store, new Uint8Array([1, 2, 3]))).toThrow();
  });

  test('reports sensitive exclusions and rejects preset cycles before any import mutation', async () => {
    const { store } = await setup();
    const secret = sampleSkill(store, 'credential-example');
    reviseSkill(store, secret.id, {
      body: `Never store this token: ${'ghp_'}${'Abc123'.repeat(7)}`,
    });
    const exported = exportLibrary(store);
    expect(exported.excluded).toHaveLength(1);
    expect(JSON.stringify(exported.entries)).not.toContain('ghp_');
    const altered = structuredClone(exported);
    altered.presets.find((preset) => preset.id === 'base')!.parentId = 'expo';
    const target = await setup();
    const before = target.store.entries(true).length;
    expect(() => importLibrary(target.store, altered, true)).toThrow('cycle');
    expect(target.store.entries(true)).toHaveLength(before);
    const duplicate = structuredClone(exported);
    duplicate.entries.push(duplicate.entries[0]);
    expect(() => importLibrary(target.store, duplicate, true)).toThrow('Duplicate entry');
  });

  test('archives compress representative repeated text and preserve content exactly', async () => {
    const { store } = await setup();
    const entry = sampleSkill(store);
    const resource = 'Reference material with a meaningful invariant.\n'.repeat(16000);
    const revision = reviseSkill(store, entry.id, {
      file: {
        path: 'references/long.md',
        content: Buffer.from(resource).toString('base64'),
        executable: false,
      },
    });
    const archive = exportArchive(store);
    expect(archive.bytes.length).toBeLessThan(resource.length / 5);
    const other = await setup();
    importArchive(other.store, archive.bytes, true);
    expect(
      other.store.files(revision.id).find((file) => file.path === 'references/long.md')?.content,
    ).toBe(Buffer.from(resource).toString('base64'));
    expect(() => importArchive(other.store, gzipSync('{"format":"invalid"}'))).toThrow();
  });

  test('archive and restore leave project installations intact; purge protects references', async () => {
    const { store, project } = await setup();
    const entry = sampleSkill(store);
    store.installation({
      entryId: entry.id,
      projectId: 'project',
      provider: 'codex',
      path: join(project, '.agents/skills/project-guide'),
      scope: 'project',
      lastSeen: new Date().toISOString(),
    });
    await route(store, 'DELETE', `entries/${entry.id}`, undefined);
    expect(store.entries()).toHaveLength(0);
    expect(store.installations()).toHaveLength(1);
    await expect(route(store, 'DELETE', `entries/${entry.id}/purge`, undefined)).rejects.toThrow(
      'unreferenced',
    );
    await route(store, 'PATCH', `entries/${entry.id}`, { tags: entry.tags, archived: false });
    expect(store.entries()).toHaveLength(1);
  });
});

describe('sources and heuristic accuracy', () => {
  test('unchanged content retains each immutable upstream receipt instead of replacing older references', async () => {
    const { store } = await setup();
    const entry = sampleSkill(store);
    const source = store.get<import('../src/core/model').Source>('source', entry.sourceId)!;
    const files = store.files(entry.id);
    saveSkill(store, entry.body, files, source, {
      custom: true,
      upstreamPath: 'skills/guide',
      upstreamRef: 'a'.repeat(40),
    });
    const next = saveSkill(store, entry.body, files, source, {
      custom: true,
      upstreamPath: 'skills/guide',
      upstreamRef: 'b'.repeat(40),
    });
    expect(next.id).toBe(entry.id);
    expect(next.origins?.map((origin) => origin.ref)).toContain('a'.repeat(40));
    expect(next.origins?.map((origin) => origin.ref)).toContain('b'.repeat(40));
  });
  test('canonicalizes commands and listings, keeps focus and preserves old source receipts', async () => {
    const { store } = await setup();
    const source = await addSource(store, {
      input: 'bunx skills add example/my-skills --skill useful-one',
      research: false,
    });
    const again = await addSource(store, {
      input: 'https://skills.sh/example/my-skills/useful-two',
      research: false,
    });
    expect(again.id).toBe(source.id);
    expect(again.focusSkill).toBe('useful-two');
    const edited = editSource(store, source.id, {
      name: 'Renamed',
      url: 'https://github.com/example/replacement',
      recipe: 'bunx skills add example/replacement',
      notes: 'Reviewed source change.',
    });
    expect(edited.id).toBe(source.id);
    expect(edited.previousUrls?.[0].url).toBe(source.url);
    expect(edited.status).toBe('unchecked');
    const restored = await addSource(store, { url: source.url, research: false });
    expect(restored.id).not.toBe(edited.id);
    expect(store.get<import('../src/core/model').Source>('source', edited.id)?.url).toBe(
      edited.url,
    );
    const repeated = await addSource(store, { url: edited.url, research: false });
    expect(repeated.id).toBe(edited.id);
    expect(repeated.name).toBe('Renamed');
    expect(repeated.recipe).toBe(edited.recipe);
    const longName = 'International Platform Engineering — '.repeat(15).slice(0, 500);
    const renamed = editSource(store, repeated.id, {
      name: longName,
      url: repeated.url,
      recipe: repeated.recipe,
      notes: repeated.notes,
    });
    expect(renamed.name).toBe(longName);
    await expect(
      addSource(store, { url: 'https://example.com/?token=actual-secret', research: false }),
    ).rejects.toThrow('credentials');
  });
  test('does not mistake task filenames or private-key headings for embedded credentials', () => {
    expect(
      scanText(
        '[task-reviewer-prompt.md](task-reviewer-prompt.md)\n-----BEGIN PRIVATE KEY-----',
      ).some((finding) => finding.code === 'secret'),
    ).toBe(false);
    expect(
      scanText(`token=${'sk-'}${'Ab12'.repeat(10)}`).some((finding) => finding.code === 'secret'),
    ).toBe(true);
    expect(
      scanText(
        `-----BEGIN PRIVATE KEY-----\n${'MIIABC0123'.repeat(20)}\n-----END PRIVATE KEY-----`,
      ).some((finding) => finding.code === 'secret'),
    ).toBe(true);
  });
});
