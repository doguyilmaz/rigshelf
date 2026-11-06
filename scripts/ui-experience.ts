import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { route } from '../src/core/service';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"expo":"56"}}');
const authored = '# Project notes\n\nPreserve this authored guidance.\n';
await Bun.write(join(data.project, 'AGENTS.md'), authored);
const source = (await route(data.store, 'POST', 'sources', {
  input: 'example/experience-expo-skills',
  research: false,
})) as { id: string };
const ref = 'a'.repeat(40);
const originalFetch = globalThis.fetch;
const remotePaths = Array.from(
  { length: 45 },
  (_, index) => `skills/expo-guide-${String(index).padStart(2, '0')}/SKILL.md`,
);
let downloads = 0;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com' && url.pathname.endsWith('/commits/HEAD'))
      return Response.json({ sha: ref });
    if (url.hostname === 'api.github.com' && url.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: [
          ...remotePaths.map((path) => ({ path, type: 'blob', mode: '100644', size: 200 })),
          {
            path: 'skills/expo-guide-44/references/layout.md',
            type: 'blob',
            mode: '100644',
            size: 30,
          },
        ],
      });
    if (
      url.hostname === 'api.github.com' &&
      url.pathname === '/repos/example/experience-expo-skills'
    )
      return Response.json({
        owner: { login: 'example' },
        license: { spdx_id: 'MIT' },
        archived: false,
        description: 'Fixture collection.',
      });
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/SKILL.md')) {
      downloads++;
      const name = url.pathname.split('/').at(-2);
      return new Response(
        `---\nname: ${name}\ndescription: Use when reviewing an Expo layout.\n---\n\nKeep layouts clear.\n`,
      );
    }
    if (
      url.hostname === 'raw.githubusercontent.com' &&
      url.pathname.endsWith('/references/layout.md')
    ) {
      downloads++;
      return new Response('Keep layouts clear and responsive.\n');
    }
    throw new Error(`Unexpected fixture network request to ${url.hostname}`);
  },
  { preconnect: originalFetch.preconnect },
);
const server = startServer(data.store, 48011);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('dialog', (dialog) => void dialog.accept());
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks: string[] = [];
const directory = resolve('.local/qa/experience');
await mkdir(directory, { recursive: true });
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
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await expect(
    page.getByRole('button', { name: 'Try with a safe example', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Project directory', { exact: true }).fill(data.project);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Build my kit', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  await expect(page.getByText('No Skills selected yet.', { exact: true })).toBeVisible();
  await page
    .locator('.workspace-kit-kind')
    .filter({ has: page.getByText('Skills', { exact: true }) })
    .getByRole('button', { name: 'Choose from Library', exact: true })
    .click();
  let picker = page.getByRole('dialog', { name: 'Add from library', exact: true });
  await expect(picker.getByLabel('Type', { exact: true })).toHaveText('Skills');
  await picker.getByRole('button', { name: 'Find more tools', exact: true }).click();
  const acquire = page.getByRole('dialog', { name: 'Find tools for this project', exact: true });
  await acquire.getByLabel('Search saved sources', { exact: true }).fill('example/experience');
  await acquire.locator('.acquire-source-list button').click();
  const detail = page.getByRole('dialog', { name: 'example/experience-expo-skills', exact: true });
  await detail.getByRole('button', { name: 'Find skills in source', exact: true }).click();
  await expect(
    detail.getByRole('button', { name: 'Import & add to kit', exact: true }),
  ).toHaveCount(40);
  await detail.getByRole('button', { name: 'Show more Skills', exact: true }).click();
  await expect(
    detail.getByRole('button', { name: 'Import & add to kit', exact: true }),
  ).toHaveCount(45);
  await detail.getByPlaceholder('Search 45 discovered skills…').fill('expo-guide-44');
  await detail.getByRole('button', { name: 'Import & add to kit', exact: true }).click();
  picker = page.getByRole('dialog', { name: 'Add from library', exact: true });
  await expect(picker.locator('.kit-entry.selected')).toHaveCount(1);
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  const imported = data.store.entries().find((entry) => entry.name === 'expo-guide-44')!;
  expect(data.store.files(imported.id).map((file) => file.path)).toEqual([
    'SKILL.md',
    'references/layout.md',
  ]);
  expect(imported.upstreamRef).toBe(ref);
  expect(downloads).toBe(2);
  expect(data.store.planSummaries()).toHaveLength(0);
  expect(data.store.list('approval')).toHaveLength(0);
  expect(await Bun.file(join(data.project, '.agents/skills/expo-guide-44/SKILL.md')).exists()).toBe(
    false,
  );
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(authored);
  checks.push(
    'An empty Library leads to a stack-related source, all 45 Skills are reachable, and importing returns the exact pinned snapshot to the same kit without project writes or approval.',
  );
  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add from library', exact: true })
    .getByRole('button', { name: 'Find more tools', exact: true })
    .click();
  await page.getByLabel('Search saved sources', { exact: true }).fill('example/experience');
  await page.locator('.acquire-source-list button').click();
  const pendingDetail = page.getByRole('dialog', {
    name: 'example/experience-expo-skills',
    exact: true,
  });
  await pendingDetail.getByPlaceholder('Search 45 discovered skills…').fill('expo-guide-43');
  let releaseImport: () => void = () => undefined;
  let importedResponse: () => void = () => undefined;
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  const importReceived = new Promise<void>((resolve) => {
    importedResponse = resolve;
  });
  const importSettled = page.waitForResponse((response) =>
    response.url().endsWith(`/api/sources/${source.id}/import`),
  );
  await page.route(`**/api/sources/${source.id}/import`, async (request) => {
    const response = await request.fetch();
    importedResponse();
    await importGate;
    await request.fulfill({ response }).catch(() => undefined);
  });
  await pendingDetail.getByRole('button', { name: 'Import & add to kit', exact: true }).click();
  await importReceived;
  try {
    await pendingDetail.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Back to kit Library', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add from library', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click();
  } finally {
    releaseImport();
  }
  await importSettled;
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(1);
  expect(data.store.entries().some((entry) => entry.name === 'expo-guide-43')).toBe(true);
  expect(data.store.planSummaries()).toHaveLength(0);
  checks.push(
    'Leaving an in-flight import keeps the successfully collected snapshot in Library without adopting it into the abandoned project selection.',
  );
  await page.unroute(`**/api/sources/${source.id}/import`);
  await page.getByRole('button', { name: 'Claude Code', exact: true }).click();
  await page
    .getByLabel('What are you making?', { exact: true })
    .fill('An Expo reader with calm, accessible layouts.');
  await page.reload();
  await page.getByRole('button', { name: 'Continue kit', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  await expect(page.getByLabel('What are you making?', { exact: true })).toHaveValue(
    'An Expo reader with calm, accessible layouts.',
  );
  await expect(page.getByRole('button', { name: 'Claude Code', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  expect(data.store.planSummaries()).toHaveLength(0);
  checks.push(
    'Reload offers an explicit tab draft recovery; fresh inspection restores the brief, exact selection and Harnesses without restoring a plan or permission.',
  );
  await audit('workspace-desktop');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 820 });
    await audit(`workspace-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your setup', exact: true });
  let releaseApply: () => void = () => undefined;
  const applyGate = new Promise<void>((resolve) => {
    releaseApply = resolve;
  });
  await page.route('**/api/plans/*/apply', async (request) => {
    await applyGate;
    await request.continue();
  });
  await review.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
  try {
    await expect(review.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
    await expect(review.getByRole('button', { name: 'Back to kit', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(review).toBeVisible();
    expect(
      await Bun.file(join(data.project, '.agents/skills/expo-guide-44/SKILL.md')).exists(),
    ).toBe(false);
  } finally {
    releaseApply();
  }
  checks.push(
    'An in-flight Apply keeps its review context open; closing or Escape cannot detach the result and clear a different project draft.',
  );
  const handoff = page.getByRole('dialog', { name: 'Your project is ready.', exact: true });
  await expect(
    handoff.getByRole('heading', { name: 'The kit is in your project.', exact: true }),
  ).toBeVisible();
  await expect(
    handoff.getByRole('button', { name: 'Copy a starting prompt', exact: true }),
  ).toBeVisible();
  await expect(
    handoff.getByRole('button', { name: 'View history & recovery', exact: true }),
  ).toBeVisible();
  expect(
    await Bun.file(join(data.project, '.agents/skills/expo-guide-44/references/layout.md')).text(),
  ).toBe('Keep layouts clear and responsive.\n');
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toContain(authored);
  expect(data.store.list('approval')).toHaveLength(0);
  await audit('handoff-desktop');
  await page.setViewportSize({ width: 320, height: 720 });
  await audit('handoff-mobile');
  await handoff.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue kit', exact: true })).toHaveCount(0);
  await page.locator('.setup-known-projects button').filter({ hasText: 'project' }).first().click();
  await expect(page.getByRole('button', { name: 'Claude Code', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.workspace-kit .kit-entry.selected')).toHaveCount(1);
  checks.push(
    'Applying provides a concrete Agent handoff and recovery route, preserves authored guidance and supporting files, clears the tab draft and restores private reviewed choices on the next visit.',
  );
  expect(errors).toEqual([]);
  await Bun.write(
    join(directory, 'report.json'),
    JSON.stringify({ checks, errors, sourceId: source.id }, null, 2),
  );
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
} catch (error) {
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
