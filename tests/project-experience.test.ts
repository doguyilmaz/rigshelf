import { afterEach, expect, test } from 'bun:test';
import { copyFile, mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, Provider } from '../src/core/model';
import { matchesManifest, ownedProject } from '../src/core/ownership';
import { createPlan, executePlan } from '../src/core/planner';
import { route } from '../src/core/service';
import { reviseSkill } from '../src/core/skill-revisions';

interface SetupDetection {
  project: Project;
  presetId: string;
  previousSetup?: {
    providers: Provider[];
    entryIds: string[];
    requirements: string;
    presetId?: string;
    manifestMatches: boolean;
  };
}

import { fixture, sampleSkill } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  await Bun.write(join(data.project, 'package.json'), '{}');
  return data;
}

test('returning-project inspection restores privately reviewed Harnesses, brief and exact Snapshot pins without applying or granting approval', async () => {
  const data = await setup();
  const original = sampleSkill(data.store, 'focused-guide');
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['claude', 'opencode'],
    entryIds: [original.id],
    requirements: 'A focused command-line utility.',
    presetId: 'cli',
  });
  await executePlan(data.store, plan.id, 'apply');
  reviseSkill(data.store, original.id, {
    body: 'A newer version must not replace the installed pin.',
  });
  const before = await Bun.file(join(data.project, '.rigshelf/kit.json')).text();
  const result = (await route(data.store, 'POST', 'detect', {
    projectPath: data.project,
    restorePrevious: true,
  })) as SetupDetection;
  expect(result.previousSetup?.providers).toEqual(['claude', 'opencode']);
  expect(result.previousSetup?.entryIds).toEqual([original.id]);
  expect(result.previousSetup?.requirements).toBe('A focused command-line utility.');
  expect(result.project.requirements).toBe('A focused command-line utility.');
  expect(result.presetId).toBe('cli');
  expect(result.previousSetup?.manifestMatches).toBe(true);
  expect(await Bun.file(join(data.project, '.rigshelf/kit.json')).text()).toBe(before);
  expect(data.store.list('approval')).toEqual([]);
  expect(data.store.planSummaries()).toHaveLength(1);
  const changed = (await route(data.store, 'POST', 'detect', {
    projectPath: data.project,
    requirements: 'Changed explicit requirements.',
    restorePrevious: false,
  })) as SetupDetection;
  expect(changed.project.requirements).toBe('Changed explicit requirements.');
});

test('a copied repository manifest is not presented as a privately reviewed setup on another project', async () => {
  const data = await setup();
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex'],
    entryIds: [],
    requirements: 'Private reviewed brief.',
  });
  await executePlan(data.store, plan.id, 'apply');
  const other = join(data.root, 'other');
  await mkdir(join(other, '.rigshelf'), { recursive: true });
  await Bun.write(join(other, 'package.json'), '{}');
  await copyFile(join(data.project, '.rigshelf/kit.json'), join(other, '.rigshelf/kit.json'));
  const result = (await route(data.store, 'POST', 'detect', {
    projectPath: other,
    restorePrevious: true,
  })) as SetupDetection;
  expect(result.previousSetup).toBeUndefined();
  expect(result.project.requirements).toBe('');
  expect(data.store.list('approval')).toEqual([]);
});

test('manifest status refuses linked leaves and replaced parent directories instead of reading the linked target', async () => {
  const data = await setup();
  const plan = await createPlan(data.store, {
    projectPath: data.project,
    providers: ['codex'],
    entryIds: [],
  });
  await executePlan(data.store, plan.id, 'apply');
  const owned = (await ownedProject(data.store, data.project))!;
  const path = join(data.project, '.rigshelf/kit.json');
  await rename(path, join(data.root, 'manifest-original.json'));
  await symlink(join(data.root, 'manifest-original.json'), path);
  expect(await matchesManifest(owned)).toBe(false);
  const result = (await route(data.store, 'POST', 'detect', {
    projectPath: data.project,
    restorePrevious: true,
  })) as SetupDetection;
  expect(result.previousSetup?.manifestMatches).toBe(false);
  await rename(join(data.project, '.rigshelf'), join(data.project, '.rigshelf-saved'));
  await symlink(join(data.project, '.rigshelf-saved'), join(data.project, '.rigshelf'));
  expect(await matchesManifest(owned)).toBe(false);
});
