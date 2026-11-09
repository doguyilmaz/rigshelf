import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDataDirectory } from '../src/core/data-directory';
import { fixture } from './helpers';

test('the catalog lives in the Rigshelf data folder unless RIGSHELF_DATA_DIR selects another, without creating it', async () => {
  const data = await fixture();
  try {
    const selected = defaultDataDirectory({ home: data.home, environment: {} });
    expect(selected).toBe(join(data.home, '.local/share/rigshelf'));
    expect(existsSync(selected)).toBe(false);
    const chosen = join(data.root, 'elsewhere');
    expect(
      defaultDataDirectory({ home: data.home, environment: { RIGSHELF_DATA_DIR: chosen } }),
    ).toBe(chosen);
  } finally {
    await data.cleanup();
  }
});
