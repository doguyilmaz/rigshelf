import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import type { Preset, Rule } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import { assertNeutralTheme } from './theme-check';
import { navigateTo } from './ui-navigation';

const data = await fixture();
for (let index = 0; index < 65; index++)
  sampleSkill(data.store, `fixture-guide-${String(index).padStart(3, '0')}`);
await Bun.write(join(data.project, 'package.json'), '{}');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
const original: Preset = {
  id: 'focused-work',
  name: 'Focused work',
  description: 'Saved original.',
  parentId: 'base',
  stacks: ['web'],
  selectors: ['original-guide'],
  entryIds: [],
  excludedIds: [],
  providers: ['opencode'],
};
data.store.put('preset', original);
data.store.put('preset', {
  ...original,
  id: 'native-work',
  name: 'Native work',
  providers: ['claude'],
});
data.store.put('rule', {
  id: 'focused-note',
  name: 'Focused note',
  scope: 'global',
  content: 'Original note.',
  priority: 40,
  enabled: true,
  provenance: 'Fixture',
});
const server = startServer(data.store, 48015);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa/presets');
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
  await page
    .locator('.setup-known-projects button')
    .filter({ has: page.getByText('project', { exact: true }) })
    .click();
  await page.getByRole('combobox', { name: 'Starting preset', exact: true }).click();
  await page.getByRole('option', { name: 'Focused work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'OpenCode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await page.getByRole('combobox', { name: 'Starting preset', exact: true }).click();
  await page.getByRole('option', { name: 'Native work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'OpenCode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Use Preset Agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Claude Code', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'OpenCode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Update kit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review setup', exact: true })).toBeEnabled();
  checks.push(
    'An explicit Preset supplies Agent defaults until a deliberate choice; changing Presets preserves that choice and offers an explicit way to adopt the new defaults.',
  );

  await navigateTo(page, 'Presets');
  await page.getByRole('textbox', { name: 'Find a preset…', exact: true }).fill('no-fixture-match');
  await expect(
    page.getByRole('heading', { name: 'No matching Presets', exact: true }),
  ).toBeVisible();
  await page.locator('.empty').getByRole('button', { name: 'Clear search', exact: true }).click();
  await page
    .locator('.preset-card')
    .filter({ has: page.getByRole('heading', { name: 'Focused work', exact: true }) })
    .click();
  let dialog = page.getByRole('dialog', { name: 'Focused work', exact: true });
  await dialog.getByLabel('Stack tags', { exact: true }).fill('backend, hono');
  await dialog.getByLabel('Skill name selectors').fill('better-auth\nfocused-guide');
  await dialog
    .locator('summary')
    .filter({ hasText: 'Explicit library picks and exclusions' })
    .click();
  await expect(dialog.locator('.explicit-picks > div')).toHaveCount(60);
  await dialog.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(dialog.locator('.explicit-picks > div')).toHaveCount(65);
  const lastPick = dialog.locator('.explicit-picks > div').last();
  const pinnedName = (await lastPick.locator('span').first().textContent())!
    .split(' · ')[0]!
    .trim();
  const pinnedEntry = data.store.entries().find((entry) => entry.name === pinnedName)!;
  await lastPick.getByRole('checkbox', { name: 'Include', exact: true }).check();
  await dialog
    .getByRole('textbox', { name: 'Find a skill or MCP snapshot…', exact: true })
    .fill('no-fixture-match');
  await expect(
    dialog.getByText('No matching Skills or MCP servers.', { exact: true }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`preset-editor-${width}`);
  }
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const duplicate = data.store
    .list<Preset>('preset')
    .find((item) => item.name === 'Focused work copy')!;
  expect(duplicate.stacks).toEqual(['backend', 'hono']);
  expect(duplicate.selectors).toEqual(['better-auth', 'focused-guide']);
  expect(duplicate.entryIds).toEqual([pinnedEntry.id]);
  expect(data.store.get('preset', original.id)).toEqual(original);
  checks.push(
    'Preset search has recoverable empty results. Explicit pins page beyond 60, survive filtering and duplicate with edited selectors/stack tags while preserving the original.',
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'A new starting point', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Focused work');
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    data.store.list<Preset>('preset').filter((item) => item.name === 'Focused work'),
  ).toHaveLength(2);
  expect(data.store.get('preset', original.id)).toEqual(original);
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'A new starting point', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('東京の制作');
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(data.store.list<Preset>('preset').some((item) => item.name === '東京の制作')).toBe(true);
  checks.push(
    'Names that match an existing ID create distinct Presets; non-Latin display names produce valid editable definitions without overwriting existing records.',
  );

  await navigateTo(page, 'Directives');
  await page.getByRole('button', { name: 'New directive', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Focused note');
  await page.getByLabel('Directive content', { exact: true }).fill('A distinct authored note.');
  await page.getByRole('button', { name: 'Save directive', exact: true }).click();
  await expect(
    page.getByText('Directive saved. Apply a new setup plan to refresh project files.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(data.store.list<Rule>('rule').filter((item) => item.name === 'Focused note')).toHaveLength(
    2,
  );
  expect(data.store.get<Rule>('rule', 'focused-note')?.content).toBe('Original note.');
  await navigateTo(page, 'Presets');
  const originalCard = page
    .locator('.preset-card')
    .filter({ has: page.getByRole('heading', { name: 'Focused work', exact: true }) })
    .filter({ hasText: 'Saved original.' });
  await originalCard.click();
  dialog = page.getByRole('dialog', { name: 'Focused work', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('My unsaved Preset draft.');
  const otherPage = await context.newPage();
  otherPage.on('pageerror', (error) => errors.push(error.message));
  await otherPage.goto(server.accessUrl);
  await navigateTo(otherPage, 'Presets');
  await otherPage
    .locator('.preset-card')
    .filter({ has: otherPage.getByRole('heading', { name: 'Focused work', exact: true }) })
    .filter({ hasText: 'Saved original.' })
    .click();
  const otherPreset = otherPage.getByRole('dialog', { name: 'Focused work', exact: true });
  await otherPreset
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Saved from another window.');
  await otherPreset.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(otherPreset).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(
    dialog
      .locator('.notice')
      .getByText(
        'This Preset changed or was removed. Your edits are still here. Reopen it to compare before saving.',
        { exact: true },
      ),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'My unsaved Preset draft.',
  );
  await expect(dialog.getByRole('button', { name: 'Copy draft', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove preset', exact: true }).click();
  await expect(
    dialog
      .locator('.notice')
      .getByText(
        'This Preset changed or was removed. Your edits are still here. Reopen it to compare before saving.',
        { exact: true },
      ),
  ).toBeVisible();
  expect(data.store.get<Preset>('preset', original.id)?.description).toBe(
    'Saved from another window.',
  );
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    data.store
      .list<Preset>('preset')
      .some((item) => item.description === 'My unsaved Preset draft.' && item.id !== original.id),
  ).toBe(true);
  checks.push(
    'Two windows cannot silently overwrite or delete a changed Preset. The stale draft remains editable/copyable and Duplicate saves it separately.',
  );

  await navigateTo(page, 'Directives');
  await page
    .locator('.directive-group button')
    .filter({ has: page.getByText('Focused note', { exact: true }) })
    .first()
    .click();
  await page.getByLabel('Directive content', { exact: true }).fill('My unsaved Directive draft.');
  await navigateTo(otherPage, 'Directives');
  await otherPage
    .locator('.directive-group button')
    .filter({ has: otherPage.getByText('Focused note', { exact: true }) })
    .first()
    .click();
  await otherPage
    .getByLabel('Directive content', { exact: true })
    .fill('Saved from another window.');
  await otherPage.getByRole('button', { name: 'Save directive', exact: true }).click();
  await expect(
    otherPage.getByText('Directive saved. Apply a new setup plan to refresh project files.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save directive', exact: true }).click();
  const directiveError = page
    .locator('.editor-form .notice')
    .getByText(
      'This Directive changed or was removed. Your edits are still here. Reopen it to compare before saving.',
      { exact: true },
    );
  await expect(directiveError).toBeVisible();
  await expect(page.getByLabel('Directive content', { exact: true })).toHaveValue(
    'My unsaved Directive draft.',
  );
  await expect(page.getByRole('button', { name: 'Copy draft', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove directive', exact: true }).click();
  await expect(directiveError).toBeVisible();
  expect(data.store.get<Rule>('rule', 'focused-note')?.content).toBe('Saved from another window.');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await page.getByRole('button', { name: 'Copy draft', exact: true }).click();
  const manualCopy = page.getByRole('dialog', { name: 'Copy this text', exact: true });
  const copyText = manualCopy.getByRole('textbox', { name: 'Text to copy', exact: true });
  expect(JSON.parse(await copyText.inputValue()).content).toBe('My unsaved Directive draft.');
  await manualCopy.getByRole('button', { name: 'Select text', exact: true }).click();
  expect(
    await copyText.evaluate(
      (input) =>
        (input as HTMLTextAreaElement).selectionEnd - (input as HTMLTextAreaElement).selectionStart,
    ),
  ).toBe((await copyText.inputValue()).length);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`manual-copy-${width}`);
  }
  await manualCopy.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByLabel('Directive content', { exact: true })).toHaveValue(
    'My unsaved Directive draft.',
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await audit(`directive-conflict-${width}`);
  }
  await otherPage.close();
  checks.push(
    'Checked Directive save/delete protects another window’s authored content, keeps the unsaved draft visible and offers a copy before reopening.',
  );
  expect(data.store.planSummaries()).toHaveLength(0);
  expect(data.store.list('approval')).toEqual([]);
  checks.push(
    'A new same-name Directive preserves the earlier authored record; editing defaults creates no project plan, file activation or approval.',
  );
  expect(errors).toEqual([]);
  await Bun.write(join(directory, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ checks, errors })}\n`);
} catch (error) {
  await Bun.write(
    join(directory, 'failure-accessibility.txt'),
    await page.locator('body').ariaSnapshot(),
  ).catch(() => undefined);
  await page
    .screenshot({ path: join(directory, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
