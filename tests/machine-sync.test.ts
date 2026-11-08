import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSyncRequest, prepareSync, type SyncRequest } from '../src/core/machine-sync';
import { claudeMemoryKey } from '../src/core/memory-locations';
import type { Rule } from '../src/core/model';
import { createPlan, executePlan } from '../src/core/planner';
import { seed } from '../src/core/seeds';
import { Store } from '../src/core/store';
import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function machines() {
  const laptop = await fixture();
  cleanups.push(laptop.cleanup);
  const server = new Store(join(laptop.root, 'server-data'));
  seed(server);
  for (const entry of server.entries(true)) server.deleteEntry(entry.id);
  cleanups.unshift(async () => server.close());
  const serverRoot = join(laptop.root, 'srv');
  return { laptop, server, serverRoot };
}
async function repository(path: string, origin: string) {
  await mkdir(path, { recursive: true });
  await Bun.write(join(path, '.git/config'), `[remote "origin"]\n\turl = ${origin}\n`);
}

test('a server receives the applied kit through its own reviewed plan', async () => {
  const { laptop, server, serverRoot } = await machines();
  const skill = sampleSkill(laptop.store, 'deploy-guide');
  await repository(laptop.project, 'git@github.com:owner/app.git');
  const plan = await createPlan(laptop.store, {
    projectPath: laptop.project,
    providers: ['claude', 'codex'],
    entryIds: [skill.id],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  await executePlan(laptop.store, plan.id, 'apply');
  const serverProject = join(serverRoot, 'app-checkout');
  await repository(serverProject, 'https://github.com/owner/app');
  const { request, skipped } = await buildSyncRequest(laptop.store, [laptop.project], {
    localFiles: false,
  });
  expect(skipped).toEqual([]);
  expect(request.projects).toEqual([
    expect.objectContaining({
      repository: 'github.com/owner/app',
      kit: expect.objectContaining({ entryIds: [skill.id] }),
    }),
  ]);
  const prepared = await prepareSync(server, JSON.parse(JSON.stringify(request)), [serverRoot]);
  expect(prepared.library.entries).toBe(1);
  const [result] = prepared.projects;
  expect(result).toMatchObject({ repository: 'github.com/owner/app', path: serverProject });
  expect(await Bun.file(join(serverProject, '.claude/skills/deploy-guide/SKILL.md')).exists()).toBe(
    false,
  );
  const changes = server.get<{ changes: { path: string }[] }>('plan', result!.planId!)!.changes;
  expect(changes.map((change) => change.path)).toEqual(
    expect.arrayContaining([
      '.claude/skills/deploy-guide/SKILL.md',
      '.agents/skills/deploy-guide/SKILL.md',
      'AGENTS.md',
    ]),
  );
  await executePlan(server, result!.planId!, 'apply');
  expect(await Bun.file(join(serverProject, '.claude/skills/deploy-guide/SKILL.md')).text()).toBe(
    await Bun.file(join(laptop.project, '.claude/skills/deploy-guide/SKILL.md')).text(),
  );
});

test('projects without a kit or repository are skipped, and unmatched repositories are reported', async () => {
  const { laptop, server, serverRoot } = await machines();
  await repository(join(laptop.root, 'nokit'), 'git@github.com:owner/nokit.git');
  await mkdir(serverRoot, { recursive: true });
  const { request, skipped } = await buildSyncRequest(laptop.store, [laptop.root]);
  expect(skipped.map((value) => value.reason)).toEqual(
    expect.arrayContaining([expect.stringContaining('no Rigshelf kit or local agent files')]),
  );
  const prepared = await prepareSync(
    server,
    {
      ...request,
      sourceHome: '/home/laptop',
      projects: [
        {
          repository: 'github.com/owner/missing',
          sourceProject: '/x',
          kit: { entryIds: [], providers: ['codex'] },
        },
      ],
    },
    [serverRoot],
  );
  expect(prepared.projects[0]).toMatchObject({
    repository: 'github.com/owner/missing',
    error: expect.stringContaining('No clone'),
  });
});

test('directives are added when missing, kept when different unless replacement is requested', async () => {
  const { laptop, server, serverRoot } = await machines();
  await mkdir(serverRoot, { recursive: true });
  const mine: Rule = {
    id: 'house-style',
    name: 'House style',
    scope: 'global',
    content: 'Keep replies short.',
    enabled: true,
    priority: 10,
    provenance: 'Custom',
  };
  laptop.store.put('rule', mine);
  const edited = {
    ...laptop.store.get<Rule>('rule', 'communication')!,
    content: 'Laptop wording.',
  };
  laptop.store.put('rule', edited);
  const { request } = await buildSyncRequest(laptop.store, [laptop.root]);
  const kept = await prepareSync(server, request, [serverRoot]);
  expect(server.get<Rule>('rule', 'house-style')?.content).toBe('Keep replies short.');
  expect(server.get<Rule>('rule', 'communication')?.content).not.toBe('Laptop wording.');
  expect(kept.directives.kept).toContain('communication');
  const replaced = await prepareSync(server, request, [serverRoot], { replaceDirectives: true });
  expect(server.get<Rule>('rule', 'communication')?.content).toBe('Laptop wording.');
  expect(replaced.directives.replaced).toContain('communication');
});

test('a malformed sync request is refused before anything is imported', async () => {
  const { server, serverRoot } = await machines();
  await expect(
    prepareSync(server, { library: {}, projects: 'all' }, [serverRoot]),
  ).rejects.toThrow();
  await expect(
    prepareSync(
      server,
      {
        library: {},
        sourceHome: '/h',
        projects: [
          { repository: 'x', sourceProject: '/x', kit: { entryIds: [], providers: ['nope'] } },
        ],
      },
      [serverRoot],
    ),
  ).rejects.toThrow();
  expect(server.entries(true)).toEqual([]);
});

test('opted-in memory is re-keyed and re-mapped to the server clone through its own plan', async () => {
  const { laptop, server, serverRoot } = await machines();
  const skill = sampleSkill(laptop.store, 'memory-guide');
  await repository(laptop.project, 'git@github.com:owner/app.git');
  const plan = await createPlan(laptop.store, {
    projectPath: laptop.project,
    providers: ['claude'],
    entryIds: [skill.id],
    requirements: '',
    includeRules: true,
    allowReviewed: false,
  });
  await executePlan(laptop.store, plan.id, 'apply');
  const memory = join(laptop.home, '.claude/projects', claudeMemoryKey(laptop.project), 'memory');
  await Bun.write(
    join(memory, 'notes.md'),
    `Build from ${laptop.project}/scripts and ${laptop.home}/bin.\n`,
  );
  await Bun.write(join(memory, 'token.md'), 'api_key = "replace-with-your-key"\n');
  const serverHome = join(laptop.root, 'server-home');
  await mkdir(join(serverHome, '.claude/projects'), { recursive: true });
  const clone = join(serverRoot, 'app');
  await repository(clone, 'https://github.com/owner/app');
  const without = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    localFiles: false,
  });
  expect(without.request.projects[0]?.memory).toBeUndefined();
  const { request, withheld } = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    memory: ['project'],
    localFiles: false,
  });
  expect(withheld.map((value) => value.name)).toContain('memory/token.md');
  const prepared = await prepareSync(server, JSON.parse(JSON.stringify(request)), [serverRoot], {
    home: serverHome,
  });
  const [result] = prepared.projects;
  expect(result?.memoryFiles).toBe(1);
  const target = join(serverHome, '.claude/projects', claudeMemoryKey(clone), 'memory/notes.md');
  expect(await Bun.file(target).exists()).toBe(false);
  await executePlan(server, result!.memoryPlanId!, 'apply');
  expect(await Bun.file(target).text()).toBe(
    `Build from ${clone}/scripts and ${serverHome}/bin.\n`,
  );
  await executePlan(server, result!.memoryPlanId!, 'rollback');
  expect(await Bun.file(target).exists()).toBe(false);
});

test('untracked local agent files and opted-in global guidance reach the server; tracked and private files do not', async () => {
  const { laptop, server, serverRoot } = await machines();
  const git = (...args: string[]) =>
    Bun.spawnSync([
      'git',
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      '-C',
      laptop.project,
      ...args,
    ]);
  git('init', '-q');
  git('remote', 'add', 'origin', 'git@github.com:owner/app.git');
  await Bun.write(join(laptop.project, '.claude/rules/team.md'), 'Shared rule\n');
  git('add', '.claude/rules/team.md');
  git('commit', '-qm', 'rule');
  await Bun.write(join(laptop.project, '.claude/rules/mine.md'), 'My rule\n');
  await Bun.write(
    join(laptop.project, 'CLAUDE.local.md'),
    `Scripts live in ${laptop.project}/bin.\n`,
  );
  await Bun.write(join(laptop.project, '.claude/hooks/check.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(laptop.project, '.claude/hooks/check.sh'), 0o755);
  await Bun.write(join(laptop.project, '.claude/settings.local.json'), '{"env":{}}');
  await Bun.write(
    join(laptop.project, '.agents/skills/local-skill/SKILL.md'),
    '---\nname: local-skill\n---\n',
  );
  await Bun.write(join(laptop.home, '.claude/CLAUDE.md'), `Notes in ${laptop.home}/notes.\n`);
  const serverHome = join(laptop.root, 'server-home');
  await mkdir(join(serverHome, '.claude'), { recursive: true });
  const clone = join(serverRoot, 'app');
  await repository(clone, 'https://github.com/owner/app');
  const { request, withheld } = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    globalGuidance: true,
  });
  const [project] = request.projects;
  expect(project?.kit).toBeUndefined();
  expect(project?.localFiles?.map((file) => file.path).sort()).toEqual([
    '.agents/skills/local-skill/SKILL.md',
    '.claude/hooks/check.sh',
    '.claude/rules/mine.md',
    'CLAUDE.local.md',
  ]);
  expect(withheld.map((value) => value.name)).toContain('project/.claude/settings.local.json');
  const prepared = await prepareSync(server, JSON.parse(JSON.stringify(request)), [serverRoot], {
    home: serverHome,
  });
  const [result] = prepared.projects;
  expect(result?.planId).toBeUndefined();
  expect(result?.localFiles).toBe(4);
  expect(await Bun.file(join(clone, 'CLAUDE.local.md')).exists()).toBe(false);
  await executePlan(server, result!.localPlanId!, 'apply');
  expect(await Bun.file(join(clone, 'CLAUDE.local.md')).text()).toBe(
    `Scripts live in ${clone}/bin.\n`,
  );
  expect((await stat(join(clone, '.claude/hooks/check.sh'))).mode & 0o100).toBe(0o100);
  expect(await Bun.file(join(clone, '.claude/rules/team.md')).exists()).toBe(false);
  const [guidance] = prepared.global;
  expect(guidance).toMatchObject({ root: '.claude', files: 1 });
  await executePlan(server, guidance!.planId!, 'apply');
  expect(await Bun.file(join(serverHome, '.claude/CLAUDE.md')).text()).toBe(
    `Notes in ${serverHome}/notes.\n`,
  );
});

test('opted-in global settings and Skills copy per harness folder; account and trust files are refused', async () => {
  const { laptop, server, serverRoot } = await machines();
  await mkdir(serverRoot, { recursive: true });
  await Bun.write(
    join(laptop.home, '.claude/settings.json'),
    `{"hooks":{"Stop":"${laptop.home}/bin/notify"}}\n`,
  );
  await Bun.write(join(laptop.home, '.claude/skills/review/SKILL.md'), '---\nname: review\n---\n');
  await Bun.write(join(laptop.home, '.agents/skills/linked/SKILL.md'), '---\nname: linked\n---\n');
  await symlink('../../.agents/skills/linked', join(laptop.home, '.claude/skills/linked'));
  const serverHome = join(laptop.root, 'server-home');
  await mkdir(join(serverHome, '.claude'), { recursive: true });
  const { request, withheld } = await buildSyncRequest(laptop.store, [laptop.root], {
    home: laptop.home,
    localFiles: false,
    globalSettings: true,
    globalSkills: true,
  });
  expect(request.globalFiles?.map((file) => `${file.root}/${file.path}`).sort()).toEqual([
    '.agents/skills/linked/SKILL.md',
    '.claude/settings.json',
    '.claude/skills/linked/SKILL.md',
    '.claude/skills/review/SKILL.md',
  ]);
  expect(withheld.map((value) => value.name)).toEqual(
    expect.arrayContaining(['~/.claude.json', '~/.codex/config.toml']),
  );
  const prepared = await prepareSync(server, JSON.parse(JSON.stringify(request)), [serverRoot], {
    home: serverHome,
  });
  const byRoot = Object.fromEntries(prepared.global.map((value) => [value.root, value]));
  expect(byRoot['.agents']?.error).toContain('install that agent first');
  expect(byRoot['.claude']?.files).toBe(3);
  await executePlan(server, byRoot['.claude']!.planId!, 'apply');
  expect(await Bun.file(join(serverHome, '.claude/settings.json')).text()).toBe(
    `{"hooks":{"Stop":"${serverHome}/bin/notify"}}\n`,
  );
  expect(await Bun.file(join(serverHome, '.claude/skills/linked/SKILL.md')).exists()).toBe(true);
  await executePlan(server, byRoot['.claude']!.planId!, 'rollback');
  expect(await Bun.file(join(serverHome, '.claude/settings.json')).exists()).toBe(false);
});

test('no copied tree sends Git metadata, dependencies, private files or credential-like content', async () => {
  const { laptop } = await machines();
  const git = (...args: string[]) =>
    Bun.spawnSync([
      'git',
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      '-C',
      laptop.project,
      ...args,
    ]);
  git('init', '-q');
  git('remote', 'add', 'origin', 'git@github.com:owner/app.git');
  const skill = join(laptop.project, '.agents/skills/cloned-skill');
  await Bun.write(join(skill, 'SKILL.md'), '---\nname: cloned-skill\n---\n');
  await Bun.write(
    join(skill, '.git/config'),
    '[remote "origin"]\n\turl = https://user:ghp_examplesecret0000000000@github.com/x/y\n',
  );
  await Bun.write(join(skill, 'node_modules/pkg/index.js'), 'module.exports = 1;\n');
  await Bun.write(
    join(skill, 'scripts/set-token.sh'),
    'export API_TOKEN="replace-with-your-token-value"\n',
  );
  await Bun.write(join(skill, '.env'), 'SECRET=1\n');
  const global = join(laptop.home, '.claude/skills/global-skill');
  await Bun.write(join(global, 'SKILL.md'), '---\nname: global-skill\n---\n');
  await Bun.write(join(global, '.env.local'), 'SECRET=2\n');
  await Bun.write(join(global, '.git/HEAD'), 'ref: refs/heads/main\n');
  const memory = join(laptop.home, '.claude/projects', claudeMemoryKey(laptop.project), 'memory');
  await Bun.write(join(memory, 'notes.md'), 'Plain note.\n');
  await Bun.write(join(memory, '.env'), 'SECRET=3\n');
  const { request, withheld } = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    memory: ['project'],
    globalSkills: true,
  });
  const sent = [
    ...(request.projects[0]?.localFiles ?? []).map((file) => file.path),
    ...(request.projects[0]?.memory ?? []).map((file) => `memory/${file.path}`),
    ...(request.globalFiles ?? []).map((file) => `${file.root}/${file.path}`),
  ].sort();
  expect(sent).toEqual([
    '.agents/skills/cloned-skill/SKILL.md',
    '.claude/skills/global-skill/SKILL.md',
    'memory/notes.md',
  ]);
  expect(JSON.stringify(request)).not.toContain('ghp_examplesecret');
  expect(withheld.map((value) => value.name)).toEqual(
    expect.arrayContaining([
      'project/.agents/skills/cloned-skill/scripts/set-token.sh',
      'project/.agents/skills/cloned-skill/.env',
      '~/.claude/skills/global-skill/.env.local',
      'memory/.env',
    ]),
  );
});

test('the server refuses bundles that would write Git metadata, dependency folders or private files', async () => {
  const { server, serverRoot } = await machines();
  await repository(join(serverRoot, 'app'), 'https://github.com/owner/app');
  const file = (path: string) => ({
    path,
    content: Buffer.from('x').toString('base64'),
    executable: false,
  });
  for (const path of [
    '.git/hooks/post-checkout',
    '.agents/skills/x/node_modules/a.js',
    '.claude/rules/.env',
  ])
    await expect(
      prepareSync(
        server,
        {
          library: {
            format: 'kitfold-library',
            schemaVersion: 1,
            exportedAt: '',
            entries: [],
            sources: [],
            presets: [],
            rules: [],
          },
          sourceHome: '/laptop',
          projects: [
            {
              repository: 'github.com/owner/app',
              sourceProject: '/laptop/app',
              localFiles: [file(path)],
            },
          ],
        },
        [serverRoot],
      ),
    ).rejects.toThrow();
});

test('global guidance is sent by default and can be left out', async () => {
  const { laptop } = await machines();
  await Bun.write(join(laptop.home, '.codex/AGENTS.md'), '# How I work\n');
  const included = await buildSyncRequest(laptop.store, [laptop.root], {
    home: laptop.home,
    localFiles: false,
  });
  expect(included.request.globalFiles?.map((file) => `${file.root}/${file.path}`)).toEqual([
    '.codex/AGENTS.md',
  ]);
  const skipped = await buildSyncRequest(laptop.store, [laptop.root], {
    home: laptop.home,
    localFiles: false,
    globalGuidance: false,
  });
  expect(skipped.request.globalFiles).toBeUndefined();
});

test('everything mode adds settings, global Skills and memory for every project, never account or trust files', async () => {
  const { laptop } = await machines();
  await repository(laptop.project, 'git@github.com:owner/app.git');
  const skill = sampleSkill(laptop.store, 'all-guide');
  const plan = await createPlan(laptop.store, {
    projectPath: laptop.project,
    providers: ['claude'],
    entryIds: [skill.id],
    requirements: '',
    includeRules: false,
    allowReviewed: false,
  });
  await executePlan(laptop.store, plan.id, 'apply');
  await Bun.write(join(laptop.home, '.claude/settings.json'), '{}\n');
  await Bun.write(
    join(laptop.home, '.claude/skills/everywhere/SKILL.md'),
    '---\nname: everywhere\n---\n',
  );
  await Bun.write(join(laptop.home, '.claude.json'), '{"oauthAccount":{}}');
  await Bun.write(
    join(laptop.home, '.claude/projects', claudeMemoryKey(laptop.project), 'memory/notes.md'),
    'note\n',
  );
  const { request } = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    localFiles: false,
    everything: true,
  });
  expect(request.projects[0]?.memory?.map((file) => file.path)).toEqual(['notes.md']);
  expect(request.globalFiles?.map((file) => `${file.root}/${file.path}`).sort()).toEqual([
    '.claude/settings.json',
    '.claude/skills/everywhere/SKILL.md',
  ]);
  expect(JSON.stringify(request)).not.toContain('oauthAccount');
});

test('projects the server has no clone of send nothing, not even local files', async () => {
  const { laptop } = await machines();
  const matched = join(laptop.root, 'matched');
  const other = join(laptop.root, 'other');
  await repository(matched, 'git@github.com:owner/matched.git');
  await repository(other, 'git@github.com:owner/other.git');
  await Bun.write(join(matched, 'CLAUDE.local.md'), 'Matched notes\n');
  await Bun.write(join(other, 'CLAUDE.local.md'), 'Unmatched notes\n');
  const { request, skipped } = await buildSyncRequest(laptop.store, [laptop.root], {
    onlyRepositories: ['github.com/owner/matched'],
    globalGuidance: false,
  });
  expect(request.projects.map((project) => project.repository)).toEqual([
    'github.com/owner/matched',
  ]);
  expect(JSON.stringify(request)).not.toContain('Unmatched notes');
  expect(skipped).toContainEqual({ name: 'other', reason: 'no matching project on the server' });
});

test('MCP approvals and Codex trust never travel, whatever the laptop sends', async () => {
  const { laptop, server, serverRoot } = await machines();
  await repository(laptop.project, 'git@github.com:owner/app.git');
  const approval = '{"enableAllProjectMcpServers": true, "enabledMcpjsonServers": ["db"]}';
  await Bun.write(join(laptop.project, '.claude/settings.json'), approval);
  await Bun.write(join(laptop.home, '.claude/settings.json'), approval);
  const { request, withheld } = await buildSyncRequest(laptop.store, [laptop.project], {
    home: laptop.home,
    globalSettings: true,
  });
  expect(JSON.stringify(request)).not.toContain(Buffer.from(approval).toString('base64'));
  expect(withheld.map((value) => value.name)).toEqual(
    expect.arrayContaining(['project/.claude/settings.json', '~/.claude/settings.json']),
  );
  const library = { ...(request.library as object) };
  const bundle = (globalFiles: SyncRequest['globalFiles']) =>
    prepareSync(
      server,
      { library, sourceHome: '/laptop', projects: [], globalFiles },
      [serverRoot],
      { home: join(laptop.root, 'server-home') },
    );
  const encoded = (text: string) => Buffer.from(text).toString('base64');
  await expect(
    bundle([{ root: '.codex', path: 'config.toml', content: encoded('x'), executable: false }]),
  ).rejects.toThrow();
  await expect(
    bundle([
      { root: '.claude', path: 'settings.json', content: encoded(approval), executable: false },
    ]),
  ).rejects.toThrow();
});

test('a global Skill link is followed only to a Skill folder inside the same home', async () => {
  const { laptop } = await machines();
  const outside = join(laptop.root, 'outside');
  await Bun.write(join(outside, 'SKILL.md'), '---\nname: outside\n---\n');
  await Bun.write(join(outside, 'notes.md'), 'Outside the home folder\n');
  await Bun.write(join(laptop.home, 'notes/plain.md'), 'Not a Skill\n');
  await Bun.write(join(laptop.home, 'dev/skills/own/SKILL.md'), '---\nname: own\n---\n');
  await mkdir(join(laptop.home, '.claude/skills'), { recursive: true });
  await symlink(outside, join(laptop.home, '.claude/skills/outside'));
  await symlink(laptop.home, join(laptop.home, '.claude/skills/home'));
  await symlink(join(laptop.home, 'notes'), join(laptop.home, '.claude/skills/notes'));
  await symlink(join(laptop.home, 'dev/skills/own'), join(laptop.home, '.claude/skills/own'));
  const { request } = await buildSyncRequest(laptop.store, [], {
    home: laptop.home,
    globalGuidance: false,
    globalSkills: true,
  });
  expect(request.globalFiles?.map((file) => `${file.root}/${file.path}`)).toEqual([
    '.claude/skills/own/SKILL.md',
  ]);
});

test('a second checkout of the same repository is reported instead of sent twice', async () => {
  const { laptop } = await machines();
  for (const name of ['app', 'app-worktree']) {
    await repository(join(laptop.root, name), 'git@github.com:owner/app.git');
    await Bun.write(join(laptop.root, name, 'CLAUDE.local.md'), `${name} notes\n`);
  }
  const { request, skipped } = await buildSyncRequest(laptop.store, [laptop.root], {
    globalGuidance: false,
  });
  expect(request.projects.map((project) => project.sourceProject)).toEqual([
    join(laptop.root, 'app'),
  ]);
  expect(skipped).toContainEqual({
    name: 'app-worktree',
    reason: 'another checkout of this repository is already sent',
  });
});

test('a harness folder that is a link on the server is named as a link, not as missing', async () => {
  const { laptop, server, serverRoot } = await machines();
  const serverHome = join(laptop.root, 'server-home');
  await mkdir(join(laptop.root, 'dotfiles/claude'), { recursive: true });
  await mkdir(serverHome, { recursive: true });
  await symlink(join(laptop.root, 'dotfiles/claude'), join(serverHome, '.claude'));
  await Bun.write(join(laptop.home, '.claude/CLAUDE.md'), 'Global notes\n');
  const { request } = await buildSyncRequest(laptop.store, [], { home: laptop.home });
  const prepared = await prepareSync(server, JSON.parse(JSON.stringify(request)), [serverRoot], {
    home: serverHome,
  });
  expect(prepared.global).toEqual([
    {
      root: '.claude',
      error: expect.stringContaining('is a link; Rigshelf does not write through links'),
    },
  ]);
});
