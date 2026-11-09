import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
const skillDirectory = join(data.root, 'Skill 日本語');
const addedRoot = join(data.root, 'Project root with spaces');
await mkdir(skillDirectory);
await mkdir(addedRoot);
await Bun.write(
  join(skillDirectory, 'SKILL.md'),
  '---\nname: picked-guide\ndescription: Use this fixture guide when checking folder imports.\n---\n\nKeep this fixture unchanged.\n',
);
let selection: string | null = data.project;
let failure = false;
let waitForCancel = false;
let canceled = false;
let requests = 0;
const server = startServer(data.store, 47978, {
  chooseDirectory: async (_initial, signal) => {
    requests++;
    if (failure) throw new Error('Could not open the folder picker. Enter the path manually.');
    if (waitForCancel)
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            canceled = true;
            reject(new Error('Fixture picker canceled'));
          },
          { once: true },
        );
      });
    return selection;
  },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
const checks: string[] = [];
const directory = resolve('.local/qa/directory-picker');
await mkdir(directory, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
async function audit(state: string) {
  await assertNeutralTheme(page, state);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  if (result.violations.length)
    throw new Error(`${state}: ${result.violations.map((item) => item.id).join(', ')}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error(`${state} overflows`);
}
try {
  await page.goto(server.accessUrl);
  const project = page.getByLabel('Project directory', { exact: true });
  await project.fill('/fictional/manually-typed');
  await project.press('Escape');
  const browseProject = page.getByRole('button', { name: 'Browse project directory', exact: true });
  await browseProject.click();
  await expect(project).toHaveValue(data.project);
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  expect(await readdir(data.project)).toEqual([]);
  expect(data.store.planSummaries()).toHaveLength(0);
  expect(data.store.list('approval')).toHaveLength(0);
  selection = null;
  await browseProject.click();
  await expect(browseProject).toBeEnabled();
  await expect(project).toHaveValue(data.project);
  failure = true;
  await browseProject.click();
  await expect(page.getByRole('alert')).toContainText('Enter the path manually.');
  await project.fill('/fictional/manual-fallback');
  await project.press('Escape');
  await expect(project).toHaveValue('/fictional/manual-fallback');
  await audit('picker error with manual fallback');
  failure = false;
  selection = data.project;
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`project folder field ${width}`);
    const bounds = await browseProject.boundingBox();
    expect(bounds && bounds.x + bounds.width <= width + 1).toBeTruthy();
    if (width === 1440 || width === 390)
      await page.screenshot({ path: join(directory, `setup-${width}.png`), fullPage: true });
  }
  checks.push(
    'Project browsing inspects automatically without plans, approval or source writes; cancel/error preserve manual input at six widths.',
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await project.fill('');
  await project.press('Escape');
  waitForCancel = true;
  await browseProject.click();
  await expect(browseProject).toBeDisabled();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect.poll(() => canceled).toBe(true);
  waitForCancel = false;
  canceled = false;
  checks.push('Leaving the retained Setup page cancels its pending native folder chooser.');
  await page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  await dialog.getByRole('button', { name: 'Local folder', exact: true }).click();
  selection = skillDirectory;
  await dialog.getByRole('button', { name: 'Browse Skill directory', exact: true }).click();
  await expect(dialog.getByLabel('Skill directory', { exact: true })).toHaveValue(skillDirectory);
  expect(data.store.entries()).toHaveLength(0);
  await audit('local Skill folder field');
  await page.setViewportSize({ width: 320, height: 800 });
  await audit('local Skill folder field 320');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => data.store.entries().length).toBe(1);
  checks.push('A local Skill is imported only after the separate Add to library action.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const roots = page.locator('textarea.code-editor');
  const originalRoots = await roots.inputValue();
  const originalSettings = data.store.settings();
  selection = addedRoot;
  const addFolder = page.getByRole('button', { name: 'Add project root folder', exact: true });
  await addFolder.click();
  await expect(roots).toHaveValue(`${originalRoots}\n${addedRoot}`);
  expect(data.store.settings()).toEqual(originalSettings);
  await addFolder.click();
  await expect(addFolder).toBeEnabled();
  await expect(roots).toHaveValue(`${originalRoots}\n${addedRoot}`);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect.poll(() => data.store.settings().roots.includes(addedRoot)).toBe(true);
  await page.getByLabel('Enable write tools', { exact: true }).check();
  selection = data.project;
  await page.getByRole('button', { name: 'Browse Allowed project root', exact: true }).click();
  await expect(page.getByLabel('Allowed project root', { exact: true })).toHaveValue(data.project);
  expect(data.store.list('approval')).toHaveLength(0);
  await audit('settings folder fields');
  await page.setViewportSize({ width: 390, height: 900 });
  await audit('settings folder fields 390');
  await page.setViewportSize({ width: 1440, height: 1050 });
  checks.push(
    'Root browsing adds no duplicates and saves only on demand; MCP root selection grants no project approval.',
  );
  waitForCancel = true;
  const before = requests;
  const browseAllowed = page.getByRole('button', {
    name: 'Browse Allowed project root',
    exact: true,
  });
  await browseAllowed.click();
  await expect(browseAllowed).toBeDisabled();
  await expect.poll(() => requests).toBe(before + 1);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect.poll(() => canceled).toBe(true);
  checks.push(
    'Pending picker buttons cannot be double-clicked; leaving the page aborts the owned dialog.',
  );
  expect(errors).toHaveLength(0);
  await Bun.write(join(directory, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors }, null, 2)}\n`);
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
