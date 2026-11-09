import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultDataDirectory, usesLegacyDirectoryName } from '../src/core/data-directory';
import { state } from '../src/core/service';
import { Store } from '../src/core/store';
import { fixture, sampleSkill } from './helpers';

test('fresh installs select Rigshelf storage without creating or inspecting catalog contents', async () => {
  const data = await fixture();
  try {
    const selected = defaultDataDirectory({ home: data.home, environment: {} });
    expect(selected).toBe(join(data.home, '.local/share/rigshelf'));
    expect(existsSync(selected)).toBe(false);
    expect(existsSync(join(data.home, '.local/share/kitfold'))).toBe(false);
  } finally {
    await data.cleanup();
  }
});

test('legacy selection reopens the existing catalog without stranding snapshots or recovery records', async () => {
  const data = await fixture();
  const legacy = join(data.home, '.local/share/kitfold');
  const before = new Store(legacy);
  const skill = sampleSkill(before, 'retained-guide');
  before.put('journal', { id: 'retained-recovery', state: 'needs-recovery', fixture: 'preserved' });
  const files = before.files(skill.id);
  before.close();
  let reopened: Store | undefined;
  try {
    const selected = defaultDataDirectory({ home: data.home, environment: {} });
    expect(selected).toBe(legacy);
    reopened = new Store(selected);
    expect(reopened.entry(skill.id)).toEqual(skill);
    expect(reopened.files(skill.id)).toEqual(files);
    expect(reopened.get('journal', 'retained-recovery')).toEqual({
      id: 'retained-recovery',
      state: 'needs-recovery',
      fixture: 'preserved',
    });
    expect(state(reopened)).toHaveProperty('legacyDataDirectory', true);
    expect(existsSync(join(data.home, '.local/share/rigshelf'))).toBe(false);
  } finally {
    reopened?.close();
    await data.cleanup();
  }
});

test('two existing catalogs require an explicit selection and neither is merged or modified', async () => {
  const data = await fixture();
  const current = join(data.home, '.local/share/rigshelf');
  const legacy = join(data.home, '.local/share/kitfold');
  for (const directory of [current, legacy]) {
    const catalog = new Store(directory);
    catalog.put('fixture', { id: 'marker', directory });
    catalog.close();
  }
  try {
    const before = await Promise.all(
      [current, legacy].map((directory) =>
        Bun.file(join(directory, 'catalog.sqlite')).arrayBuffer(),
      ),
    );
    expect(() => defaultDataDirectory({ home: data.home, environment: {} })).toThrow(
      'Both Rigshelf and legacy Kitfold catalogs exist',
    );
    expect(
      defaultDataDirectory({
        home: data.home,
        environment: { RIGSHELF_DATA_DIR: current, KITFOLD_DATA_DIR: legacy },
      }),
    ).toBe(current);
    expect(
      defaultDataDirectory({ home: data.home, environment: { KITFOLD_DATA_DIR: legacy } }),
    ).toBe(legacy);
    const after = await Promise.all(
      [current, legacy].map((directory) =>
        Bun.file(join(directory, 'catalog.sqlite')).arrayBuffer(),
      ),
    );
    expect(after).toEqual(before);
  } finally {
    await data.cleanup();
  }
});

test('a partial legacy folder stays selected while a current catalog remains the default when it alone exists', async () => {
  const data = await fixture();
  const legacy = join(data.home, '.local/share/kitfold');
  try {
    await mkdir(legacy, { recursive: true });
    await Bun.write(join(legacy, 'recovery-marker'), 'preserve');
    expect(defaultDataDirectory({ home: data.home, environment: {} })).toBe(legacy);
    const current = join(data.home, '.local/share/rigshelf');
    const catalog = new Store(current);
    catalog.close();
    expect(defaultDataDirectory({ home: data.home, environment: {} })).toBe(current);
    expect(await Bun.file(join(legacy, 'recovery-marker')).text()).toBe('preserve');
    expect(usesLegacyDirectoryName(legacy)).toBe(true);
    expect(usesLegacyDirectoryName(current)).toBe(false);
  } finally {
    await data.cleanup();
  }
});
