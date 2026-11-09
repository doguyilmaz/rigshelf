import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { devBuild } from '../src/platform/dev-build';
import { fixture } from './helpers';

test('development build metadata is disabled in normal runs and detects completed asset changes without exposing paths', async () => {
  const data = await fixture();
  try {
    expect(await devBuild(data.root, false)).toEqual({ enabled: false });
    expect(await devBuild(data.root, true)).toEqual({ enabled: true, building: true });
    await Bun.write(
      join(data.root, 'index.html'),
      '<html><script type="module" src="/assets/main-one.js"></script><link rel="stylesheet" href="/assets/theme-one.css"></html>',
    );
    const first = await devBuild(data.root, true);
    expect(first).toMatchObject({
      enabled: true,
      assets: ['/assets/main-one.js', '/assets/theme-one.css'],
    });
    expect(JSON.stringify(first)).not.toContain(data.root);
    await Bun.write(join(data.root, 'index.html'), '<html>partial');
    expect(await devBuild(data.root, true)).toEqual({ enabled: true, building: true });
    await Bun.write(
      join(data.root, 'index.html'),
      '<html><script src="/assets/main-two.js"></script></html>',
    );
    expect((await devBuild(data.root, true)).fingerprint).not.toBe(first.fingerprint);
  } finally {
    await data.cleanup();
  }
});
