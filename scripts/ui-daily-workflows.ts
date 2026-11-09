import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import type { AiRequest } from '../src/core/ai-drafts';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import { navigateTo } from './ui-navigation';

const data = await fixture();
data.store.put('settings', {
  id: 'main',
  ...data.store.settings(),
  roots: [data.project],
  scanGlobals: false,
});
const requests: AiRequest[] = [];
const server = startServer(data.store, 48019, {
  aiDriver: async ({ request }) => {
    requests.push(request);
    return {
      summary: 'Prepared from the fixture notes.',
      questions: [],
      draft: {
        kind: 'skill',
        name: 'daily-api-review',
        description: 'Use for reviewing concise API errors.',
        body: 'Keep errors actionable. Preserve private diagnostics.',
        tags: ['backend'],
      },
    };
  },
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await context.tracing.start({ screenshots: true, snapshots: true });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/daily-workflows');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
// Deterministic installed-capability fixture: no native CLI or model service is invoked.
await page.route('**/api/ai/providers', (route) =>
  route.fulfill({
    json: [
      { id: 'claude', name: 'Claude Code', available: true },
      { id: 'codex', name: 'Codex', available: true },
      { id: 'ollama', name: 'Ollama', available: true },
      { id: 'session', name: 'Current agent · MCP', available: true },
      { id: 'compatible', name: 'API connection', available: false },
    ],
  }),
);
await page.route('**/api/ai-config-roots', (route) =>
  route.fulfill({
    json: {
      roots: [
        { path: join(data.home, '.aims/profiles/claude/work'), provider: 'claude', origin: 'aims' },
      ],
      warnings: [],
    },
  }),
);
async function audit(name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
async function addDialog() {
  await page
    .locator('.page-header')
    .getByRole('button', { name: 'Add to library', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  await expect(dialog.getByLabel('AI Provider', { exact: true })).toBeVisible();
  return dialog;
}
try {
  await page.goto(server.accessUrl);
  await navigateTo(page, 'Library');
  let dialog = await addDialog();
  const panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText('Haiku · quick drafts');
  await panel.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'Sonnet · more involved drafts', exact: true }).click();
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText(
    'Sonnet · more involved drafts',
  );
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText('GPT-6 Luna · quick drafts');
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Claude Code', exact: true }).click();
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText(
    'Sonnet · more involved drafts',
  );
  expect(requests).toHaveLength(0);
  checks.push(
    'Available native Providers default to Haiku/Luna, retain separate model choices and run nothing while switching.',
  );
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('bunx skills add example/skills --skill api-review');
  await panel.getByRole('button', { name: 'Preview source without AI', exact: true }).click();
  const sourcePreview = dialog.getByRole('region', { name: 'Source preview', exact: true });
  await expect(sourcePreview).toContainText('https://github.com/example/skills');
  await expect(
    dialog.getByLabel('URL, repository, or installation command', { exact: true }),
  ).toHaveValue('bunx skills add example/skills --skill api-review');
  expect(requests).toHaveLength(0);
  expect(data.store.entries()).toEqual([]);
  await dialog
    .getByLabel('URL, repository, or installation command', { exact: true })
    .fill('https://example.com/reference');
  await expect(sourcePreview).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Preview source', exact: true }).click();
  await expect(sourcePreview).toContainText('website content is not fetched by AI');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`source-preview-${width}`);
  }
  checks.push(
    'A focused source command reaches a deterministic preview without generation or saves; changing input invalidates the preview, and website import limits remain visible.',
  );
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  dialog = await addDialog();
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Current Agent · MCP drafts', exact: true }).click();
  await panel.locator('summary').filter({ hasText: 'Connect Claude' }).click();
  await panel.getByLabel('Connection harness', { exact: true }).click();
  await page.getByRole('option', { name: 'Kiro CLI', exact: true }).click();
  await panel.getByRole('button', { name: 'Prepare read-only connection', exact: true }).click();
  await expect(panel.locator('.ai-session-connection pre')).toContainText('rigshelf');
  expect(await panel.locator('.ai-session-connection pre').textContent()).not.toContain('--write');
  expect(requests).toHaveLength(0);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`connected-agent-${width}`);
  }
  checks.push(
    'Connected Kiro setup produces native MCP configuration without write tools, account access, model invocation or installation; model selection remains explicitly owned by the Agent.',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('A reusable API review procedure with concise errors.');
  await panel.getByRole('button', { name: 'Generate with Codex', exact: true }).click();
  await expect(panel.getByText('Draft preview', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.model).toBe('gpt-6-luna');
  expect(data.store.entries()).toEqual([]);
  await panel.getByRole('button', { name: 'Use draft', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('daily-api-review');
  expect(data.store.entries()).toEqual([]);
  await dialog.getByRole('button', { name: 'Add to library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(data.store.entries().map((entry) => entry.name)).toEqual(['daily-api-review']);
  expect(data.store.planSummaries()).toEqual([]);
  checks.push(
    'Generate sends the exact lightweight model to the fixture driver; Preview and Use draft save nothing, and explicit Add saves one Skill without project writes.',
  );
  await navigateTo(page, 'Settings');
  await page.getByLabel('Review provider', { exact: true }).click();
  await page.getByRole('option', { name: 'claude · direct drafts', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveText('Haiku · quick drafts');
  await page.getByLabel('Review provider', { exact: true }).click();
  await page.getByRole('option', { name: 'codex · direct drafts', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveText('GPT-6 Luna · quick drafts');
  await page.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'Provider default', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveText('Provider default');
  await page.locator('.ai-config-roots > summary').click();
  const custom = join(data.home, '.other-manager/claude-profile');
  await mkdir(custom, { recursive: true });
  await page.getByLabel('AI configuration folder', { exact: true }).fill(custom);
  await page.getByRole('button', { name: 'Include this folder', exact: true }).click();
  await expect(page.locator('.ai-config-roots').getByTitle(custom, { exact: true })).toBeVisible();
  expect(data.store.settings().aiConfigRoots).toEqual([]);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect
    .poll(() => data.store.settings().aiConfigRoots)
    .toEqual([{ path: custom, provider: 'claude' }]);
  expect(data.store.settings().aiModel).toBe('');
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(server.accessUrl);
  await navigateTo(freshPage, 'Library');
  await freshPage
    .locator('.page-header')
    .getByRole('button', { name: 'Add to library', exact: true })
    .click();
  await expect(freshPage.getByRole('dialog').getByLabel('Model', { exact: true })).toHaveText(
    'Provider default',
  );
  await fresh.close();
  expect(await Bun.file(join(custom, 'settings.json')).exists()).toBe(false);
  await page
    .getByRole('button', { name: 'Show detected configuration folders', exact: true })
    .click();
  await expect(page.locator('.ai-config-roots')).toContainText('Aims');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(`custom-folders-${width}`);
  }
  await page.getByLabel('Interface language', { exact: true }).click();
  await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
  await expect(page.locator('.ai-config-roots > summary')).toHaveText(
    'Profiller ve özel AI klasörleri',
  );
  await audit('custom-folders-tr');
  checks.push(
    'Explicit custom root edits require Save preferences, never create native files, retain origin labels and fit desktop/mobile in English and Turkish.',
  );
  expect(errors).toEqual([]);
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        execution: 'ordinary isolated UI tests with a fixture AI driver; no live vendor generation',
      },
      null,
      2,
    ),
  );
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
} catch (error) {
  await context.tracing.stop({ path: join(directory, 'failure-trace.zip') });
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify({ checks, errors, failure: String(error).slice(0, 2000) }, null, 2),
  );
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
