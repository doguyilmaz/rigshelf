import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
const skill = sampleSkill(data.store, 'Library');
skill.name = 'Library';
data.store.saveEntry(skill);
const source = data.store.sources().find((value) => value.id === skill.sourceId)!;
source.name = 'Settings';
data.store.put('source', source);
const server = startServer(data.store, 47976);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/localization');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const roots = page.locator('textarea.code-editor');
  const original = await roots.inputValue();
  await roots.fill('/fictional/unsaved-root');
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
  await expect(roots).toHaveValue('/fictional/unsaved-root');
  await roots.fill(original);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  checks.push('Language changes preserve unsaved settings and persist after reload.');

  const second = await context.newPage();
  await second.goto(server.accessUrl);
  await expect(second.locator('html')).toHaveAttribute('lang', 'tr');
  await page.getByLabel('Arayüz dili', { exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(second.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await second.close();
  checks.push('Open tabs observe the language preference without restarting the server.');

  await page.getByRole('button', { name: 'Kütüphane', exact: true }).click();
  for (const term of ['Skills', 'MCP servers', 'Plugins'])
    await expect(page.getByRole('tab', { name: term, exact: true })).toBeVisible();
  await page.locator('.entry-list-row').first().click();
  const dialog = page.getByRole('dialog', { name: 'Library', exact: true });
  await expect(dialog).toBeVisible();
  const relationship = dialog.getByLabel('Kaynak ilişkisi', { exact: true });
  await expect(relationship).toHaveText('Settings');
  await relationship.click();
  await page.getByLabel('kaynak ilişkisi içinde ara', { exact: true }).fill('Settings');
  await expect(page.getByRole('option', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Pencereyi kapat', exact: true }).click();
  checks.push(
    'Authored skill and source names remain intact while editor labels and search are Turkish.',
  );

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      'Proje kur',
      'Kütüphane',
      'Projeler',
      'Presets',
      'Yönergeler',
      'Etkinlik',
      'Ayarlar',
    ]) {
      await page.getByRole('button', { name, exact: true }).first().click();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw new Error(`Turkish ${name} overflows at ${width}px.`);
      if ([1440, 320].includes(width)) {
        const audit = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        if (audit.violations.length)
          throw new Error(`${name}: ${audit.violations.map((value) => value.id).join(', ')}`);
      }
    }
    await page.screenshot({ path: `${directory}/settings-tr-${width}.png`, fullPage: true });
  }
  checks.push('Seven Turkish pages fit five widths; desktop/mobile Axe audits have no violations.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Arayüz dili', { exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const blockedContext = await browser.newContext();
  const blockedPage = await blockedContext.newPage();
  await blockedPage.route('**/assets/tr-*.js', (request) => request.abort());
  await blockedPage.goto(server.accessUrl);
  await blockedPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await blockedPage.getByLabel('Interface language', { exact: true }).click();
  await blockedPage.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await expect(
    blockedPage.getByText('Could not load the language. Reload the page and try again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(blockedPage.locator('html')).toHaveAttribute('lang', 'en');
  await blockedContext.close();
  checks.push(
    'An unavailable language chunk keeps the current interface and displays recovery guidance.',
  );
  if (errors.length) throw new Error(errors.join('\n'));
  await Bun.write(`${directory}/report.json`, JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors }, null, 2)}\n`);
} catch (error) {
  await page
    .screenshot({ path: `${directory}/failure.png`, fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
