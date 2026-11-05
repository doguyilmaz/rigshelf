import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { route } from '../src/core/service';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
const skill = sampleSkill(data.store, 'focused-mobile-guide');
for (let index = 0; index < 55; index++)
  await route(data.store, 'POST', 'sources', {
    input: `https://github.com/example-team/collection-${index}`,
    research: false,
  });
const source = data.store.sources().find((value) => value.name === 'example-team/collection-54')!;
source.name = `Mobile Engineering ${'guidance-'.repeat(20)} 日本語`;
data.store.put('source', source);
skill.sourceId = source.id;
data.store.saveEntry(skill);
const server = startServer(data.store, 47974);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  reducedMotion: 'reduce',
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/controls');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
try {
  await page.goto(server.accessUrl);
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  const path = page.getByLabel('Project directory', { exact: true });
  await path.fill('~/Projects/a-new-project');
  await path.press('Escape');
  await expect(path).toHaveValue('~/Projects/a-new-project');
  checks.push('Custom path autocomplete accepts and preserves new project paths.');
  const preset = page.getByLabel('Starting preset', { exact: true });
  await preset.click();
  const presetSearch = page.getByLabel('Search starting preset', { exact: true });
  await presetSearch.fill('hono');
  await presetSearch.press('ArrowDown');
  await presetSearch.press('Enter');
  await expect(preset).toHaveText('Bun + Hono');
  checks.push('Searchable presets support filtering, arrow-key selection and Enter confirmation.');

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.locator('.entry-list-row').first().click();
  const dialog = page.getByRole('dialog').first();
  const relationship = dialog.getByLabel('Source relationship', { exact: true });
  await relationship.click();
  const search = page.getByLabel('Search source relationship', { exact: true });
  await search.fill('collection-5');
  await expect(
    page.getByRole('option', { name: 'example-team/collection-5', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(relationship).toBeFocused();
  await relationship.click();
  await page.getByLabel('Search source relationship', { exact: true }).fill('not-a-real-source');
  await expect(page.getByText('No matching options.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  checks.push(
    'Dialog popups are visible; Escape dismisses only the popup and restores focus; empty search has feedback.',
  );

  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    if (width <= 1050) {
      const toggle = page.getByRole('button', { name: /^Filters/ });
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    const group = page.getByLabel('Source', { exact: true });
    await group.click();
    await page.getByLabel('Search source', { exact: true }).fill('Mobile Engineering');
    const option = page.getByRole('option', { name: source.name, exact: true });
    await expect(option).toBeVisible();
    const popup = page.locator('.select-popup');
    const bounds = await popup.boundingBox();
    if (
      !bounds ||
      bounds.x < -1 ||
      bounds.x + bounds.width > width + 1 ||
      bounds.y < -1 ||
      bounds.y + bounds.height > 801
    )
      throw new Error(`Popup escapes ${width}px viewport: ${JSON.stringify(bounds)}`);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    if (axe.violations.length)
      throw new Error(`Popup accessibility: ${axe.violations.map((value) => value.id).join(', ')}`);
    await page.screenshot({ path: join(directory, `popup-${width}.png`) });
    await option.click();
    await expect(group).toHaveText(source.name);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Selected long label causes horizontal overflow at ${width}px`);
    await group.click();
    await page.getByLabel('Search source', { exact: true }).fill('Any source');
    await page.getByRole('option', { name: 'Any source', exact: true }).click();
  }
  checks.push(
    'Long labels and open searchable popups fit six desktop/tablet/mobile widths with no Axe violations.',
  );
  await page.setViewportSize({ width: 1280, height: 600 });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsBox = await settings.boundingBox();
  if (!settingsBox || settingsBox.y + settingsBox.height > 600)
    throw new Error('Sidebar settings escaped the short viewport.');
  checks.push('Sidebar settings remain reachable in a short desktop window.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/entries/*', async (request) => {
    await pending;
    await request.continue();
  });
  const entry = page.locator('.entry-list-row').first();
  await entry.click();
  const editor = page.locator('dialog.modal');
  await expect.poll(() => editor.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  const beforeLoad = await editor.boundingBox();
  release();
  await editor.getByRole('button', { name: /^Files/ }).click();
  await expect(editor.locator('.file-list')).toBeVisible();
  const afterLoad = await editor.boundingBox();
  if (
    !beforeLoad ||
    !afterLoad ||
    Math.abs(beforeLoad.y - afterLoad.y) > 1 ||
    Math.abs(beforeLoad.height - afterLoad.height) > 1
  )
    throw new Error('Loading content or switching tabs moved the editor frame.');
  await editor.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(editor).toHaveAttribute('data-exiting', 'true');
  await expect(editor).toHaveAttribute('inert', '');
  await expect(editor).toHaveCount(0);
  await expect(entry).toBeFocused();
  await page.unroute('**/api/entries/*');
  checks.push(
    'Normal-motion dialogs retain their frame across delayed data and tabs, leave before unmounting, and restore focus.',
  );
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  const addSource = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  await addSource
    .getByLabel('URL, repository, or installation command')
    .fill('A local motion-review reference');
  await addSource.getByLabel('Display name').fill('Motion review reference');
  await addSource.getByRole('button', { name: 'Add to library', exact: true }).click();
  const nextEditor = page.getByRole('dialog', { name: 'Motion review reference', exact: true });
  await expect(nextEditor).toBeVisible();
  await expect(page.locator('dialog.modal')).toHaveCount(1);
  await nextEditor.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('dialog.modal')).toHaveCount(0);
  checks.push('Replacing one editor with another settles to one dialog and shares one backdrop.');
  await page.goto(`${new URL(server.accessUrl).origin}/prototypes/project-setup.html?v=1`);
  await page.getByRole('button', { name: 'Step by step', exact: true }).click();
  await expect(page.locator('.prototype-app')).toHaveClass(/canvas/);
  await page.getByRole('button', { name: 'Files visible', exact: true }).click();
  await expect(page.locator('.prototype-app')).toHaveClass(/console/);
  await page.getByRole('button', { name: 'All together', exact: true }).click();
  await expect(page.locator('.prototype-app')).toHaveClass(/workbench/);
  checks.push('The served design preview switches layouts under the unchanged application CSP.');
  if (errors.length) throw new Error(errors.join('\n'));
  const report = { checks, errors, widths: [1440, 1280, 1024, 768, 390, 320] };
  await Bun.write(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
