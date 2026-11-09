import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { githubBackupTransport } from '../src/core/backup-github';
import { s3BackupTransport } from '../src/core/backup-s3';
import { startServer } from '../src/server';
import { MemoryGithub } from '../tests/fixtures/backup-github';
import { MemoryS3 } from '../tests/fixtures/backup-s3';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
data.store.put('settings', { id: 'main', ...data.store.settings(), roots: [], scanGlobals: false });
const skill = sampleSkill(data.store, 'restore-this-guide');
const remoteS3 = new MemoryS3();
const remoteGithub = new MemoryGithub();
const credentials = {
  RIGSHELF_BACKUP_GITHUB_TOKEN: 'fixture-token',
  RIGSHELF_BACKUP_S3_ACCESS_KEY_ID: 'fixture-key',
  RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
};
const previous = new Map(Object.keys(credentials).map((key) => [key, process.env[key]]));
Object.assign(process.env, credentials);
const server = startServer(data.store, 48023, {
  backupTransport: (destination) =>
    destination.kind === 'github'
      ? githubBackupTransport(destination, credentials, remoteGithub.fetch)
      : s3BackupTransport(destination, credentials, remoteS3.fetch),
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/remote-backups');
await mkdir(directory, { recursive: true });
async function audit(name: string) {
  await page
    .locator('dialog[open]')
    .evaluateAll((elements) =>
      Promise.all(
        elements
          .flatMap((element) => element.getAnimations())
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  if (result.violations.length)
    await Bun.write(
      join(directory, 'accessibility-failure.json'),
      JSON.stringify(result.violations, null, 2),
    );
  expect(result.violations.map((value) => value.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`) });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Manage backups', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backups', exact: true })).toBeVisible();
  expect(remoteS3.requests).toEqual([]);
  expect(remoteGithub.requests).toEqual([]);
  await page.getByRole('button', { name: 'Add destination', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Add backup destination', exact: true });
  await editor.getByLabel('Connection name', { exact: true }).fill('My R2 backup');
  await editor.getByLabel('Backup destination', { exact: true }).click();
  await page.getByRole('option', { name: 'S3 / Cloudflare R2 / MinIO', exact: true }).click();
  await editor.getByLabel('S3 endpoint', { exact: true }).fill('http://127.0.0.1:49000');
  await editor.getByLabel('Bucket', { exact: true }).fill('test-private');
  await editor.getByRole('checkbox').check();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`connection-${width}`);
  }
  await editor.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(remoteS3.requests).toEqual([]);
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(
    page.getByText('Connection test passed. No library archive was sent.', { exact: true }),
  ).toBeVisible();
  expect(remoteS3.objects.size).toBe(0);
  await page.getByRole('button', { name: 'Review changes before Sync', exact: true }).click();
  let review = page.getByRole('dialog', { name: 'Review Sync', exact: true });
  await expect(review).toBeVisible();
  expect(remoteS3.objects.size).toBe(0);
  await review.getByLabel('Search backup changes', { exact: true }).fill('restore-this-guide');
  await expect(review.locator('.backup-change')).toHaveCount(1);
  await review.evaluate((element) =>
    Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const frame = await review.boundingBox();
  await review.getByRole('button', { name: 'Inspect restore-this-guide', exact: true }).click();
  await expect(review.getByLabel('Content after', { exact: true })).toContainText(
    'Use clear inputs',
  );
  const after = await review.boundingBox();
  expect(Math.abs(frame!.height - after!.height)).toBeLessThanOrEqual(1);
  await audit('comparison-320');
  await review.getByRole('button', { name: 'Back to changes', exact: true }).click();
  await review.getByRole('button', { name: 'Sync reviewed Snapshot', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Backup verified', exact: true })).toBeVisible({
    timeout: 10000,
  });
  data.store.deleteEntry(skill.id);
  await page.getByRole('button', { name: 'Backup history', exact: true }).click();
  await page.getByRole('button', { name: 'Review restore', exact: true }).click();
  review = page.getByRole('dialog', { name: 'Review restore', exact: true });
  await expect(review.getByRole('status')).toContainText('1 added');
  expect(data.store.entry(skill.id)).toBeUndefined();
  await review.getByRole('button', { name: 'Restore reviewed records', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(data.store.entry(skill.id)).toBeDefined();
  expect(data.store.list('approval')).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Add destination', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Add backup destination', exact: true });
  await editor.getByLabel('Connection name', { exact: true }).fill('My GitHub backup');
  await editor
    .getByLabel('Private GitHub repository', { exact: true })
    .fill('https://github.com/example/private-library');
  await editor.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'My GitHub backup GitHub', exact: true }).click();
  expect(remoteGithub.requests).toEqual([]);
  await page.getByRole('button', { name: 'Review changes before Sync', exact: true }).click();
  review = page.getByRole('dialog', { name: 'Review Sync', exact: true });
  await review.getByRole('button', { name: 'Sync reviewed Snapshot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for PR merge', exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(remoteGithub.pulls[0]?.merged).toBe(false);
  await audit('github-pending-1440');
  await page.getByRole('button', { name: 'Review merge', exact: true }).click();
  const merge = page.getByRole('dialog', { name: 'Review PR merge', exact: true });
  await merge.getByRole('button', { name: 'Merge reviewed PR', exact: true }).click();
  await expect(merge).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Backup verified', exact: true })).toBeVisible();
  expect(remoteGithub.pulls[0]?.merged).toBe(true);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`backups-${width}`);
  }
  await page.evaluate(() => localStorage.setItem('rigshelf:language', 'tr'));
  await page.goto(`${new URL(server.accessUrl).origin}/#backups`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Yedekler', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My R2 backup Cloudflare R2', exact: true }).click();
  await page.getByRole('button', { name: 'Bağlantıyı düzenle', exact: true }).click();
  const turkishEditor = page.getByRole('dialog', {
    name: 'Yedekleme hedefini düzenle',
    exact: true,
  });
  await audit('connection-tr-320');
  await turkishEditor.getByLabel('Bağlantı adı', { exact: true }).fill('Unsaved connection name');
  await turkishEditor.getByRole('button', { name: 'İptal', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Taslağınız korunsun mu?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Düzenlemeye devam et', exact: true }).click();
  await expect(discard).toHaveCount(0);
  await expect(turkishEditor.getByLabel('Bağlantı adı', { exact: true })).toHaveValue(
    'Unsaved connection name',
  );
  await turkishEditor.getByRole('button', { name: 'İptal', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Taslağınız korunsun mu?', exact: true })
    .getByRole('button', { name: 'Değişiklikleri at', exact: true })
    .click();
  await expect(turkishEditor).toHaveCount(0);
  expect(errors).toEqual([]);
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        checks: [
          'Saving destinations sends no requests',
          'S3 conditional probe sends no archive',
          'Review is read-only, searchable and stable when inspecting',
          'Explicit S3 Sync verifies publication',
          'Default restore adds missing records without project authority',
          'GitHub one PR waits for explicit reviewed merge',
          'Four responsive widths and axe accessibility',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  process.stdout.write('Remote backup UI flows passed.\n');
} catch (error) {
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
