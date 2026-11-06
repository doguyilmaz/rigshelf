import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { createPlan } from '../src/core/planner';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
const guide = '# Team instructions\n\nPreserve these bytes.\n';
await Bun.write(join(data.project, 'AGENTS.md'), guide);
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"hono":"4"}}');
sampleSkill(data.store, 'better-auth');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
await Bun.write(
  join(data.project, 'package.json'),
  '{"dependencies":{"hono":"4","better-auth":"1"}}',
);
for (let index = 0; index < 15; index++)
  await createPlan(data.store, {
    projectPath: data.project,
    providers: [index === 0 ? 'claude' : 'codex'],
    entryIds: [],
    requirements: `Fixture review ${index}`,
  });
const server = startServer(data.store, 48012);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/maintenance');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
async function audit(name: string) {
  await assertNeutralTheme(page, name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect project', exact: true }).click();
  let detail = page.getByRole('dialog', { name: 'project', exact: true });
  await detail.getByRole('button', { name: 'Project setup', exact: true }).click();
  await expect(
    detail.getByRole('button', { name: 'Prepare this project', exact: true }),
  ).toBeVisible();
  await expect(detail.getByLabel('Stack tags', { exact: true })).not.toBeVisible();
  await detail.getByRole('button', { name: 'Check for tools', exact: true }).click();
  await expect(detail.getByText('1 tool you can review', { exact: true })).toBeVisible();
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(guide);
  expect(data.store.planSummaries()).toHaveLength(15);
  expect(data.store.list('approval')).toEqual([]);
  expect(data.store.list('trust')).toEqual([]);
  await audit('project-overview');
  checks.push(
    'The Project setup section offers preparing the folder and a read-only dependency check; the saved suggestion creates no plan, approval or project edits.',
  );
  await detail.locator('summary').filter({ hasText: 'Project name & stack' }).click();
  await detail.getByLabel('Display name', { exact: true }).fill('Beacon API');
  await detail.getByRole('button', { name: 'Save classification', exact: true }).click();
  detail = page.getByRole('dialog', { name: 'Beacon API', exact: true });
  await expect(detail).toBeVisible();
  await detail.getByLabel('Stack tags', { exact: true }).fill('backend, hono, temporary-unsaved');
  await detail.getByRole('button', { name: 'Prepare this project', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(detail.getByLabel('Stack tags', { exact: true })).toHaveValue(
    'backend, hono, temporary-unsaved',
  );
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`project-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await detail.getByRole('button', { name: 'Prepare this project', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('Beacon API');
  await expect(page.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
  checks.push(
    'Saved classification updates the open project title. Canceling navigation retains edits; explicit discard reaches the selected project kit with no duplicate prompt.',
  );
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const suggestions = page.getByRole('region', { name: 'Project suggestions', exact: true });
  await expect(suggestions).toContainText('better-auth');
  await expect(
    suggestions.getByRole('button', { name: 'Review project kit', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.activity-plans').getByRole('button', { name: 'Inspect', exact: true }),
  ).toHaveCount(12);
  await page.getByRole('button', { name: 'Show older plans', exact: true }).click();
  await expect(
    page.locator('.activity-plans').getByRole('button', { name: 'Inspect', exact: true }),
  ).toHaveCount(15);
  await page.getByLabel('Search project history', { exact: true }).fill('claude');
  await expect(
    page.locator('.activity-plans').getByRole('button', { name: 'Inspect', exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel('Search project history', { exact: true })
    .fill('unmatched-fixture-history');
  await expect(page.getByText('No events match this search.', { exact: true })).toBeVisible();
  await page.getByLabel('Search project history', { exact: true }).fill('');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`history-${width}`);
  }
  checks.push(
    'Activity connects pending Library suggestions to their project and exposes older plans beyond the first 12, with independent local search and usable empty results.',
  );
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(guide);
  expect(await Bun.file(join(data.project, '.agents/skills/better-auth/SKILL.md')).exists()).toBe(
    false,
  );
  expect(data.store.planSummaries()).toHaveLength(15);
  expect(errors).toEqual([]);
  await Bun.write(join(directory, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
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
