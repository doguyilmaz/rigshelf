import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { createPlan, executePlan } from '../src/core/planner';
import { scan } from '../src/core/scanner';
import { reviseSkill } from '../src/core/skill-revisions';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
const other = join(data.root, 'other-project');
await mkdir(other);
await Bun.write(join(data.project, 'package.json'), '{}');
await Bun.write(join(other, 'package.json'), '{}');
const original = sampleSkill(data.store, 'focused-guide');
const extra = sampleSkill(data.store, 'api-review');
await scan(data.store, { roots: [data.project, other], globals: false, home: data.home });
const baseline = await createPlan(data.store, {
  projectPath: data.project,
  providers: ['codex'],
  entryIds: [original.id],
  requirements: 'Keep this reviewed brief.',
});
await executePlan(data.store, baseline.id, 'apply');
const before = await Bun.file(join(data.project, '.agents/skills/focused-guide/SKILL.md')).text();
const newer = reviseSkill(data.store, original.id, {
  body: 'A newer, explicitly chosen review guide.',
});
const server = startServer(data.store, 48014);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/project-context');
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
  await page
    .locator('.setup-known-projects button')
    .filter({ has: page.getByText('project', { exact: true }) })
    .click();
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  await expect(page.getByLabel('What are you making?', { exact: true })).toHaveValue(
    'Keep this reviewed brief.',
  );
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  const banner = page.getByRole('complementary', { name: 'Current project kit', exact: true });
  await expect(banner).toContainText('Choosing tools for project');
  await page.getByLabel('Search library', { exact: true }).fill('focused-guide');
  await page.getByRole('button', { name: 'Open focused-guide', exact: true }).click();
  let detail = page.getByRole('dialog', { name: 'focused-guide', exact: true });
  await expect(detail.getByLabel('Snapshot version', { exact: true })).toContainText(
    newer.digest.slice(0, 10),
  );
  await detail.getByRole('button', { name: 'Add to project kit', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  await expect(page.getByRole('dialog', { name: 'focused-guide', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(1);
  await expect(page.getByLabel('What are you making?', { exact: true })).toHaveValue(
    'Keep this reviewed brief.',
  );
  expect(await Bun.file(join(data.project, '.agents/skills/focused-guide/SKILL.md')).text()).toBe(
    before,
  );
  expect(data.store.planSummaries()).toHaveLength(1);
  checks.push(
    'Library shows the current kit and adds the exact inspected Snapshot version back to that draft, preserving its brief and leaving applied files untouched.',
  );
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByLabel('Search library', { exact: true }).fill('api-review');
  await page.getByRole('button', { name: 'Open api-review', exact: true }).click();
  detail = page.getByRole('dialog', { name: 'api-review', exact: true });
  await detail.getByLabel('Tags', { exact: true }).fill('backend, unsaved-note');
  await detail.getByRole('button', { name: 'Add to project kit', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(detail.getByLabel('Tags', { exact: true })).toHaveValue('backend, unsaved-note');
  await expect(detail).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`entry-handoff-${width}`);
  }
  await detail.getByRole('button', { name: 'Add to project kit', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(2);
  expect(data.store.entry(extra.id)?.tags).toEqual(extra.tags);
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your setup', exact: true });
  await review.waitFor();
  const planned = data.store.planSummaries().find((item) => item.id !== baseline.id)!;
  expect(planned.entries).toContain(newer.id);
  expect(planned.entries).toContain(extra.id);
  expect(planned.entries).not.toContain(original.id);
  expect(await Bun.file(join(data.project, '.agents/skills/focused-guide/SKILL.md')).text()).toBe(
    before,
  );
  await review.getByRole('button', { name: 'Back to kit', exact: true }).click();
  checks.push(
    'Canceled metadata discard retains edits. Explicit discard adopts only the saved Snapshot; the reviewed plan uses the selected exact revision and still writes no files.',
  );
  await page.getByRole('button', { name: 'Start another project', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await page.locator('.setup-known-projects button').filter({ hasText: 'other-project' }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('other-project');
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(banner).toContainText('Choosing tools for other-project');
  await page.getByLabel('Search library', { exact: true }).fill('focused-guide');
  await page.getByRole('button', { name: 'Open focused-guide', exact: true }).click();
  detail = page.getByRole('dialog', { name: 'focused-guide', exact: true });
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await banner.getByRole('button', { name: 'Return to project kit', exact: true }).click();
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(0);
  expect(data.store.list('approval')).toEqual([]);
  expect(data.store.list('trust')).toEqual([]);
  expect(await Bun.file(join(other, '.rigshelf/kit.json')).exists()).toBe(false);
  checks.push(
    'Switching project clears the draft context; consumed Library requests never replay into the next project, and context/navigation grants no ownership or automation permission.',
  );
  const denied = await context.newPage();
  await denied.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'rigshelf:project-draft:v1')
        throw new DOMException('Fixture quota', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await denied.goto(server.accessUrl);
  await denied
    .locator('.setup-known-projects button')
    .filter({ has: denied.getByText('project', { exact: true }) })
    .click();
  await denied.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await expect(
    denied.getByText(
      'This tab could not keep the latest draft. Keep it open until you create a setup plan.',
      { exact: true },
    ),
  ).toBeVisible();
  await denied
    .getByLabel('What are you making?', { exact: true })
    .fill('Still editable with recovery unavailable.');
  await expect(denied.getByLabel('What are you making?', { exact: true })).toHaveValue(
    'Still editable with recovery unavailable.',
  );
  await denied.close();
  checks.push(
    'Browser storage failure is visible and leaves the current form editable instead of silently claiming that the latest draft can be recovered.',
  );
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
