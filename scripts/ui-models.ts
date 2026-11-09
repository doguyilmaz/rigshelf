import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import type { AiRequest } from '../src/core/ai-drafts';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
const requests: AiRequest[] = [];
const server = startServer(data.store, 48013, {
  aiDriver: async ({ request }) => {
    requests.push(request);
    return {
      summary: 'Fixture model proposal.',
      questions: [],
      draft: {
        kind: 'skill',
        name: 'focused-api-guide',
        description: 'Use for reviewing clear API errors.',
        body: 'Keep API errors actionable and concise.',
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
page.on('dialog', (dialog) => void dialog.accept());
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
let lists = 0;
let mode: 'empty' | 'ready' | 'offline' = 'empty';
await page.route('**/api/ai/ollama-models', async (request) => {
  lists++;
  if (mode === 'offline')
    return request.fulfill({
      status: 400,
      json: { error: 'Could not reach Ollama at 127.0.0.1:11434. Start Ollama and try again.' },
    });
  return request.fulfill({
    json:
      mode === 'empty'
        ? []
        : [
            { name: 'tiny:latest', sizeBytes: 123, isRemote: false },
            { name: 'remote:cloud', sizeBytes: 1, isRemote: true },
          ],
  });
});
const directory = resolve('.local/qa/models');
await mkdir(directory, { recursive: true });
const checks: string[] = [];
async function audit(name: string) {
  await assertNeutralTheme(page, name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page
    .locator('.page-header')
    .getByRole('button', { name: 'Add to library', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add something useful', exact: true });
  const panel = dialog.getByRole('region', { name: 'AI assistance', exact: true });
  await panel.getByLabel('AI Provider', { exact: true }).click();
  await page.getByRole('option', { name: 'Ollama', exact: true }).click();
  expect(lists).toBe(0);
  expect(requests).toHaveLength(0);
  await panel.getByLabel('Model', { exact: true }).click();
  await expect(
    page.getByText('No models found. Add a model in Ollama, then retry.', { exact: true }).first(),
  ).toBeVisible();
  expect(lists).toBe(1);
  expect(requests).toHaveLength(0);
  await page.keyboard.press('Escape');
  mode = 'ready';
  await panel.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await panel.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'remote:cloud', exact: true }).click();
  await expect(
    panel.getByText(
      'Ollama reports this as a remote model. Its service controls routing and usage.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await panel.getByLabel('Model', { exact: true }).click();
  await page.getByRole('option', { name: 'tiny:latest', exact: true }).click();
  checks.push(
    'Choosing Ollama does not contact its service or run a model. A deliberate list/refresh handles empty services, preserves exact names and exposes reported remote routing before generation.',
  );
  mode = 'offline';
  await panel.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(
    panel.getByText('Could not reach Ollama at 127.0.0.1:11434. Start Ollama and try again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText('tiny:latest');
  await panel.getByRole('button', { name: 'Enter model name', exact: true }).click();
  await panel.getByLabel('Model', { exact: true }).fill('manual:fixture');
  await panel.getByRole('button', { name: 'Choose from installed models', exact: true }).click();
  await expect(panel.getByLabel('Model', { exact: true })).toHaveText('manual:fixture');
  expect(requests).toHaveLength(0);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`picker-${width}`);
  }
  checks.push(
    'An offline refresh keeps the chosen name, reports a recovery action and retains manual entry; both modes fit desktop/mobile with no Axe findings.',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel
    .getByLabel('What should AI prepare?', { exact: true })
    .fill('Prepare concise API error guidance.');
  await panel.getByRole('button', { name: 'Generate with Ollama', exact: true }).click();
  await expect(panel.getByText('Draft preview', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.model).toBe('manual:fixture');
  expect(data.store.entries()).toEqual([]);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
  checks.push(
    'Only explicit Generate invokes the fixture model, using the chosen exact name. Proposal preview still saves no Skill, plan or project permission.',
  );
  expect(errors).toEqual([]);
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify({ checks, errors, modelListRequests: lists }, null, 2),
  );
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
