import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { defaultLibraryFilters } from '../src/core/library';
import type { Source } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { reviseSkill } from '../src/core/skill-revisions';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertDialogFits, assertSurfaceFits } from './layout-check';

const data = await fixture();
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"expo":"56"}}');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
const source: Source = {
  id: 'fixture-collection',
  name: 'acme/mobile-guides',
  url: 'https://github.com/acme/mobile-guides',
  type: 'github',
  recipe: '',
  notes: 'Fictional UI collection.',
  status: 'unchecked',
};
data.store.put('source', source);
const originals = [];
for (let index = 0; index < 47; index++) {
  const entry = sampleSkill(data.store, `expo-release-${String(index).padStart(2, '0')}`);
  entry.custom = false;
  entry.sourceId = source.id;
  entry.tags = ['expo'];
  data.store.saveEntry(entry);
  originals.push(entry);
}
const original = originals[46]!;
const revision = reviseSkill(data.store, original.id, {
  body: 'A newer snapshot, still in the same collection.',
});
revision.custom = false;
revision.sourceId = source.id;
data.store.saveEntry(revision);
sampleSkill(data.store, 'my-custom-guide');
for (let index = 0; index < 14; index++) {
  const extra = {
    ...source,
    id: `collection-${index}`,
    name: `z-team/collection-${String(index).padStart(2, '0')}`,
  };
  data.store.put('source', extra);
  const entry = sampleSkill(data.store, `other-guide-${index}`);
  entry.custom = false;
  entry.sourceId = extra.id;
  data.store.saveEntry(entry);
}
const beforeEntries = data.store.entries(true).length;
const server = startServer(data.store, 47994);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
await context.addInitScript((filters) => {
  if (!localStorage.getItem('agent-setup.library.v1'))
    localStorage.setItem(
      'agent-setup.library.v1',
      JSON.stringify({ version: 1, filters, saved: [] }),
    );
}, defaultLibraryFilters());
const page = await context.newPage();
const directory = resolve('.local/qa/source-groups');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const collection = page.getByRole('region', { name: `Items from ${source.name}`, exact: true });
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'By source', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.library-source-group')).toHaveCount(12);
  await expect(collection.locator('.library-source-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(collection.locator('.source-group-count')).toHaveText('47 items');
  await expect(collection.locator('.entry-list-row')).toHaveCount(0);
  await collection.locator('.library-source-toggle').click();
  await expect(collection.locator('.entry-list-row')).toHaveCount(40);
  await collection
    .getByRole('button', { name: `Next items in ${source.name}`, exact: true })
    .click();
  await expect(collection.locator('.entry-list-row')).toHaveCount(7);
  await expect(
    collection.getByRole('button', { name: `Open ${original.name}`, exact: true }),
  ).toBeVisible();
  checks.push(
    'A legacy preference defaults to source groups; 47 Skills and two revisions appear as one collapsed collection, with every item available through nested pagination.',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.library-source-group')).toHaveCount(4);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByLabel('Search library', { exact: true }).fill(original.name);
  await expect(collection.locator('.library-source-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(collection.locator('.entry-list-row')).toHaveCount(1);
  await expect(collection.locator('.source-group-count')).toHaveText('1 of 47 items');
  await collection.getByRole('button', { name: `Open ${original.name}`, exact: true }).click();
  let detail = page.getByRole('dialog', { name: original.name, exact: true });
  await expect(detail.getByLabel('Snapshot version', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Search library', { exact: true }).fill('my-custom-guide');
  await expect(
    page.getByRole('region', { name: 'Items from Custom skills', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search library', { exact: true }).fill('missing-guide');
  await expect(page.locator('.library-source-group')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'No items match these filters', exact: true }),
  ).toBeVisible();
  checks.push(
    'Search finds items beyond the initial child page, expands matching parents, retains Snapshot history and separates custom content; empty results keep no empty groups.',
  );
  await page.getByLabel('Search library', { exact: true }).fill(original.name);
  await page.getByRole('button', { name: 'All items', exact: true }).click();
  await expect(page.locator('.library-source-group')).toHaveCount(0);
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'All items', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Search library', { exact: true })).toHaveValue(original.name);
  await page.getByRole('button', { name: 'By source', exact: true }).click();
  await page.getByRole('button', { name: `Source details: ${source.name}`, exact: true }).click();
  detail = page.getByRole('dialog', { name: source.name, exact: true });
  await expect(detail.getByRole('button', { name: 'Edit source', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await collection.getByRole('button', { name: `Open ${original.name}`, exact: true }).click();
  detail = page.getByRole('dialog', { name: original.name, exact: true });
  await detail.getByLabel('Source relationship', { exact: true }).click();
  await page.getByLabel('Search source relationship', { exact: true }).fill('Custom skills');
  await page.getByRole('option', { name: 'Custom skills', exact: true }).click();
  await detail.getByRole('button', { name: 'Save relationships', exact: true }).click();
  await expect.poll(() => data.store.entry(revision.id)?.sourceId).toBe('custom');
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Items from Custom skills', exact: true }),
  ).toBeVisible();
  expect(data.store.entry(revision.id)?.digest).toBe(revision.digest);
  expect(data.store.entry(original.id)?.body).toBe(original.body);
  checks.push(
    'Flat/grouped preferences survive reload, source details remain reachable and manual relationship changes regroup the item without altering its content or older Snapshot.',
  );
  await page.getByLabel('Search library', { exact: true }).fill('');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await assertSurfaceFits(page, `source groups at ${width}`);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations.map((item) => item.id)).toEqual([]);
    await page.screenshot({ path: join(directory, `groups-${width}.png`), fullPage: true });
    if (width <= 1050)
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Set up a project', exact: true }).click();
  await page.locator('.setup-known-projects button').click();
  await page.locator('.detection-result strong').waitFor();
  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add from library', exact: true });
  await expect(picker.getByRole('button', { name: 'By source', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByLabel('Search kit library', { exact: true }).fill('expo-release-45');
  await expect(picker.locator('.kit-entry')).toHaveCount(1);
  await picker.locator('.capability-row').click();
  const chosen = await picker.locator('.capability-row').getAttribute('aria-pressed');
  await expect(picker.locator('.source-group-count')).toContainText(
    chosen === 'true' ? '1 selected' : '1 of',
  );
  await picker.getByRole('button', { name: 'Inspect expo-release-45', exact: true }).click();
  detail = page.getByRole('dialog', { name: 'expo-release-45', exact: true });
  await assertDialogFits(page, detail, 'nested grouped item');
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  expect(data.store.entries(true)).toHaveLength(beforeEntries);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.installations()).toEqual([]);
  checks.push(
    'The project picker uses the same grouping, searches hidden children, shows selected counts and returns from nested inspection without planning or activating content.',
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
