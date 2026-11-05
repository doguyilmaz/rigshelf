import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { scan } from '../src/core/scanner';
import { startServer } from '../src/server';
import { fixture, sampleSkill } from '../tests/helpers';

const data = await fixture();
await mkdir(join(data.project, '.git'));
await Bun.write(
  join(data.project, 'package.json'),
  JSON.stringify({
    name: 'sample-studio',
    dependencies: { expo: '56.0.0', 'react-native': '0.84.0', 'better-auth': '1.0.0' },
  }),
);
await Bun.write(
  join(data.project, 'AGENTS.md'),
  '# Sample studio\n\nPreserve this team guidance.\n',
);
sampleSkill(data.store, 'react-native-best-practices');
sampleSkill(data.store, 'building-native-ui');
sampleSkill(data.store, 'better-auth');
await scan(data.store, { roots: [data.project], globals: false, home: data.home });
const server = startServer(data.store, 47971);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = resolve('.local/qa');
await mkdir(directory, { recursive: true });
try {
  await page.goto(server.accessUrl);
  await page.getByRole('heading', { name: /Every project/ }).waitFor();
  await page.screenshot({ path: join(directory, 'setup-desktop.png'), fullPage: true });
  await page.getByLabel('Project directory', { exact: true }).fill(data.project);
  await page.getByLabel('Project directory', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Build my kit' }).click();
  await page.getByRole('button', { name: 'Inspect again' }).waitFor();
  await page.getByRole('button', { name: 'Review setup' }).click();
  await page.getByRole('dialog', { name: 'Review your setup' }).waitFor();
  await page.screenshot({ path: join(directory, 'setup-plan.png') });
  await page.getByRole('button', { name: /Apply \d+ changes/ }).click();
  await page.getByRole('heading', { name: 'Your project is ready.' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const agents = await Bun.file(join(data.project, 'AGENTS.md')).text();
  if (!agents.includes('Preserve this team guidance.') || !agents.includes('Active kit'))
    throw new Error('Setup failed to preserve/add guidance.');
  const accessibility: Record<string, unknown> = {};
  for (const [nav, hash] of [
    ['Library', 'library'],
    ['Projects', 'projects'],
    ['Presets', 'presets'],
    ['Directives', 'directives'],
    ['Activity', 'activity'],
    ['Settings', 'settings'],
  ] as const) {
    await page.getByRole('button', { name: nav, exact: true }).first().click();
    await page.waitForURL(`**/#${hash}`);
    await page.screenshot({ path: join(directory, `${hash}-desktop.png`), fullPage: true });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    accessibility[hash] = result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    }));
  }
  await page.getByRole('button', { name: 'Set up a project', exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(directory, 'setup-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('Mobile layout overflows horizontally.');
  await Bun.write(
    join(directory, 'ui-report.json'),
    JSON.stringify({ errors, accessibility, overflow }, null, 2),
  );
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'completed',
        screenshots: directory,
        accessibilityIssues: Object.fromEntries(
          Object.entries(accessibility).map(([key, value]) => [key, (value as unknown[]).length]),
        ),
      },
      null,
      2,
    )}\n`,
  );
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
