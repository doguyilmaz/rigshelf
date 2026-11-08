import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSyncRequest, prepareSync } from '../src/core/machine-sync';
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
  const [guidance] = prepared.globalGuidance;
  expect(guidance).toMatchObject({ root: '.claude', files: 1 });
  await executePlan(server, guidance!.planId!, 'apply');
  expect(await Bun.file(join(serverHome, '.claude/CLAUDE.md')).text()).toBe(
    `Notes in ${serverHome}/notes.\n`,
  );
});
