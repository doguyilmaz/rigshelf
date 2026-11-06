import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { seed } from '../src/core/seeds';
import { Store } from '../src/core/store';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { shortPath } from '../web/api';

const data = await fixture();
const catalog = new Store(join(data.root, 'kitfold'));
seed(catalog);
catalog.put('settings', { id: 'main', ...catalog.settings(), roots: [], scanGlobals: false });
const skill = sampleSkill(catalog, 'retained-branding-guide');
const files = catalog.files(skill.id);
const server = startServer(catalog, 48020);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const directory = resolve('.local/qa/branding');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const english =
  'This folder keeps the earlier Kitfold name so your existing library and recovery history stay available. Rigshelf has not moved or duplicated your data.';
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library storage', exact: true })).toBeVisible();
  await expect(page.getByText(english, { exact: true })).toBeVisible();
  await expect(page.getByText(shortPath(catalog.directory), { exact: true })).toBeVisible();
  await page.getByLabel('Connection harness', { exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare connection', exact: true }).click();
  const connection = page.locator('.settings-aside pre');
  await expect(connection).toContainText('[mcp_servers.rigshelf]');
  await expect(connection).toContainText('command = "rigshelf"');
  await expect(connection).not.toContainText('kitfold');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.storage-compatibility-note').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations.map((item) => item.id)).toEqual([]);
    await page.screenshot({ path: join(directory, `storage-${width}.png`) });
  }
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Kütüphane depolaması', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.storage-compatibility-note')).toContainText('Kitfold');
  await expect(page.locator('.storage-compatibility-note')).toContainText('Rigshelf');
  expect(catalog.entry(skill.id)).toEqual(skill);
  expect(catalog.files(skill.id)).toEqual(files);
  expect(errors).toEqual([]);
  const report = {
    checks: [
      'Existing Kitfold storage remains visible at its actual path with an explicit English/Turkish compatibility explanation.',
      'New connection snippets use Rigshelf in native Codex configuration; existing content and resources remain unchanged.',
      'Storage explanation and connection preview fit three desktop/mobile widths without page errors or automated accessibility violations.',
    ],
    errors,
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  catalog.close();
  await data.cleanup();
}
