import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import type { ProjectSuggestion } from '../src/core/watch';
import { fixture, sampleSkill } from './helpers';

test('manual project checks use current dependencies while preserving guidance/inventory and cannot request automatic writes', async () => {
  const data = await fixture();
  try {
    const skill = sampleSkill(data.store, 'better-auth');
    const guidance = '# Authored instructions\n\nPreserve this exact guidance.\n';
    await Bun.write(join(data.project, 'AGENTS.md'), guidance);
    await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"hono":"4"}}');
    await scan(data.store, { roots: [data.project], globals: false, home: data.home });
    const project = data.store.projects()[0]!;
    await Bun.write(
      join(data.project, 'package.json'),
      '{"dependencies":{"hono":"4","better-auth":"1"}}',
    );
    await expect(
      route(data.store, 'POST', `projects/${project.id}/check`, { auto: true }),
    ).rejects.toThrow();
    const result = (await route(
      data.store,
      'POST',
      `projects/${project.id}/check`,
      {},
    )) as ProjectSuggestion;
    expect(result.additions.some((item) => item.entry.id === skill.id)).toBe(true);
    expect(result.autoApplied).toBe(false);
    expect(data.store.planSummaries()).toHaveLength(0);
    expect(data.store.list('approval')).toEqual([]);
    expect(data.store.list('trust')).toEqual([]);
    expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(guidance);
    expect(await Bun.file(join(data.project, '.agents/skills/better-auth/SKILL.md')).exists()).toBe(
      false,
    );
    expect(data.store.projects()[0]?.documentLocations).toEqual(project.documentLocations);
    expect(data.store.projects()[0]?.dependencies).toContain('better-auth');
    expect(await route(data.store, 'POST', `projects/${project.id}/check`, {})).toMatchObject({
      unchanged: true,
    });
  } finally {
    await data.cleanup();
  }
});
