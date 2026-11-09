import { afterEach, expect, test } from 'bun:test';

import type { MachineInventory } from '../src/core/machine-inventory';
import { sshHostAliases } from '../src/core/machine-routes';
import { route } from '../src/core/service';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('only concrete, valid host aliases are offered from ssh config', () => {
  const config = [
    'Host build-box staging',
    '  HostName 192.0.2.20',
    'Host *.internal !secret',
    'Host github.com',
    'host  lower-case',
    'Match host other',
    'Host -oProxyCommand=bad',
  ].join('\n');
  expect(sshHostAliases(config)).toEqual(['build-box', 'staging', 'lower-case']);
});

test('machine routes compare, prepare and apply through the injected runner', async () => {
  const data = await fixture();
  cleanups.push(data.cleanup);
  data.store.put('settings', { id: 'main', ...data.store.settings(), roots: [data.project] });
  const remote: MachineInventory = { version: 1, rigshelf: '0.1.0', global: [], projects: [] };
  const calls: string[] = [];
  const machineRunner = async (args: string[], input?: string) => {
    const command = args.at(-1)!;
    calls.push(command);
    if (command.includes('machine doctor'))
      return {
        code: 0,
        stdout: JSON.stringify({
          here: { rigshelf: '0.1.0', platform: 'linux-x64', harnesses: { claude: true } },
        }),
        stderr: '',
      };
    if (command.includes('machine inventory'))
      return { code: 0, stdout: JSON.stringify(remote), stderr: '' };
    if (command.includes('machine prepare')) {
      expect(JSON.parse(input!).projects).toEqual([]);
      return {
        code: 0,
        stdout: JSON.stringify({
          library: { entries: 0 },
          directives: { added: [], replaced: [], kept: [] },
          projects: [],
          global: [],
        }),
        stderr: '',
      };
    }
    return { code: 0, stdout: JSON.stringify({ status: 'applied', fileCount: 2 }), stderr: '' };
  };
  const compared = (await route(
    data.store,
    'POST',
    'machines/compare',
    { alias: 'build-box' },
    { machineRunner, machineHome: data.home },
  )) as {
    doctor: { there: { platform: string }; sameVersion: boolean };
    report: { global: unknown };
  };
  expect(compared.doctor).toMatchObject({ there: { platform: 'linux-x64' }, sameVersion: true });
  expect(compared.report.global).toBeDefined();
  const prepared = (await route(
    data.store,
    'POST',
    'machines/sync',
    { alias: 'build-box' },
    { machineRunner, machineHome: data.home },
  )) as {
    prepared: { projects: unknown[] };
  };
  expect(prepared.prepared.projects).toEqual([]);
  const applied = await route(
    data.store,
    'POST',
    'machines/apply',
    { alias: 'build-box', planIds: ['0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c'] },
    { machineRunner, machineHome: data.home },
  );
  expect(applied).toEqual({
    results: [{ planId: '0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c', status: 'applied', fileCount: 2 }],
  });
  expect(calls.some((command) => command.includes('rigshelf apply 0b6d1c1e'))).toBe(true);
  await expect(
    route(
      data.store,
      'POST',
      'machines/compare',
      { alias: 'bad alias' },
      { machineRunner, machineHome: data.home },
    ),
  ).rejects.toThrow();
});
