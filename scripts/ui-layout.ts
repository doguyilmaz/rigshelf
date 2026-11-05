import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { saveSkill } from '../src/core/ingest';
import type { Preset, Rule, Source } from '../src/core/model';
import { scan } from '../src/core/scanner';
import { route } from '../src/core/service';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';
import tr from '../web/locales/tr.json';
import { assertDialogFits, assertPopupFits, assertSurfaceFits } from './layout-check';

const data = await fixture();
const longLabel = 'InternationalMobilePlatformReleaseEngineeringAndAccessibilityWorkflows';
const atLimit = (limit: number) =>
  longLabel.repeat(Math.ceil(limit / longLabel.length)).slice(0, limit);
const source: Source = {
  id: 'layout-source',
  name: atLimit(500),
  type: 'github',
  url: 'https://github.com/example-team/mobile-engineering',
  recipe: 'bunx skills add example-team/mobile-engineering',
  notes: 'Fictional collection for interface layout checks.',
  status: 'unchecked',
};
data.store.put('source', source);
const body = `---\nname: ${atLimit(200)}\ndescription: ${JSON.stringify('Use for accessibility and release verification. '.repeat(40))}\n---\n\nKeep literal text such as <b>guidance</b> and preserve supporting resources.`;
const skill = saveSkill(
  data.store,
  body,
  [{ path: 'SKILL.md', content: Buffer.from(body).toString('base64'), executable: false }],
  source,
);
skill.tags = ['expo', atLimit(64)];
data.store.saveEntry(skill);
const simple = sampleSkill(data.store, 'review-guide');
await Bun.write(
  join(data.project, 'package.json'),
  JSON.stringify({ name: 'layout-fixture', dependencies: { expo: '56' } }),
);
await Bun.write(join(data.project, 'AGENTS.md'), 'Preserve this fictional guidance.');
await Bun.write(join(data.project, 'MEMORY.md'), 'Fictional memory for layout checks.');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
const project = data.store.projects()[0]!;
project.name = atLimit(200);
data.store.put('project', project);
const preset = data.store.list<Preset>('preset')[0]!;
preset.name = atLimit(100);
preset.description = 'Focused guidance for international enterprise applications. '.repeat(16);
data.store.put('preset', preset);
const rule = data.store.list<Rule>('rule')[0]!;
rule.name = atLimit(100);
data.store.put('rule', rule);
await route(data.store, 'POST', 'plans', {
  projectPath: data.project,
  providers: ['codex'],
  entryIds: [simple.id],
  includeRules: false,
});
const originalGuidance = await Bun.file(join(data.project, 'AGENTS.md')).text();
const server = startServer(data.store, 47995);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const directory = resolve('.local/qa/layout');
await mkdir(directory, { recursive: true });
const errors: string[] = [];
const checks: string[] = [];
const cases: string[] = [];
const layoutProblems: { label: string; message: string }[] = [];
page.on('pageerror', (error) => errors.push(error.message));
async function checkLayout(label: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    layoutProblems.push({ label, message: error instanceof Error ? error.message : String(error) });
    if (layoutProblems.length <= 8)
      await page.screenshot({
        path: join(directory, `layout-issue-${layoutProblems.length}.png`),
        fullPage: true,
      });
  }
}
const viewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 800 },
  { width: 640, height: 400 },
  { width: 390, height: 700 },
  { width: 320, height: 568 },
  { width: 1024, height: 400 },
];
const names = {
  en: ['Set up a project', 'Library', 'Projects', 'Presets', 'Directives', 'Activity', 'Settings'],
  tr: [
    'Set up a project',
    'Library',
    'Projects',
    'Presets',
    'Directives',
    'Activity',
    'Settings',
  ].map((key) => tr[key as keyof typeof tr]),
};
async function nav(name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function closeDialog() {
  await page
    .locator('dialog[open]:not([data-exiting])')
    .last()
    .getByRole('button', { name: /Close dialog|Pencereyi kapat/, exact: true })
    .click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
try {
  await page.goto(server.accessUrl);
  for (const locale of ['en', 'tr'] as const) {
    if (locale === 'tr') {
      await nav('Settings');
      await page.getByLabel('Interface language', { exact: true }).click();
      await page.getByRole('option', { name: 'Türkçe', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    }
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const name of names[locale]) {
        await nav(name);
        const label = `${locale} ${name} ${viewport.width}×${viewport.height}`;
        await checkLayout(label, () => assertSurfaceFits(page, label));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        if (viewport.width === 1280 || viewport.width === 320) {
          const audit = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(
            audit.violations.map((item) => item.id),
            label,
          ).toEqual([]);
        }
        cases.push(label);
      }
    }
    for (const viewport of [viewports[2]!, viewports[6]!, viewports[7]!, viewports[8]!]) {
      await page.setViewportSize(viewport);
      await nav(names[locale][1]!);
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Add to library' : 'Kütüphaneye ekle',
          exact: true,
        })
        .first()
        .click();
      let dialog = page.locator('dialog[open]').last();
      await expect(dialog.locator('.ai-assist')).toBeVisible();
      await assertDialogFits(page, dialog, `${locale} AI intake ${viewport.width}`);
      for (const key of ['Source', 'Custom skill', 'Local folder', 'MCP server'] as const) {
        const tab = locale === 'en' ? key : tr[key];
        await dialog.getByRole('button', { name: tab, exact: true }).click();
        await assertDialogFits(page, dialog, `${locale} ${tab} ${viewport.width}`);
      }
      await closeDialog();
      await page
        .getByRole('button', {
          name:
            locale === 'en'
              ? `Source details: ${source.name}`
              : `Kaynak ayrıntıları: ${source.name}`,
          exact: true,
        })
        .click();
      dialog = page.getByRole('dialog', { name: source.name, exact: true });
      await assertDialogFits(page, dialog, `${locale} 500-character source ${viewport.width}`);
      await closeDialog();
      await nav(names[locale][3]!);
      await page.locator('.preset-card').filter({ hasText: preset.name }).click();
      dialog = page.getByRole('dialog', { name: preset.name, exact: true });
      await assertDialogFits(page, dialog, `${locale} Preset title ${viewport.width}`);
      await dialog
        .getByLabel(locale === 'en' ? 'Inherit from' : tr['Inherit from'], { exact: true })
        .click();
      await assertPopupFits(page, `${locale} nested searchable popup ${viewport.width}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await closeDialog();
      await nav(names[locale][2]!);
      await page.locator('.project-name').click();
      dialog = page.getByRole('dialog', { name: project.name, exact: true });
      await assertDialogFits(page, dialog, `${locale} project title ${viewport.width}`);
      await closeDialog();
      await nav(names[locale][5]!);
      await page.locator('.activity-plans').getByRole('button').first().click();
      dialog = page.locator('dialog[open]').last();
      await assertDialogFits(page, dialog, `${locale} plan preview ${viewport.width}`);
      await closeDialog();
      cases.push(`${locale} dialogs ${viewport.width}×${viewport.height}`);
    }
  }
  checks.push(
    'Seven populated pages fit nine viewport sizes in English and Turkish, including short windows and narrow layouts equivalent to a zoomed desktop.',
  );
  checks.push(
    'AI intake and all manual tabs, a 500-character source title, Preset/project editors, nested selects and plan previews retain reachable close actions and unclipped bodies.',
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await nav(names.tr[3]!);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const last = page.locator('.preset-card').last();
  await last.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await last.click();
  await assertDialogFits(page, page.locator('dialog[open]'), 'normal motion after page scroll');
  await closeDialog();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
  await expect(last).toBeFocused();
  await nav(names.tr[1]!);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  checks.push(
    'Normal-motion opening/closing restores focus and the prior page scroll; navigation to another section starts at its heading instead of inheriting an unrelated offset.',
  );
  expect(await Bun.file(join(data.project, 'AGENTS.md')).text()).toBe(originalGuidance);
  expect(data.store.installations()).toEqual([]);
  expect(errors).toEqual([]);
  const report = {
    checks,
    cases,
    errors,
    layoutProblems,
    fields: {
      sourceName: 500,
      entryName: 200,
      projectName: 200,
      presetName: 100,
      ruleName: 100,
      tag: 64,
    },
    darkMode: 'Not offered',
    rtl: 'Not offered; authored international text is covered by the stress suite',
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  expect(layoutProblems).toEqual([]);
  process.stdout.write(`${JSON.stringify({ checks, cases: cases.length, errors })}\n`);
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
