import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildMachineInventory } from '../src/core/machine-inventory';
import { mentionsPath, replacePaths } from '../src/core/machine-paths';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

test('a path is replaced only where it stands as a whole path', () => {
  const pairs: [string, string][] = [['/root', '/home/me']];
  expect(replacePaths('see app/root.tsx and /root.bak', pairs)).toBe(
    'see app/root.tsx and /root.bak',
  );
  expect(replacePaths('run /root/bin/x or "/root"', pairs)).toBe(
    'run /home/me/bin/x or "/home/me"',
  );
  expect(replacePaths('/Users/a/app-web/x', [['/Users/a/app', '/srv/app']])).toBe(
    '/Users/a/app-web/x',
  );
  expect(mentionsPath('import "./root.tsx"', '/root')).toBe(false);
  expect(mentionsPath('cd /root/work', '/root')).toBe(true);
  expect(replacePaths('The repo lives at /root.', pairs)).toBe('The repo lives at /home/me.');
  expect(mentionsPath('Home is /root.', '/root')).toBe(true);
});

test('replacement happens in one pass, so replaced text is never replaced again', () => {
  expect(
    replacePaths('/home/dev/app and /home/dev/x', [
      ['/home/dev/app', '/home/devops/app'],
      ['/home/dev', '/home/devops'],
    ]),
  ).toBe('/home/devops/app and /home/devops/x');
});

test('a machine whose scan root falls back to home compares the same as one with roots', async () => {
  const base = await mkdtemp(resolve('.local/tests/paths-'));
  folders.push(base);
  const laptop = join(base, 'laptop');
  const server = join(base, 'server');
  for (const home of [laptop, server]) {
    await Bun.write(join(home, '.claude/settings.json'), `{"hook":"${home}/bin/notify"}\n`);
    await mkdir(join(home, 'dev'), { recursive: true });
  }
  const [here, there] = await Promise.all([
    buildMachineInventory({ home: laptop, roots: [join(laptop, 'dev')] }),
    buildMachineInventory({ home: server, roots: [server] }),
  ]);
  const digest = (inventory: typeof here) =>
    inventory.global.find((item) => item.key.endsWith('settings.json'))?.digest;
  expect(digest(here)).toBeDefined();
  expect(digest(there)).toBe(digest(here));
});
