import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compareInventories } from '../src/core/machine-compare';
import {
  buildMachineInventory,
  type MachineInventory,
  parseMachineInventory,
  repositoryKey,
} from '../src/core/machine-inventory';
import {
  applyRemotePlans,
  printable,
  remoteApply,
  remoteDoctor,
  remoteInventory,
  remotePrepare,
  remoteReadyUrl,
  sshArguments,
  tunnelArguments,
} from '../src/core/machine-ssh';
import { claudeMemoryKey } from '../src/core/memory-locations';
import { formatSyncReport } from '../src/machine-cli';

const cleanups: string[] = [];
afterEach(async () => {
  for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true });
});
async function temporary(): Promise<string> {
  await mkdir(resolve('.local/tests'), { recursive: true });
  const path = await realpath(await mkdtemp(join(resolve('.local/tests'), 'machine-')));
  cleanups.push(path);
  return path;
}
async function repository(path: string, origin: string): Promise<void> {
  await Bun.write(join(path, '.git/config'), `[remote "origin"]\n\turl = ${origin}\n`);
}

test('repository keys ignore transport, credentials, case and the .git suffix', async () => {
  const root = await temporary();
  const cases: [string, string][] = [
    ['git@github.com:Owner/Repo.git', 'github.com/owner/repo'],
    ['https://user:token@github.com/owner/repo.git', 'github.com/owner/repo'],
    ['ssh://git@gitlab.example.com:2222/team/app.git', 'gitlab.example.com/team/app'],
    ['github.com:owner/repo.git', 'github.com/owner/repo'],
    ['https://github.com/owner/repo.git/', 'github.com/owner/repo'],
    ['git@github.com:42/x.git', 'github.com/42/x'],
  ];
  for (const [index, [origin, key]] of cases.entries()) {
    const project = join(root, String(index));
    await repository(project, origin);
    expect(await repositoryKey(project)).toBe(key);
  }
  expect(await repositoryKey(join(root, 'missing'))).toBeUndefined();
  const pushFirst = join(root, 'push-first');
  await Bun.write(
    join(pushFirst, '.git/config'),
    '[remote "origin"]\n\tpushurl = git@github.com:owner/fork.git\n\turl = https://github.com/owner/repo\n',
  );
  expect(await repositoryKey(pushFirst)).toBe('github.com/owner/repo');
});

test('an inventory groups Skills by folder and flags private and machine-specific files', async () => {
  const root = await temporary();
  const home = join(root, 'home');
  const project = join(root, 'work/app');
  await Bun.write(join(home, '.claude/skills/review/SKILL.md'), '---\nname: review\n---\n');
  await Bun.write(join(home, '.claude/skills/review/scripts/run.sh'), 'exit 0\n');
  await Bun.write(join(home, '.claude.json'), '{"oauthAccount":{}}');
  await Bun.write(
    join(home, '.codex/config.toml'),
    `[projects."${project}"]\ntrust_level = "trusted"\n`,
  );
  await repository(project, 'git@github.com:owner/app.git');
  await Bun.write(
    join(project, '.claude/skills/local-guide/SKILL.md'),
    '---\nname: local-guide\n---\n',
  );
  await Bun.write(join(project, 'CLAUDE.local.md'), '# Personal notes\n');
  await Bun.write(join(project, '.claude/settings.local.json'), '{}');
  await Bun.write(join(home, '.claude/projects', claudeMemoryKey(project), 'memory/notes.md'), 'n');
  const inventory = await buildMachineInventory({ home, roots: [join(root, 'work')] });
  const review = inventory.global.find((item) => item.key === '.claude/skills/review');
  expect(review).toMatchObject({ group: 'skill', harness: 'claude', files: 2 });
  expect(inventory.global.find((item) => item.key === '.claude.json')?.privacy).toBe('private');
  expect(inventory.global.find((item) => item.key === '.codex/config.toml')?.privacy).toBe(
    'machine-specific',
  );
  const [app] = inventory.projects;
  expect(app?.repository).toBe('github.com/owner/app');
  const keys = Object.fromEntries(app!.items.map((item) => [item.key, item]));
  expect(keys['.claude/skills/local-guide']?.group).toBe('skill');
  expect(keys['CLAUDE.local.md']?.group).toBe('guidance');
  expect(keys['.claude/settings.local.json']?.privacy).toBe('private');
  expect(keys['memory/notes.md']).toMatchObject({ group: 'memory', privacy: 'machine-specific' });
  expect(JSON.stringify(inventory)).not.toContain('Personal notes');
});

test('comparison matches renamed folders by repository and reports grouped and single statuses', async () => {
  const root = await temporary();
  const laptop = join(root, 'laptop');
  const server = join(root, 'server');
  await repository(join(laptop, 'code/hangman'), 'git@github.com:owner/mola.git');
  await repository(join(server, 'srv/mola'), 'https://github.com/owner/mola');
  await Bun.write(join(laptop, 'code/hangman/AGENTS.md'), '# Same\n');
  await Bun.write(join(server, 'srv/mola/AGENTS.md'), '# Same\n');
  await Bun.write(join(laptop, 'code/hangman/.claude/skills/guide/SKILL.md'), 'v2\n');
  await Bun.write(join(server, 'srv/mola/.claude/skills/guide/SKILL.md'), 'v1\n');
  await Bun.write(join(laptop, 'code/hangman/.claude/skills/new/SKILL.md'), 'new\n');
  await Bun.write(join(laptop, 'code/hangman/.claude/settings.local.json'), '{}');
  await Bun.write(join(server, 'srv/mola/.claude/skills/server-only/SKILL.md'), 's\n');
  await repository(join(laptop, 'code/solo'), 'git@github.com:owner/solo.git');
  const local = await buildMachineInventory({
    home: join(laptop, 'home'),
    roots: [join(laptop, 'code')],
  });
  const remote = await buildMachineInventory({
    home: join(server, 'home'),
    roots: [join(server, 'srv')],
  });
  const report = compareInventories(local, remote);
  const project = report.projects.find((value) => value.repository === 'github.com/owner/mola')!;
  expect(project.local).toBe('hangman');
  expect(project.remote).toBe('mola');
  const status = Object.fromEntries(project.rows.map((row) => [row.key, [row.status, row.action]]));
  expect(status['AGENTS.md']).toEqual(['same', 'none']);
  expect(status['.claude/skills/guide']).toEqual(['different', 'review']);
  expect(status['.claude/skills/new']).toEqual(['missing-remote', 'copy']);
  expect(status['.claude/skills/server-only']).toEqual(['missing-local', 'copy']);
  expect(status['.claude/settings.local.json']).toEqual(['missing-remote', 'set-up-manually']);
  expect(project.groups.skill).toEqual({
    same: 0,
    different: 1,
    'missing-remote': 1,
    'missing-local': 1,
  });
  expect(
    report.projects.find((value) => value.repository === 'github.com/owner/solo')?.remote,
  ).toBeNull();
});

test('ssh arguments use batch mode and refuse aliases that could become options or shell syntax', () => {
  const args = sshArguments('build-box', 'rigshelf machine inventory --json');
  expect(args).toContain('BatchMode=yes');
  expect(args.slice(-3, -1)).toEqual(['--', 'build-box']);
  expect(args.at(-1)).toContain('rigshelf machine inventory --json');
  for (const alias of ['-oProxyCommand=touch x', 'box;rm -rf ~', 'box name', ''])
    expect(() => sshArguments(alias, 'rigshelf --version')).toThrow('host alias');
});

test('remote inventories are validated and missing Rigshelf is reported plainly', async () => {
  const valid: MachineInventory = { version: 1, rigshelf: '0.1.0', global: [], projects: [] };
  const ok = await remoteInventory('box', {
    run: async () => ({ code: 0, stdout: JSON.stringify(valid), stderr: '' }),
  });
  expect(ok).toEqual(valid);
  await expect(
    remoteInventory('box', {
      run: async () => ({ code: 127, stdout: '', stderr: 'rigshelf: command not found' }),
    }),
  ).rejects.toThrow('Rigshelf is not installed on box');
  let sent: string[] = [];
  await remoteInventory('box', {
    roots: ['/srv/apps'],
    run: async (args) => {
      sent = args;
      return { code: 0, stdout: JSON.stringify(valid), stderr: '' };
    },
  });
  expect(sent.at(-1)).toContain('--root /srv/apps');
  for (const root of ["/srv/x'; rm -rf ~", 'relative/path', '/srv/../etc', '/srv/a b'])
    await expect(
      remoteInventory('box', {
        roots: [root],
        run: async () => ({ code: 0, stdout: '', stderr: '' }),
      }),
    ).rejects.toThrow('Remote roots');
  expect(() => parseMachineInventory('{"version":2}')).toThrow();
  expect(() =>
    parseMachineInventory(JSON.stringify({ ...valid, global: [{ key: '../../etc/passwd' }] })),
  ).toThrow();
});

test('example tokens and other people’s paths in Skill docs do not make a Skill private or machine-specific', async () => {
  const root = await temporary();
  const home = join(root, 'home');
  await Bun.write(
    join(home, '.agents/skills/payments/SKILL.md'),
    '---\nname: payments\n---\nExample: api_key = "replace-with-your-key"\nSee /Users/alice/demo for a sample.\n',
  );
  await Bun.write(join(home, '.agents/skills/mine/SKILL.md'), `Run ${home}/bin/tool\n`);
  const inventory = await buildMachineInventory({ home, roots: [] });
  const privacy = Object.fromEntries(inventory.global.map((item) => [item.key, item.privacy]));
  expect(privacy['.agents/skills/payments']).toBe('portable');
  expect(privacy['.agents/skills/mine']).toBe('machine-specific');
});

test('a remote doctor answer is validated and returned flat', async () => {
  const there = {
    rigshelf: '0.1.0',
    platform: 'linux-x64',
    harnesses: { claude: true, codex: false },
  };
  const answer = await remoteDoctor('box', {
    run: async () => ({ code: 0, stdout: JSON.stringify({ here: there }), stderr: '' }),
  });
  expect(answer).toEqual(there);
  await expect(
    remoteDoctor('box', {
      run: async () => ({ code: 0, stdout: '{"here":{"rigshelf":1}}', stderr: '' }),
    }),
  ).rejects.toThrow('cannot read');
});

test('a remote workbench tunnel forwards one loopback port and runs only the fixed ui command', () => {
  const args = tunnelArguments('build-box', 47480);
  expect(args).not.toContain('-tt');
  expect(args).toContain('ExitOnForwardFailure=yes');
  expect(args[args.indexOf('-L') + 1]).toBe('127.0.0.1:47480:127.0.0.1:47480');
  expect(args.at(-1)).toBe(
    `exec "$SHELL" -lc 'rigshelf ui --port 47480 --attached --public-port 47480'`,
  );
  const moved = tunnelArguments('build-box', 47480, 47500);
  expect(moved[moved.indexOf('-L') + 1]).toBe('127.0.0.1:47480:127.0.0.1:47500');
  expect(moved.at(-1)).toContain('--port 47500 --attached --public-port 47480');
  expect(() => tunnelArguments('box', 80)).toThrow('port');
  expect(() => tunnelArguments('-oProxyCommand=x', 47480)).toThrow('host alias');
  expect(
    remoteReadyUrl(
      `Rigshelf is ready at http://rigshelf.localhost:47480/#access=${'a'.repeat(64)}\r\n`,
      47480,
    ),
  ).toBe(`http://rigshelf.localhost:47480/#access=${'a'.repeat(64)}`);
  expect(
    remoteReadyUrl(
      `Rigshelf is ready at http://rigshelf.localhost:47999/#access=${'a'.repeat(64)}`,
      47480,
    ),
  ).toBeUndefined();
});

test('sync sends the bundle on stdin and applies only plan IDs on the server', async () => {
  let sent: { args: string[]; input?: string } = { args: [] };
  const prepared = {
    library: { entries: 1 },
    directives: { added: [], replaced: [], kept: [] },
    projects: [
      {
        repository: 'github.com/owner/app',
        path: '/srv/app',
        planId: '0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c',
        files: 3,
        warnings: [],
      },
    ],
    global: [],
  };
  const result = await remotePrepare(
    'box',
    { library: {}, projects: [] },
    {
      roots: ['/srv'],
      replaceDirectives: true,
      run: async (args, input) => {
        sent = { args, input };
        return { code: 0, stdout: JSON.stringify(prepared), stderr: '' };
      },
    },
  );
  expect(result).toEqual(prepared);
  expect(sent.args.at(-1)).toContain(
    'rigshelf machine prepare --json --replace-directives --root /srv',
  );
  expect(JSON.parse(sent.input!)).toEqual({ library: {}, projects: [] });
  const applied = await remoteApply('box', prepared.projects[0]!.planId, {
    run: async (args) => {
      sent = { args };
      return { code: 0, stdout: JSON.stringify({ status: 'applied', fileCount: 3 }), stderr: '' };
    },
  });
  expect(applied).toEqual({ status: 'applied', fileCount: 3 });
  expect(sent.args.at(-1)).toBe(
    `exec "$SHELL" -lc 'rigshelf apply ${prepared.projects[0]!.planId}'`,
  );
  await expect(remoteApply('box', '$(reboot)')).rejects.toThrow('plan ID');
  await expect(
    remotePrepare(
      'box',
      { library: {}, projects: [] },
      { run: async () => ({ code: 0, stdout: '{"projects":"x"}', stderr: '' }) },
    ),
  ).rejects.toThrow('cannot read');
});

test('the summary details matched projects and collapses unmatched ones into one line per side', () => {
  const empty = { same: 0, different: 0, 'missing-remote': 0, 'missing-local': 0 };
  const unmatched = Array.from({ length: 12 }, (_, index) => ({
    repository: null,
    local: `local-${index}`,
    remote: null,
    matchedBy: null,
    rows: [],
    groups: {},
  }));
  const text = formatSyncReport(
    {
      global: { rows: [], groups: {} },
      projects: [
        {
          repository: 'github.com/owner/app',
          local: 'app',
          remote: 'app',
          matchedBy: 'repository',
          rows: [],
          groups: { memory: { ...empty, 'missing-remote': 2 } },
        },
        ...unmatched,
        {
          repository: 'github.com/owner/srv',
          local: null,
          remote: 'srv-only',
          matchedBy: null,
          rows: [],
          groups: {},
        },
      ],
    },
    'this machine',
    'box',
  );
  expect(text).toContain('app  (github.com/owner/app)\n  memory: 2 missing there');
  expect(text).toContain(
    'Only on this machine (12): local-0, local-1, local-2, local-3, local-4, local-5, local-6, local-7 and 4 more',
  );
  expect(text).toContain('Only on box (1): srv-only');
  expect(text).not.toContain('(only on this machine)');
});

test('a file that differs only by each machine’s own paths compares as in sync', async () => {
  const root = await temporary();
  const laptop = join(root, 'laptop');
  const server = join(root, 'server');
  const laptopProject = join(laptop, 'code/app');
  const serverProject = join(server, 'srv/app');
  await repository(laptopProject, 'git@github.com:owner/app.git');
  await repository(serverProject, 'https://github.com/owner/app');
  await Bun.write(
    join(laptopProject, 'CLAUDE.local.md'),
    `Run ${laptopProject}/bin and ${join(laptop, 'home')}/tools\n`,
  );
  await Bun.write(
    join(serverProject, 'CLAUDE.local.md'),
    `Run ${serverProject}/bin and ${join(server, 'home')}/tools\n`,
  );
  await Bun.write(join(laptopProject, 'AGENTS.md'), `Docs at ${laptopProject}/docs\n`);
  await Bun.write(join(serverProject, 'AGENTS.md'), `Docs at ${serverProject}/handbook\n`);
  const report = compareInventories(
    await buildMachineInventory({ home: join(laptop, 'home'), roots: [join(laptop, 'code')] }),
    await buildMachineInventory({ home: join(server, 'home'), roots: [join(server, 'srv')] }),
  );
  const status = Object.fromEntries(report.projects[0]!.rows.map((row) => [row.key, row.status]));
  expect(status['CLAUDE.local.md']).toBe('same');
  expect(status['AGENTS.md']).toBe('different');
});

test('server text cannot drive the local terminal', async () => {
  expect(printable('ok\x1b]52;c;aGk=\x07\x1b[2Kdone\r\nnext\u009b31m')).toBe(
    'ok]52;c;aGk=[2Kdone\nnext31m',
  );
  await expect(
    remoteDoctor('box', {
      run: async () => ({ code: 1, stdout: '', stderr: 'boom\x1b[2K\x07spoof' }),
    }),
  ).rejects.toThrow('Rigshelf on box failed: boom[2Kspoof');
});

test('one failed plan does not stop the others, and each result is reported', async () => {
  const first = '0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c';
  const second = '1c7e2d2f-3a5b-4d9f-8b62-7e3f4a5b6c7d';
  const results = await applyRemotePlans('box', [first, second], {
    run: async (args) =>
      args.at(-1)!.includes(first)
        ? { code: 1, stdout: '', stderr: 'Precondition failed: file changed' }
        : { code: 0, stdout: JSON.stringify({ status: 'applied', fileCount: 2 }), stderr: '' },
  });
  expect(results).toEqual([
    {
      planId: first,
      status: 'failed',
      error: 'Rigshelf on box failed: Precondition failed: file changed',
    },
    { planId: second, status: 'applied', fileCount: 2 },
  ]);
});

test('an unreachable host stops the remaining plans instead of waiting on each', async () => {
  const ids = ['0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c', '1c7e2d2f-3a5b-4d9f-8b62-7e3f4a5b6c7d'];
  let calls = 0;
  const results = await applyRemotePlans('box', ids, {
    run: async () => {
      calls++;
      return { code: 255, stdout: '', stderr: 'ssh: connect to host box: Operation timed out' };
    },
  });
  expect(calls).toBe(1);
  expect(results[1]).toEqual({
    planId: ids[1],
    status: 'failed',
    error: 'Not attempted: Could not connect to box: ssh: connect to host box: Operation timed out',
  });
});

test('global Skills compare once per name, only in folders of agents installed there', async () => {
  const root = await temporary();
  const laptop = join(root, 'laptop');
  const server = join(root, 'server');
  for (const folder of ['.agents', '.claude', '.cline'])
    await Bun.write(join(laptop, `${folder}/skills/shared/SKILL.md`), 'shared\n');
  await Bun.write(join(laptop, '.claude/skills/claude-only/SKILL.md'), 'mine\n');
  await Bun.write(join(laptop, '.claude/skills/synced/abc/SKILL.md'), 'claude.ai\n');
  await Bun.write(join(laptop, '.cursor/skills/cursor-only/SKILL.md'), 'cursor\n');
  await Bun.write(join(server, '.agents/skills/shared/SKILL.md'), 'shared\n');
  await Bun.write(join(server, '.claude/skills/shared/SKILL.md'), 'older\n');
  await Bun.write(join(server, '.claude/skills/server-only/SKILL.md'), 'server\n');
  const [local, remote] = await Promise.all(
    [laptop, server].map((home) => buildMachineInventory({ home, roots: [] })),
  );
  const report = compareInventories(local, remote, ['claude']);
  const skills = report.global.rows.filter((row) => row.group === 'skill');
  expect(skills.map((row) => [row.key, row.harness, row.status])).toEqual([
    ['skills/shared', 'agents, claude', 'different'],
    ['skills/claude-only', 'claude', 'missing-remote'],
    ['skills/server-only', 'claude', 'missing-local'],
  ]);
  expect(report.global.otherAgents).toEqual(['cline', 'cursor']);
});
