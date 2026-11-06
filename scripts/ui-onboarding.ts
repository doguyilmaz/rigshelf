import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type APIResponse, chromium, expect } from '@playwright/test';
import type { DocumentLocation } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
const second = join(data.root, 'project-two');
await mkdir(join(data.project, '.claude'), { recursive: true });
await mkdir(second);
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"expo":"56"}}');
await Bun.write(join(second, 'package.json'), '{"dependencies":{"next":"16"}}');
await Bun.write(
  join(data.project, '.claude/settings.local.json'),
  '{"env":{"API_TOKEN":"dummy-only-private-token"}}',
);
sampleSkill(data.store, 'expo-guide');
sampleSkill(data.store, 'next-guide');
await scan(data.store, { roots: [data.project, second], globals: false, home: data.home });
await scan(data.store, { roots: [data.project, second], globals: false, home: data.home });
const rootInfo = await stat(data.home);
data.store.put('global-ai-inventory', {
  id: 'main',
  warnings: [],
  plugins: [],
  files: Array.from({ length: 600 }, (_, index): DocumentLocation => {
    const path = `global-config-${index}.json`;
    return {
      id: `fixture-ai-file-${index}`,
      path,
      sourcePath: join(data.home, path),
      canonicalPath: join(data.home, path),
      root: data.home,
      rootIdentity: `${rootInfo.dev}:${rootInfo.ino}`,
      relativePath: path,
      provider: 'claude',
      scope: 'global',
      kind: 'config',
      readOnly: true,
    };
  }),
});
const directory = resolve('.local/qa/onboarding');
await mkdir(directory, { recursive: true });
const server = startServer(data.store, 47988);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
const requests: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
});
async function audit(name: string) {
  await assertNeutralTheme(page, name);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await expect(
    page.getByText('The right Skills, MCP and guidance. Ready for the agents you use.'),
  ).toBeVisible();
  await page.getByLabel('Project directory', { exact: true }).fill(data.project);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Build my kit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toHaveCount(0);
  checks.push(
    'Selecting a project has its own honest inspection state; setup review requires current detection.',
  );

  await page.getByRole('button', { name: 'Getting started', exact: true }).click();
  await page.getByRole('button', { name: 'Practice with an example', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Getting started', exact: true });
  await dialog.waitFor();
  const requestCount = requests.length;
  const projectCount = data.store.projects().length;
  const planCount = data.store.planSummaries().length;
  await dialog.getByLabel('Include example MCP server', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Review example plan', exact: true }).click();
  await expect(dialog.getByText('.mcp.json', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Simulate Apply', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Example applied.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Simulate rollback', exact: true }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Example rollback complete.' }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(
      false,
    );
  }
  await audit('example-mobile');
  expect(requests.length).toBe(requestCount);
  expect(data.store.projects()).toHaveLength(projectCount);
  expect(data.store.planSummaries()).toHaveLength(planCount);
  checks.push(
    'Example review, Apply and rollback make zero API requests and leave real projects and plans unchanged.',
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  await dialog.getByRole('button', { name: 'Workflow guide', exact: true }).click();
  await dialog.getByRole('button', { name: 'Choose a focused project kit', exact: false }).click();
  await expect(dialog.getByRole('heading', { name: 'Choose a focused project kit' })).toBeVisible();
  await audit('guide-desktop');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByLabel('Project directory', { exact: true })).toHaveValue(data.project);
  await page.reload();
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await expect(page.getByRole('complementary', { name: 'First steps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Getting started', exact: true })).toBeVisible();
  checks.push(
    'The guide preserves the real setup draft, remembers dismissal and remains available from Getting started.',
  );

  let received: (value: APIResponse) => void = () => undefined;
  const delayed = new Promise<APIResponse>((resolve) => {
    received = resolve;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/detect', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    received(response);
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByLabel('Project directory', { exact: true }).fill(data.project);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Build my kit', exact: true }).click();
  await delayed;
  await page.getByLabel('Project directory', { exact: true }).fill(second);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Build my kit', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('project-two');
  release();
  await expect(page.locator('.detection-result strong')).toHaveText('project-two');
  await page.getByLabel('What are you making?', { exact: false }).fill('Updated requirements');
  await expect(
    page.getByText('Setup details changed. Update the kit before reviewing setup.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeDisabled();
  checks.push(
    'A delayed previous-project response cannot overwrite a newly selected project; changed requirements invalidate review.',
  );

  await page.reload();
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect project', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'project', exact: true });
  const globalGroup = dialog
    .locator('.project-document-group')
    .filter({ has: page.locator('summary').filter({ hasText: 'Global AI files' }) });
  await globalGroup.locator('summary').click();
  const firstCount = await globalGroup.locator('.document-buttons button').count();
  expect(firstCount).toBeLessThan(100);
  await expect(globalGroup.getByText(/Showing .* of 600 files/)).toBeVisible();
  await globalGroup.getByRole('button', { name: 'Show more files', exact: true }).click();
  expect(await globalGroup.locator('.document-buttons button').count()).toBeGreaterThan(firstCount);
  const fileSearch = dialog.getByPlaceholder('Search AI files by name, path or provider…');
  await fileSearch.fill('global-config-599');
  await expect(
    globalGroup.getByRole('button', { name: 'global-config-599.json', exact: true }),
  ).toBeVisible();
  await fileSearch.fill('');
  checks.push(
    'A 600-file AI index renders a bounded page, shows the full count and finds files beyond that page through search.',
  );
  await dialog.getByLabel('AI file type', { exact: true }).click();
  await page.getByRole('option', { name: /^Config/ }).click();
  await dialog.getByRole('button', { name: '.claude/settings.local.json', exact: true }).click();
  await expect(dialog.locator('.document-preview')).not.toContainText('dummy-only-private-token');
  await expect(dialog.getByRole('button', { name: 'Edit document', exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Create a reusable directive', exact: true }),
  ).toHaveCount(0);
  await audit('native-config');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  checks.push(
    'Native config files can be filtered, opened on demand and masked; project editing and directive promotion stay unavailable.',
  );

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Show inventory checkpoints', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /^Download inventory checkpoint/ })
    .first()
    .click();
  const download = await downloadEvent;
  const path = join(directory, 'inventory-checkpoint.json');
  await download.saveAs(path);
  expect((await Bun.file(path).json()).inventory.projects).toHaveLength(2);
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await page.getByRole('button', { name: 'Başlangıç rehberi', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Başlangıç rehberi', exact: true });
  await expect(
    dialog.getByRole('heading', { name: 'Mevcut araçlarını keşfet', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Örnekle dene', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Örnek Expo uygulaması', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('turkish-example');
  checks.push(
    'Inventory checkpoints download through the authenticated UI and the walkthrough works in English/Turkish at mobile widths.',
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
