import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { defaultLibraryFilters } from '../src/core/library';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import { assertDialogFits, assertSurfaceFits } from './layout-check';

const data = await fixture();
async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value));
}
await json(join(data.project, 'package.json'), {});
const cache = join(data.home, '.claude/plugins/cache/acme/review/1.0.0');
await json(join(cache, '.claude-plugin/plugin.json'), { name: 'review', version: '1.0.0' });
await json(join(data.home, '.claude/plugins/cache/acme/cache-tool/2/.claude-plugin/plugin.json'), {
  name: 'cache-tool',
  version: '2.0.0',
});
await json(join(data.home, '.claude/plugins/marketplaces/acme/tool/.claude-plugin/plugin.json'), {
  name: 'catalog-tool',
});
await json(join(data.home, '.claude/plugins/installed_plugins.json'), {
  version: 2,
  plugins: {
    'review@acme': [
      { scope: 'project', projectPath: data.project, installPath: cache, version: '1.0.0' },
    ],
  },
});
await json(join(data.project, '.claude/settings.local.json'), {
  enabledPlugins: { 'review@acme': false },
});
const scanned = await scan(data.store, {
  roots: [data.project],
  globals: true,
  home: data.home,
  environment: {},
});
data.store.put('scan', {
  id: 'last',
  ...scanned,
  skipped: [
    `${data.home}/.gemini/config/mcp_config.json: Empty MCP configuration; no definitions read and previous observations retained.`,
    `${data.home}/.claude/hooks/token.ts: Non-guidance or private runtime target excluded.`,
    `${data.project}: AI directory discovery limit reached (visited 4096/4096 directories, found 8/256 AI locations); inventory is partial.`,
    `${data.project}/.mcp.json: MCP syntax error at line 3, column 2; previous observations retained.`,
  ],
});
const before = data.store.installations();
const server = startServer(data.store, 47996);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(
  (filters) => {
    localStorage.setItem(
      'agent-setup.library.v1',
      JSON.stringify({ version: 1, filters, saved: [], grouping: 'none' }),
    );
  },
  { ...defaultLibraryFilters(), kind: 'plugin' },
);
const page = await context.newPage();
const directory = resolve('.local/qa/plugins/ui');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
async function evidence(label: string) {
  await page.getByLabel('Plugin evidence', { exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.entry-list-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Open review@acme', exact: true })).toContainText(
    'Installation record',
  );
  await expect(
    page.getByRole('button', { name: 'Open cache-tool@acme', exact: true }),
  ).toContainText('In cache');
  await expect(
    page.getByRole('button', { name: 'Open catalog-tool@acme', exact: true }),
  ).toContainText('Marketplace catalog');
  await evidence('Installation record');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open review@acme', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'review@acme', exact: true });
  await detail.getByRole('button', { name: /^Locations/ }).click();
  await expect(detail).toContainText('Disabled in configuration');
  await expect(detail).toContainText('Installation record');
  await expect(detail).toContainText('In cache');
  await expect(detail).toContainText('local');
  await detail.getByRole('button', { name: 'Content', exact: true }).click();
  await expect(detail).toContainText('Native Plugin reference · JSON');
  await expect(detail).not.toContainText('Native plugin installation recipe');
  await assertDialogFits(page, detail, 'Plugin evidence inspector');
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await evidence('In cache');
  await expect(page.locator('.entry-list-row')).toHaveCount(2);
  await evidence('Marketplace catalog');
  await expect(page.locator('.entry-list-row')).toHaveCount(1);
  await expect(page.locator('.entry-list-row')).not.toContainText('Global installations');
  await evidence('Any Plugin evidence');
  await page.getByRole('button', { name: 'By source', exact: true }).click();
  await expect(page.locator('.library-source-group')).toHaveCount(1);
  await page.locator('.library-source-toggle').click();
  await expect(page.locator('.entry-list-row')).toHaveCount(3);
  checks.push(
    'Native Plugin families combine Snapshot evidence, expose disabled declarations and distinguish install/config/cache/catalog without activating packages.',
  );
  const notes = page.locator('.scan-diagnostics');
  await expect(notes.locator(':scope > summary')).toHaveText('2 scan issues need attention');
  await notes.locator(':scope > summary').click();
  for (const name of [
    'Incomplete discovery',
    'Could not inspect',
    'Empty MCP configurations',
    'Intentional exclusions',
  ])
    await expect(notes.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(notes).toContainText('Line 3, column 2');
  await notes.getByText('Technical details', { exact: true }).first().click();
  await expect(notes).toContainText('visited 4096/4096');
  await expect(notes).not.toContainText('files need attention from the last scan');
  checks.push(
    'Scan notes separate actionable coverage/parse problems from empty configs and intentional exclusions, with readable explanations and optional technical details.',
  );
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await assertSurfaceFits(page, `Plugin library at ${width}`);
    await page.screenshot({ path: join(directory, `plugins-${width}.png`), fullPage: true });
  }
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations.map((item) => item.id)).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await page.getByRole('button', { name: 'Kütüphane', exact: true }).click();
  await expect(notes.locator(':scope > summary')).toHaveText(
    '2 tarama sorunu kontrol gerektiriyor',
  );
  if ((await notes.getAttribute('open')) === null) await notes.locator(':scope > summary').click();
  await expect(
    notes.getByRole('region', { name: 'Boş MCP yapılandırmaları', exact: true }),
  ).toBeVisible();
  await expect(
    notes.getByRole('region', { name: 'Bilinçli dışlamalar', exact: true }),
  ).toBeVisible();
  await assertSurfaceFits(page, 'Turkish scan diagnostics');
  data.store.put('scan', {
    id: 'last',
    ...scanned,
    skipped: [
      `${data.home}/.gemini/config/mcp_config.json: Empty MCP configuration; no definitions read and previous observations retained.`,
    ],
  });
  await page.reload();
  await expect(notes.locator(':scope > summary')).toHaveText('Tarama notları (1)');
  await expect(notes.locator(':scope > summary')).not.toContainText('sorunu');
  expect(data.store.installations()).toEqual(before);
  expect(data.store.planSummaries()).toEqual([]);
  expect(errors).toEqual([]);
  checks.push(
    'Evidence filtering works with source grouping and narrow layouts; inspection leaves native relationships and plans unchanged.',
  );
  await Bun.write(join(directory, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
