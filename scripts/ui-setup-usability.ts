import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import type { Rule } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import { reviseSkill } from '../src/core/skill-revisions';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';

const data = await fixture();
await Bun.write(join(data.project, 'package.json'), '{"dependencies":{"expo":"56"}}');
const originalGuidance = '# Team guidance\n\nKeep this exact content.\n';
await Bun.write(join(data.project, 'AGENTS.md'), originalGuidance);
const second = join(data.root, 'another-project');
await mkdir(second);
await Bun.write(
  join(second, 'package.json'),
  '{"name":"another-project","dependencies":{"next":"16"}}',
);
sampleSkill(data.store, 'react-native-best-practices');
sampleSkill(data.store, 'building-native-ui');
for (let index = 0; index < 85; index++)
  sampleSkill(data.store, `library-note-${String(index).padStart(3, '0')}`);
const manual = sampleSkill(data.store, 'zebra-android-review');
manual.tags = ['android', 'kotlin'];
data.store.saveEntry(manual);
await route(data.store, 'POST', 'mcp', {
  name: 'android-device-tools',
  tags: ['android'],
  mcp: { transport: 'stdio', command: 'fictional-device-mcp' },
});
await scan(data.store, { roots: [data.project, second], globals: false, home: data.home });
const originalFiles = await readdir(data.project);
const directory = resolve('.local/qa/setup-usability');
await mkdir(directory, { recursive: true });
const server = startServer(data.store, 47989);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
const checks: string[] = [];
const planRequests: Record<string, unknown>[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname === '/api/plans' && request.method() === 'POST')
    planRequests.push(request.postDataJSON());
});
async function audit(name: string) {
  await assertNeutralTheme(page, name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((item) => item.id)).toEqual([]);
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
const kit = page.locator('.setup-kit-section');
try {
  await page.goto(server.accessUrl);
  await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
  await expect(page.getByLabel('Starting preset', { exact: true })).toHaveCount(0);
  await expect(page.locator('.agent-choice')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toHaveCount(0);
  await audit('first-screen');
  await page
    .locator('.setup-known-projects button')
    .filter({ has: page.getByText('project', { exact: true }) })
    .click();
  await expect(page.locator('.detection-result strong')).toHaveText('project');
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  expect(planRequests).toHaveLength(0);
  expect(await readdir(data.project)).toEqual(originalFiles);
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(originalGuidance);
  expect(data.store.list('approval')).toHaveLength(0);
  checks.push(
    'The first screen asks only for a folder; one known-project click inspects without plans, source writes or approval.',
  );

  const removed = kit.locator('.kit-entry').filter({
    has: page.getByRole('button', { name: 'Inspect react-native-best-practices', exact: true }),
  });
  await removed.locator('.capability-row').click();
  await page.getByText('Agents', { exact: true }).click();
  await page.getByRole('button', { name: 'Kiro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kiro', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Requirements & preset', { exact: true }).click();
  await page.getByLabel('What are you making?', { exact: false }).fill('A focused Expo companion');
  await page.getByLabel('Starting preset', { exact: true }).click();
  await page.getByLabel('Search starting preset', { exact: true }).fill('Expo');
  await page.getByRole('option', { name: 'Expo + React Native', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kiro', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Update kit', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  await expect(
    kit.locator('.kit-entry.selected').filter({ hasText: 'react-native-best-practices' }),
  ).toHaveCount(0);
  checks.push('Preset refresh preserves deliberately removed recommendations and selected Agents.');

  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add from library', exact: true });
  await picker.getByRole('button', { name: 'All items', exact: true }).click();
  await expect(picker.locator('.kit-entry')).toHaveCount(40);
  await picker.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(picker.locator('.kit-entry')).toHaveCount(80);
  await picker.getByLabel('Type', { exact: true }).click();
  await page.getByRole('option', { name: 'MCP', exact: true }).click();
  await expect(picker.locator('.kit-entry')).toHaveCount(1);
  await expect(picker.locator('.kit-entry')).toContainText('android-device-tools');
  await picker.getByLabel('Type', { exact: true }).click();
  await page.getByRole('option', { name: 'Skills', exact: true }).click();
  await picker.getByLabel('Platform', { exact: true }).click();
  await page.getByRole('option', { name: 'Android', exact: true }).click();
  await picker.getByLabel('Technology', { exact: true }).click();
  await page.getByLabel('Search technology', { exact: true }).fill('Kotlin');
  await page.getByRole('option', { name: 'Kotlin', exact: true }).click();
  await expect(picker.locator('.kit-entry')).toHaveCount(1);
  await picker.locator('.capability-row').click();
  await picker.getByRole('button', { name: 'Inspect zebra-android-review', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'zebra-android-review', exact: true });
  await detail.waitFor();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(picker).toBeVisible();
  await audit('filtered-picker');
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    kit.locator('.kit-entry.selected').filter({ hasText: 'zebra-android-review' }),
  ).toHaveCount(1);
  checks.push(
    'The kit picker pages beyond 40 items, separates Skills/MCP, filters platform/technology and returns from nested inspection.',
  );

  // Refresh the private fixture catalog as a new source revision would; keep the user pin.
  const latest = reviseSkill(data.store, manual.id, { body: 'A newer fixture snapshot.' });
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh workbench', exact: true }).click();
  await page.getByRole('button', { name: 'Set up a project', exact: true }).click();
  await expect(page.getByLabel('Project directory', { exact: true })).toHaveValue(data.project);
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  await expect(
    kit.locator('.kit-entry.selected').filter({ hasText: 'zebra-android-review' }),
  ).toHaveCount(1);
  await page.getByText('Agents', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kiro', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Requirements & preset', { exact: true }).click();
  await expect(page.getByLabel('What are you making?', { exact: false })).toHaveValue(
    'A focused Expo companion',
  );
  await expect(page.getByLabel('Starting preset', { exact: true })).toHaveText(
    'Expo + React Native',
  );
  await page
    .getByLabel('What are you making?', { exact: false })
    .fill('Expo with Kotlin and zebra-android-review');
  await page.getByRole('button', { name: 'Update kit', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your setup', exact: true });
  await review.waitFor();
  expect(planRequests.at(-1)?.entryIds).toContain(manual.id);
  expect(planRequests.at(-1)?.entryIds).not.toContain(latest.id);
  expect(planRequests.at(-1)?.providers).toContain('kiro');
  await review.getByRole('button', { name: 'Close dialog', exact: true }).click();
  checks.push(
    'Navigating Library/Settings retains path, requirements, preset, Agents and the exact manually selected snapshot after catalog refresh.',
  );

  let releasePlan: () => void = () => undefined;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  let planFetched = false;
  let planReleased = false;
  await page.route('**/api/plans', async (request) => {
    const response = await request.fetch();
    planFetched = true;
    await planGate;
    await request.fulfill({ response });
    planReleased = true;
  });
  await page.getByRole('button', { name: 'Review setup', exact: true }).click();
  await expect.poll(() => planFetched).toBe(true);
  await page
    .getByLabel('What are you making?', { exact: false })
    .fill('Expo with Kotlin and zebra-android-review, updated');
  releasePlan();
  await expect.poll(() => planReleased).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Review your setup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeDisabled();
  await page.unroute('**/api/plans');
  await page.getByRole('button', { name: 'Update kit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  const rule = data.store.list<Rule>('rule')[0]!;
  data.store.put('rule', { ...rule, content: `${rule.content}\nA changed fixture directive.` });
  await page.getByRole('button', { name: 'Refresh workbench', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Update kit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  checks.push(
    'Late plan responses cannot open after a draft change; changed shared directives require renewed inspection.',
  );

  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  await picker.getByLabel('Search kit library', { exact: true }).fill('library-note-084');
  await picker.locator('.capability-row').click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  const unavailable = data.store.entries().find((entry) => entry.name === 'library-note-084')!;
  data.store.deleteEntry(unavailable.id);
  await page.getByRole('button', { name: 'Refresh workbench', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove unavailable selections', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove unavailable selections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  checks.push(
    'A removed Library snapshot is reported and blocks review until the user removes that selection.',
  );

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 920 });
    await audit(`draft-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByLabel('Project directory', { exact: true }).fill(second);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Build my kit', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Keep your draft?', exact: true });
  await discard.waitFor();
  await discard.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.getByLabel('Project directory', { exact: true })).toHaveValue(data.project);
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  await expect(
    kit.locator('.kit-entry.selected').filter({ hasText: 'zebra-android-review' }),
  ).toHaveCount(1);
  expect(await readdir(data.project)).toEqual(originalFiles);
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(originalGuidance);
  checks.push(
    'Replacing an edited project asks before discarding; cancel retains the prior kit, and review still writes no source files.',
  );
  const projectField = page.getByLabel('Project directory', { exact: true });
  await projectField.fill('another-project');
  await page.getByRole('option').filter({ hasText: 'another-project' }).waitFor();
  await projectField.press('ArrowDown');
  await projectField.press('Enter');
  await discard.waitFor();
  await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.detection-result strong')).toHaveText('another-project');
  await expect(projectField).toHaveValue(second);
  expect(await readdir(second)).toEqual(['package.json']);
  checks.push(
    'Keyboard-confirmed autocomplete inspects the selected known project after an explicit draft replacement.',
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
