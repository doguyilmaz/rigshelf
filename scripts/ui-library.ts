import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
const add = (name: string, tags: string[]) => {
  const entry = sampleSkill(data.store, name);
  entry.tags = tags;
  data.store.saveEntry(entry);
  return entry;
};
const expo = add('expo-login-guide', ['expo', 'better-auth']);
add('swiftui-layout-guide', ['ios', 'swiftui', 'design']);
const backend = add('hono-login-guide', ['hono', 'better-auth']);
backend.custom = false;
data.store.saveEntry(backend);
const mcp = add('identity-service', ['hono', 'better-auth']);
mcp.kind = 'mcp';
mcp.custom = false;
mcp.mcp = { transport: 'http', url: 'https://example.com/mcp', args: [], env: {}, headers: {} };
data.store.saveEntry(mcp);
const reference = add('api-reference', ['hono']);
reference.kind = 'resource';
data.store.saveEntry(reference);
const plugin = add('mobile-toolkit', ['expo']);
plugin.kind = 'plugin';
data.store.saveEntry(plugin);
for (let index = 0; index < 514; index++) add(`reference-${index}`, []);
const originalDigest = expo.digest;
const originalBody = expo.body;
const server = startServer(data.store, 47977);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const directory = resolve('.local/qa/library');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks: string[] = [];
async function choose(label: string, option: string) {
  if (!(await page.getByLabel(label, { exact: true }).isVisible()))
    await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'All items', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(40);
  await choose('Platform & area', 'Mobile');
  await expect(page.locator('.entry-list-row')).toHaveCount(2);
  await choose('Technology', 'Expo');
  await choose('Task', 'Authentication');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open expo-login-guide', exact: true }),
  ).toBeVisible();
  checks.push(
    'A 520-item library can be narrowed by platform, technology and task without knowing an item name.',
  );
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name', { exact: true }).fill('Mobile authentication');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('Search library', { exact: true }).fill('not-present');
  await expect(
    page.getByRole('heading', { name: 'No items match these filters', exact: true }),
  ).toBeVisible();
  await choose('Saved views', 'Mobile authentication');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  checks.push(
    'Saved views restore query and combined facets; filters survive navigation and reload.',
  );
  await page.getByRole('button', { name: 'Open expo-login-guide', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'expo-login-guide', exact: true });
  await detail.locator('summary').filter({ hasText: 'Classification' }).click();
  await detail.getByLabel('Classification Platform & area', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('option', { name: 'Backend / API', exact: true }).click();
  await page.keyboard.press('Escape');
  await detail.getByRole('button', { name: 'Save relationships', exact: true }).click();
  await expect.poll(() => data.store.entry(expo.id)?.tags.includes('platform:backend')).toBe(true);
  const basePreset = data.store.get<{ id: string; entryIds: string[] }>('preset', 'base')!;
  data.store.put('preset', { ...basePreset, entryIds: [...basePreset.entryIds, backend.id] });
  const pinnedInBase = () =>
    data.store.get<{ entryIds: string[] }>('preset', 'base')?.entryIds.includes(expo.id);
  await detail.getByRole('button', { name: 'Add to every project', exact: true }).click();
  const fresh = await expect
    .poll(pinnedInBase, { timeout: 2000 })
    .toBe(true)
    .then(() => true)
    .catch(() => false);
  if (!fresh) {
    await expect(page.getByText(/This Preset changed or was removed/)).toBeVisible();
    await detail.getByRole('button', { name: 'Add to every project', exact: true }).click();
  }
  await expect
    .poll(() =>
      data.store.get<{ entryIds: string[] }>('preset', 'base')?.entryIds.includes(expo.id),
    )
    .toBe(true);
  expect(data.store.get<{ entryIds: string[] }>('preset', 'base')?.entryIds).toContain(backend.id);
  checks.push(
    'Adding to every project keeps a base Preset change made elsewhere instead of overwriting it.',
  );
  await detail.getByRole('button', { name: 'Remove from every project', exact: true }).click();
  await expect
    .poll(() =>
      data.store.get<{ entryIds: string[] }>('preset', 'base')?.entryIds.includes(expo.id),
    )
    .toBe(false);
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No items match these filters', exact: true }),
  ).toBeVisible();
  expect(data.store.entry(expo.id)?.digest).toBe(originalDigest);
  expect(data.store.entry(expo.id)?.body).toBe(originalBody);
  checks.push(
    'Manual classification changes the library filters while preserving the immutable content digest and body.',
  );
  await page.getByRole('button', { name: 'Show all items', exact: true }).click();
  await page.getByRole('tab', { name: 'MCP servers', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.getByRole('tab', { name: 'References', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  checks.push(
    'Skills, MCP servers, plugins and references are independent type filters; sources have their own view.',
  );
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  await choose('Origin', 'Imported content');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open hono-login-guide', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width <= 1050) {
      const toggle = page.getByRole('button', { name: /^Filters/ });
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    if (audit.violations.length)
      throw new Error(`${width}px: ${audit.violations.map((value) => value.id).join(', ')}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Library overflows ${width}px`);
    await page.screenshot({ path: `${directory}/library-${width}.png`, fullPage: true });
  }
  checks.push(
    'Expanded library filters and paginated results fit six widths without overflow or Axe findings.',
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await choose('Status', 'Active only');
  for (const metadata of data.store.entries(true)) {
    const entry = data.store.entry(metadata.id)!;
    data.store.saveEntry({ ...entry, archived: true });
  }
  await page.getByRole('button', { name: 'Refresh workbench', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No items match these filters', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show all items', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('All statuses');
  await expect(page.locator('.entry-list-row')).toHaveCount(40);
  expect(data.store.entries(true)).toHaveLength(520);
  expect(data.store.entry(expo.id)?.body).toBe(originalBody);
  checks.push(
    'An archived-only Library is recoverable through Show all items, which restores visibility without deleting or changing Snapshot content.',
  );
  const beforePreferences = await page.evaluate(() =>
    localStorage.getItem('agent-setup.library.v1'),
  );
  const beforeEntries = data.store.entries(true).length;
  const beforeSources = data.store.sources().length;
  const network: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) network.push(request.url());
  });
  await page.goto(`${new URL(server.accessUrl).origin}/prototypes/library.html`);
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await choose('Technology', 'Expo');
  await choose('Task', 'Authentication');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Scan this machine', exact: true }).click();
  await expect(page.locator('.preview-notice')).toContainText('design preview');
  expect(network).toHaveLength(0);
  expect(data.store.entries(true).length).toBe(beforeEntries);
  expect(data.store.sources().length).toBe(beforeSources);
  expect(await page.evaluate(() => localStorage.getItem('agent-setup.library.v1'))).toBe(
    beforePreferences,
  );
  checks.push(
    'The interactive preview uses the real filter UI, isolates browser preferences, and forwards no API requests.',
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
