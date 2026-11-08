import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import type { MachineInventory } from '../src/core/machine-inventory';
import type { RemoteRunner } from '../src/core/machine-ssh';
import { createPlan, executePlan } from '../src/core/planner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
await Bun.write(join(data.home, '.ssh/config'), 'Host build-box\n  HostName 192.0.2.10\n');
await Bun.write(
  join(data.project, '.git/config'),
  '[remote "origin"]\n\turl = git@github.com:owner/app.git\n',
);
const guide = sampleSkill(data.store, 'guide');
const kit = await createPlan(data.store, {
  projectPath: data.project,
  providers: ['claude'],
  entryIds: [guide.id],
  requirements: '',
  includeRules: false,
  allowReviewed: false,
});
await executePlan(data.store, kit.id, 'apply');
data.store.put('settings', {
  id: 'main',
  ...data.store.settings(),
  roots: [data.project],
  scanGlobals: false,
});
const planId = '0b6d1c1e-2f4a-4c8e-9a51-6d2f3e4a5b6c';
const memoryPlanId = '1c7e2d2f-3a5b-4d9f-8b62-7e3f4a5b6c7d';
const localPlanId = '2d8f3e3a-4b6c-4eaf-9c73-8f4a5b6c7d8e';
const guidancePlanId = '3e9a4f4b-5c7d-4fb0-ad84-9a5b6c7d8e9f';
const remote: MachineInventory = {
  version: 1,
  rigshelf: '0.1.0',
  global: [],
  projects: [
    {
      name: 'app-checkout',
      repository: 'github.com/owner/app',
      items: [
        {
          key: 'memory/notes.md',
          group: 'memory',
          harness: 'claude',
          digest: 'a'.repeat(64),
          files: 1,
          bytes: 1,
          privacy: 'machine-specific',
        },
      ],
    },
    { name: 'server-tools', repository: 'github.com/owner/tools', items: [] },
  ],
};
const requests: { command: string; input?: string }[] = [];
const machineRunner: RemoteRunner = async (args, input) => {
  const command = args.at(-1)!;
  requests.push({ command, input });
  const reply = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
  if (command.includes('machine doctor'))
    return reply({
      here: { rigshelf: '0.0.9', platform: 'linux-x64', harnesses: { claude: true, codex: true } },
    });
  if (command.includes('machine inventory')) return reply(remote);
  if (command.includes('machine prepare'))
    return reply({
      library: { entries: 1 },
      directives: { added: [], replaced: [], kept: ['communication'] },
      projects: [
        {
          repository: 'github.com/owner/app',
          path: '/srv/app-checkout',
          planId,
          files: 4,
          warnings: [],
          localPlanId,
          localFiles: 3,
          memoryPlanId,
          memoryFiles: 1,
        },
      ],
      global: [{ root: '.claude', planId: guidancePlanId, files: 1 }],
    });
  return reply({ status: 'applied', fileCount: 4 });
};
const server = startServer(data.store, 48026, { machineRunner, machineHome: data.home });
const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
).newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/machines');
await mkdir(directory, { recursive: true });
async function audit(name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  if (result.violations.length)
    await Bun.write(
      join(directory, 'accessibility-failure.json'),
      JSON.stringify(result.violations, null, 2),
    );
  expect(result.violations.map((value) => value.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Machines', exact: true })).toBeVisible();
  await expect(page.getByText('build-box', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(
    page.getByText(
      'Rigshelf 0.1.0 here and 0.0.9 on build-box. Install the same version on both machines.',
    ),
  ).toBeVisible();
  const project = page.locator('.machine-card').filter({ hasText: 'github.com/owner/app' });
  await expect(project).toContainText('Skills: 1 missing there');
  await expect(project).toContainText('Memory: 1 missing here');
  await expect(page.getByText('Only on build-box (1): server-tools')).toBeVisible();
  await project.getByText('2 differences').click();
  await expect(project.getByText('.claude/skills/guide', { exact: true })).toBeVisible();
  await project.getByLabel('Include memory in sync').check();
  await page.getByLabel('Global guidance (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md)').check();
  await audit('compare-1440');
  await page.getByRole('button', { name: 'Prepare sync', exact: true }).click();
  await expect(page.getByText('4 file changes')).toBeVisible();
  await expect(page.getByText('memory: 1 files')).toBeVisible();
  await expect(page.getByText('local files: 3')).toBeVisible();
  await expect(page.getByText('~/.claude', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Directives that differ on build-box were kept: communication'),
  ).toBeVisible();
  const prepared = JSON.parse(
    requests.find((value) => value.command.includes('machine prepare'))!.input!,
  );
  expect(prepared.projects[0].memory).toEqual([]);
  expect(prepared.globalFiles).toBeUndefined();

  expect(requests.some((value) => value.command.includes('rigshelf apply'))).toBe(false);
  await page.getByRole('button', { name: 'Apply on build-box', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply 4 plans on build-box?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Applied on build-box')).toBeVisible();
  const applied = requests
    .filter((value) => value.command.includes('rigshelf apply'))
    .map((value) => value.command);
  expect(applied).toEqual([
    `exec "$SHELL" -lc 'rigshelf apply ${planId}'`,
    `exec "$SHELL" -lc 'rigshelf apply ${localPlanId}'`,
    `exec "$SHELL" -lc 'rigshelf apply ${memoryPlanId}'`,
    `exec "$SHELL" -lc 'rigshelf apply ${guidancePlanId}'`,
  ]);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(project).toContainText('Skills: 1 missing there');
  await audit('compare-390');
  expect(errors).toEqual([]);
  const report = {
    checks: [
      'Machines lists concrete SSH aliases, compares groups per project and collapses projects only on one side.',
      'Prepare sync sends opted-in memory and applies nothing until the user confirms both plans.',
      'Version mismatch, kept directives and plan sizes are visible; the page fits 1440 and 390 widths without accessibility violations.',
    ],
    errors,
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
