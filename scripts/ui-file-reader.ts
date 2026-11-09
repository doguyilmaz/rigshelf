import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, type Locator } from '@playwright/test';
import { saveSkill } from '../src/core/ingest';
import type { DocumentLocation, Source } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';
import tr from '../web/locales/tr.json';

const data = await fixture();
const directory = resolve('.local/qa/file-reader');
await mkdir(directory, { recursive: true });
const longText = Array.from(
  { length: 900 },
  (_, index) => `Line ${index}: keep project guidance readable and preserve original files.`,
).join('\n');
await Bun.write(join(data.project, 'package.json'), '{}');
await Bun.write(join(data.project, 'AGENTS.md'), `# Project instructions\n${longText}`);
await Bun.write(join(data.project, 'MEMORY.md'), `# Project memory\n${longText}`);
for (let offset = 0; offset < 520; offset += 20)
  await Promise.all(
    Array.from({ length: Math.min(20, 520 - offset) }, (_, index) => {
      const number = offset + index;
      return Bun.write(
        join(data.project, `.claude/commands/guide-${String(number).padStart(3, '0')}.md`),
        `Guide ${number}\n${number === 519 ? longText : 'An isolated, read-only inventory fixture.'}`,
      );
    }),
  );
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
const project = data.store.projects()[0]!;
const rootInfo = await stat(data.home);
await Bun.write(join(data.home, 'global-guidance.md'), 'Global instructions stay read-only.');
const globalFile: DocumentLocation = {
  id: 'reader-global',
  path: 'global-guidance.md',
  sourcePath: join(data.home, 'global-guidance.md'),
  canonicalPath: join(data.home, 'global-guidance.md'),
  root: data.home,
  rootIdentity: `${rootInfo.dev}:${rootInfo.ino}`,
  relativePath: 'global-guidance.md',
  provider: 'claude',
  scope: 'global',
  kind: 'instruction',
  readOnly: true,
};
data.store.put('global-ai-inventory', {
  id: 'main',
  warnings: [],
  plugins: [],
  files: [globalFile],
});
const source: Source = {
  id: 'reader-source',
  name: 'Reader fixtures',
  url: 'https://github.com/example/reader-fixtures',
  type: 'github',
  recipe: '',
  status: 'unchecked',
  notes: '',
};
data.store.put('source', source);
const skillBody =
  '---\nname: reader-reference\ndescription: An isolated file browsing fixture.\n---\nRead relevant supporting files.';
const skill = saveSkill(
  data.store,
  skillBody,
  [
    { path: 'SKILL.md', content: Buffer.from(skillBody).toString('base64'), executable: false },
    ...Array.from({ length: 520 }, (_, index) => ({
      path: `references/guide-${String(index).padStart(3, '0')}.md`,
      content: Buffer.from(
        index === 519 ? `Reference 519\n${longText}` : `Reference ${index}`,
      ).toString('base64'),
      executable: false,
    })),
  ],
  source,
);
const server = startServer(data.store, 48024);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const errors: string[] = [];
const checks: string[] = [];
let reads = 0;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname === '/api/document') reads++;
});
async function scrollTop(locator: Locator) {
  return locator.evaluate((element) => element.scrollTop);
}
async function assertFrame(dialog: Locator) {
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(
    false,
  );
  expect(
    await dialog
      .locator('.modal-body')
      .evaluate((element) => element.scrollHeight > element.clientHeight + 1),
  ).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
}
async function audit(dialog: Locator, name: string) {
  await assertFrame(dialog);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
try {
  await page.goto(server.accessUrl);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const inspect = page.getByRole('button', { name: 'Inspect project', exact: true });
  await inspect.click();
  let dialog = page.getByRole('dialog', { name: 'project', exact: true });
  await expect
    .poll(() => dialog.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none');
  const frame = await dialog.boundingBox();
  const list = dialog.locator('.project-file-list');
  await expect(
    dialog.getByRole('heading', { name: 'Choose a file to read', exact: true }),
  ).toBeVisible();
  expect(reads).toBe(0);
  expect(await dialog.locator('.document-buttons button').count()).toBeLessThan(100);
  await expect(dialog.getByText(/Showing .* of 522 files/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Show more files', exact: true }).click();
  expect(await dialog.locator('.document-buttons button').count()).toBe(81);
  await dialog.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  const reading = dialog.locator('.file-reader-scroll');
  await expect(dialog.locator('.document-preview')).toContainText('# Project instructions');
  const workspace = dialog.locator('.file-workspace');
  expect(await workspace.locator('aside').boundingBox()).not.toBeNull();
  const sidebarBox = (await workspace.locator('aside').boundingBox())!;
  const readerBox = (await workspace
    .getByRole('region', { name: 'File reader', exact: true })
    .boundingBox())!;
  expect(readerBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
  await reading.evaluate((element) => {
    element.scrollTop = 800;
  });
  const readingPosition = await scrollTop(reading);
  await list.evaluate((element) => {
    element.scrollTop = 900;
  });
  expect(await scrollTop(reading)).toBe(readingPosition);
  const search = dialog.getByLabel('Search AI files', { exact: true });
  await search.fill('guide-519');
  await expect(
    dialog.getByRole('button', { name: '.claude/commands/guide-519.md', exact: true }),
  ).toBeVisible();
  expect(await scrollTop(reading)).toBe(readingPosition);
  await dialog.getByRole('button', { name: '.claude/commands/guide-519.md', exact: true }).click();
  await expect(dialog.locator('.document-preview')).toContainText('Guide 519');
  expect(await scrollTop(reading)).toBe(0);
  const after = await dialog.boundingBox();
  expect(Math.abs(after!.y - frame!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - frame!.height)).toBeLessThanOrEqual(1);
  await reading.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scrollTop(reading)).toBeGreaterThan(100);
  await audit(dialog, 'project-desktop');
  checks.push(
    'A 522-file inventory is bounded and searchable; list scrolling/filtering cannot move the reader or dialog, and keyboard scrolling targets the selected content.',
  );

  await search.fill('');
  const agents = project.documentLocations?.find((file) => file.path === 'AGENTS.md');
  let entered = () => {};
  const delayed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = () => {};
  const delivered = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let pending = true;
  await page.route('**/api/document', async (route) => {
    const payload = route.request().postDataJSON();
    if (pending && (payload.path === 'AGENTS.md' || payload.documentId === agents?.id)) {
      pending = false;
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
      finished();
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  await delayed;
  await dialog.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
  await expect(dialog.locator('.document-preview')).toContainText('# Project memory');
  release();
  await delivered;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(dialog.locator('.document-preview')).toContainText('# Project memory');
  await page.unroute('**/api/document');
  checks.push(
    'A slow previous file response cannot replace the newer selection; file bodies load only on explicit selection.',
  );

  let fail = true;
  await page.route('**/api/document', async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture file unavailable. Try again.' }),
      });
    } else await route.continue();
  });
  await search.fill('guide-518');
  await dialog.getByRole('button', { name: '.claude/commands/guide-518.md', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Fixture file unavailable');
  await expect(dialog.locator('.document-preview')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.locator('.document-preview')).toContainText('Guide 518');
  await page.unroute('**/api/document');
  await search.fill('');
  await dialog.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit document', exact: true }).click();
  await dialog
    .getByLabel('Document content', { exact: true })
    .fill('An unsaved, explicitly protected draft.');
  await dialog.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(dialog.getByLabel('Document content', { exact: true })).toHaveValue(
    'An unsaved, explicitly protected draft.',
  );
  await dialog.getByRole('button', { name: 'Project setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(dialog.getByLabel('Document content', { exact: true })).toHaveValue(
    'An unsaved, explicitly protected draft.',
  );
  await dialog.getByRole('button', { name: 'MEMORY.md', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog.locator('.document-preview')).toContainText('# Project memory');
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(
    `# Project instructions\n${longText}`,
  );
  expect(data.store.planSummaries()).toHaveLength(0);
  checks.push(
    'Read errors have an inline retry; switching files or closing while editing protects drafts, including when the setup section is open.',
  );

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog.locator('.file-workspace-sidebar')).not.toBeVisible();
    await reading.evaluate((element) => {
      element.scrollTop = 700;
    });
    const position = await scrollTop(reading);
    await dialog.getByRole('button', { name: 'Back to files', exact: true }).click();
    await expect(list).toBeVisible();
    const selected = dialog.getByRole('button', { name: 'MEMORY.md', exact: true });
    await expect(selected).toBeFocused();
    const listPosition = await scrollTop(list);
    await dialog.getByRole('button', { name: 'Return to reading', exact: true }).click();
    await expect(dialog.locator('.file-reader-heading')).toBeFocused();
    expect(await scrollTop(reading)).toBe(position);
    await audit(dialog, `project-reading-${width}`);
    await dialog.getByRole('button', { name: 'Back to files', exact: true }).click();
    expect(await scrollTop(list)).toBe(listPosition);
    await audit(dialog, `project-files-${width}`);
    await selected.click();
    expect(await scrollTop(reading)).toBe(position);
  }
  await page.setViewportSize({ width: 390, height: 520 });
  expect((await reading.boundingBox())!.height).toBeGreaterThan(100);
  await audit(dialog, 'project-short-window');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(inspect).toBeFocused();
  checks.push(
    'Mobile list/reader navigation preserves both scroll positions and returns keyboard focus; desktop, 768/390/320px widths and a short window remain usable.',
  );

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByLabel('Search library', { exact: true }).fill('reader-reference');
  await page.getByRole('button', { name: 'Open reader-reference', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'reader-reference', exact: true });
  await dialog.getByRole('button', { name: /^Files/ }).click();
  await expect(dialog.locator('.file-list button[aria-pressed]')).toHaveCount(40);
  expect(
    (await dialog.locator('.file-workspace-sidebar > .search-box').boundingBox())!.height,
  ).toBeLessThanOrEqual(52);
  await dialog.getByLabel('Search supporting files', { exact: true }).fill('guide-519');
  await dialog.getByRole('button', { name: 'references/guide-519.md', exact: true }).click();
  await expect(dialog.locator('.content-preview')).toContainText('Reference 519');
  let arrived = () => {};
  const snapshotDelayed = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let sendSnapshot = () => {};
  const snapshotGate = new Promise<void>((resolve) => {
    sendSnapshot = resolve;
  });
  let deliveredSnapshot = () => {};
  const snapshotDelivered = new Promise<void>((resolve) => {
    deliveredSnapshot = resolve;
  });
  let firstSnapshot = true;
  await page.route(`**/api/entries/${skill.id}/files/*`, async (route) => {
    if (firstSnapshot) {
      firstSnapshot = false;
      const response = await route.fetch();
      arrived();
      await snapshotGate;
      await route.fulfill({ response }).catch(() => undefined);
      deliveredSnapshot();
    } else await route.continue();
  });
  await dialog.getByLabel('Search supporting files', { exact: true }).fill('guide-518');
  await dialog.getByRole('button', { name: 'references/guide-518.md', exact: true }).click();
  await snapshotDelayed;
  await expect(dialog.locator('.file-reader-heading')).toHaveText('references/guide-518.md');
  await expect(dialog.locator('.content-preview')).toHaveCount(0);
  await dialog.getByLabel('Search supporting files', { exact: true }).fill('guide-517');
  await dialog.getByRole('button', { name: 'references/guide-517.md', exact: true }).click();
  await expect(dialog.locator('.content-preview')).toHaveText('Reference 517');
  sendSnapshot();
  await snapshotDelivered;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(dialog.locator('.content-preview')).toHaveText('Reference 517');
  await page.unroute(`**/api/entries/${skill.id}/files/*`);
  await dialog.getByLabel('Search supporting files', { exact: true }).fill('guide-519');
  await dialog.getByRole('button', { name: 'references/guide-519.md', exact: true }).click();
  await expect(dialog.locator('.content-preview')).toContainText('Reference 519');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(dialog, `snapshot-reading-${width}`);
  }
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(data.store.entry(skill.id)?.body).toBe(skillBody);
  expect(data.store.files(skill.id)).toHaveLength(521);
  checks.push(
    'Skill supporting files use the same reader, bounded search and mobile navigation; inspection leaves immutable bytes and project state untouched.',
  );
  const turkish = await browser.newContext({
    viewport: { width: 390, height: 900 },
    reducedMotion: 'reduce',
  });
  await turkish.addInitScript(() => localStorage.setItem('agent-setup.language', 'tr'));
  const localized = await turkish.newPage();
  localized.on('pageerror', (failure) => errors.push(failure.message));
  try {
    await localized.goto(server.accessUrl);
    await localized.getByRole('button', { name: tr.Projects, exact: true }).click();
    await localized
      .getByRole('button', {
        name: tr['Inspect {{name}}'].replace('{{name}}', 'project'),
        exact: true,
      })
      .click();
    const translated = localized.getByRole('dialog', { name: 'project', exact: true });
    await translated.getByLabel(tr['Search AI files'], { exact: true }).fill('global-guidance');
    await translated.getByRole('button', { name: 'global-guidance.md', exact: true }).click();
    await expect(translated.locator('.document-preview')).toContainText(
      'Global instructions stay read-only.',
    );
    await expect(
      translated.getByRole('button', { name: tr['Edit document'], exact: true }),
    ).toBeDisabled();
    for (const width of [390, 320]) {
      await localized.setViewportSize({ width, height: 900 });
      expect(
        await translated.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
      ).toBe(false);
      expect(
        await translated.locator('.file-reader-scroll').evaluate((element) => element.clientHeight),
      ).toBeGreaterThan(250);
      const result = await new AxeBuilder({ page: localized })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(result.violations.map((item) => item.id)).toEqual([]);
      await localized.screenshot({
        path: join(directory, `turkish-reading-${width}.png`),
        fullPage: true,
      });
    }
    await translated.getByRole('button', { name: tr['Back to files'], exact: true }).click();
    await expect(translated.getByLabel(tr['Search AI files'], { exact: true })).toHaveValue(
      'global-guidance',
    );
    await localized.setViewportSize({ width: 1440, height: 900 });
    await translated.getByLabel(tr['Search AI files'], { exact: true }).fill('');
    await localized.setViewportSize({ width: 390, height: 900 });
    await translated.getByRole('button', { name: tr['Return to reading'], exact: true }).click();
    await translated.getByRole('button', { name: tr['Back to files'], exact: true }).click();
    await expect(
      translated.getByRole('button', { name: 'global-guidance.md', exact: true }),
    ).toBeVisible();
    await expect(
      translated.getByRole('button', { name: 'global-guidance.md', exact: true }),
    ).toBeFocused();
  } finally {
    await turkish.close();
  }
  checks.push(
    'Turkish file reading and mobile navigation fit 390/320px layouts; external guidance remains read-only and search state survives returning to the list.',
  );
  expect(errors).toEqual([]);
  await Bun.write(join(directory, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
} catch (error) {
  await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await context.close();
  await browser.close();
  server.stop(true);
  await data.cleanup();
}
