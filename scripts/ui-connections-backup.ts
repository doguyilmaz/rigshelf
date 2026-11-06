import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { exportArchive } from '../src/core/archive';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
data.store.put('settings', { id: 'main', ...data.store.settings(), roots: [], scanGlobals: false });
for (let index = 0; index < 65; index++)
  sampleSkill(data.store, `focused-guide-${String(index).padStart(3, '0')}`);
const baseline = exportArchive(data.store).bytes;
const calls: string[] = [];
const server = startServer(data.store, 48019, {
  aiDriver: async ({ connection }) => {
    calls.push(connection?.id || 'missing');
    return {
      summary: 'A focused API draft.',
      questions: [],
      draft: {
        kind: 'skill',
        name: 'api-errors',
        description: 'Use for concise API errors.',
        body: 'Explain how to recover from failed requests.',
        tags: ['backend'],
      },
    };
  },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const directory = resolve('.local/qa/connections-backup');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
async function settled(): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const animations = document.getAnimations();
        Promise.all(
          animations
            .filter(
              (animation) =>
                animation.effect instanceof KeyframeEffect &&
                animation.effect.target instanceof HTMLDialogElement,
            )
            .map((animation) => animation.finished.catch(() => {})),
        ).then(() => resolve());
      }),
  );
}
async function audit(name: string): Promise<void> {
  if (name.startsWith('profiles-')) await page.locator('.ai-connections').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`) });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'All items', exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const row = page.locator('.entry-list-row').nth(12);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const before = await page.evaluate(() => ({
      scrollY,
      rows: [...document.querySelectorAll('.entry-list-row')].map((node) => node.textContent),
    }));
    await row.click();
    const dialog = page.locator('dialog.modal');
    await expect(dialog).toBeVisible();
    await settled();
    const frame = await dialog.boundingBox();
    await dialog.getByRole('button', { name: /^Files/ }).click();
    await expect(dialog.locator('.file-list')).toBeVisible();
    const after = await dialog.boundingBox();
    expect(Math.abs(frame!.y - after!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame!.height - after!.height)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => scrollY), `Modal open scroll at ${width}px`).toBe(
      before.scrollY,
    );
    await audit(`modal-${width}`);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => scrollY), `Modal close scroll at ${width}px`).toBe(
      before.scrollY,
    );
    await expect(row).toBeFocused();
    await page.getByRole('button', { name: 'Refresh workbench', exact: true }).click();
    await expect(page.locator('.entry-list-row')).toHaveCount(before.rows.length);
    expect(await page.locator('.entry-list-row').allTextContents()).toEqual(before.rows);
  }
  checks.push(
    'Normal-motion editors retain frame, page scroll, focus and row order across close/reopen, tab changes and refresh at four widths.',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add API connection', exact: true }).click();
  await page.getByLabel('Connection name', { exact: true }).fill('My local API');
  await page.getByLabel('Default model', { exact: true }).fill('local-model');
  await page.getByLabel('API base URL', { exact: true }).fill('http://127.0.0.1:1234/v1');
  await page.getByLabel('Review provider', { exact: true }).click();
  await page.getByRole('option', { name: 'API connection', exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`profiles-${width}`);
  }
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Workbench preferences saved', { exact: true })).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Review backup', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review backup', exact: true });
  await expect(review).toBeVisible();
  await review.getByLabel('Compare with a previous export', { exact: true }).setInputFiles({
    name: 'previous.json.gz',
    mimeType: 'application/gzip',
    buffer: Buffer.from(baseline),
  });
  await expect(review.getByRole('status')).toContainText('0 added · 0 changed · 0 removed');
  sampleSkill(data.store, 'new-guide');
  await review.getByRole('button', { name: 'Download reviewed archive', exact: true }).click();
  await expect(
    page.getByText(
      'The library changed after backup review. Review the changes again before downloading.',
      { exact: true },
    ),
  ).toBeVisible();
  await review.getByLabel('Compare with a previous export', { exact: true }).setInputFiles({
    name: 'previous.json.gz',
    mimeType: 'application/gzip',
    buffer: Buffer.from(baseline),
  });
  await expect(review.getByRole('status')).toContainText('1 added');
  await audit('reviewed-backup-320');
  const downloaded = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download reviewed archive', exact: true }).click();
  const download = await downloaded;
  await download.saveAs(join(directory, 'reviewed-library.json.gz'));
  await review.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(review).toHaveCount(0);
  checks.push(
    'Backup baseline comparison makes no imports, rejects stale download review and downloads one complete archive after a fresh review.',
  );
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  const panel = add.locator('.ai-assist');
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'API connection', exact: true }).click();
  await expect(panel.getByLabel('API connection', { exact: true })).toHaveText('My local API');
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('Prepare a concise API error guide.');
  await panel.getByRole('button', { name: 'Generate with API connection', exact: true }).click();
  await expect(panel.getByText('Draft preview', { exact: true })).toBeVisible();
  expect(calls).toEqual([data.store.settings().aiConnections[0]!.id]);
  expect(data.store.entries().some((item) => item.name === 'api-errors')).toBe(false);
  expect(data.store.planSummaries()).toEqual([]);
  await audit('api-draft-320');
  checks.push(
    'Saved API profiles are selectable in AI assistance, and only explicit generation invokes the selected fixture Provider without saving or applying its draft.',
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
