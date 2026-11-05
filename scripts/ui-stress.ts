import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { saveSkill } from '../src/core/ingest';
import { now } from '../src/core/safety';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';

const SCENARIOS = [
  'Demo',
  'Worst case',
  'Empty',
  'One',
  '40 rows',
  '41 rows',
  '1,284 rows',
] as const;
type Scenario = (typeof SCENARIOS)[number];
const data = await fixture();
const directory = resolve('.local/qa/stress');
await mkdir(directory, { recursive: true });
const fieldMap = [
  [
    'entry.name',
    'upstream frontmatter / archive',
    '200 characters',
    'long compound; one letter; CJK; emoji',
  ],
  [
    'entry.description',
    'upstream frontmatter / archive',
    '2,000 catalog characters',
    'long prose; literal markup; empty',
  ],
  [
    'entry.tags',
    'archive / relationship editor',
    '100 × 64 characters on import',
    '12 realistic tags; long compound',
  ],
  ['source.name', 'source archive', '500 characters', 'long repository collection name'],
  ['project.name', 'manual classification', '200 characters', 'long client/application name'],
  ['project.stacks', 'manual classification', '50 × 64 characters', 'long stack labels'],
  ['collections', 'private catalog', 'paginated library; project collection', '0; 1; 12; 1,284'],
  ['timestamps', 'source / archive', 'string; optional source date', 'missing; future; valid past'],
];
await Bun.write(join(directory, 'field-map.json'), JSON.stringify(fieldMap, null, 2));

function seedScenario(scenario: Scenario): void {
  const counts: Record<Scenario, number> = {
    Demo: 12,
    'Worst case': 12,
    Empty: 0,
    One: 1,
    '40 rows': 40,
    '41 rows': 41,
    '1,284 rows': 1284,
  };
  const count = counts[scenario];
  const worst = scenario === 'Worst case';
  data.store.db.transaction(() => {
    data.store.db.exec(
      "DELETE FROM files; DELETE FROM entries; DELETE FROM installations; DELETE FROM records WHERE type IN ('project','source');",
    );
    const source = {
      id: 'fixture-source',
      name: worst
        ? 'International Mobile Platform Engineering — Design, Native Modules, Observability and Release Workflows '
            .repeat(5)
            .slice(0, 500)
        : 'Fixture collection',
      url: `https://example.com/collections/${'enterprise-mobile-platform/'.repeat(worst ? 40 : 1)}`,
      type: 'local' as const,
      recipe: '',
      status: 'unchecked' as const,
      notes: 'Fictional UI fixture.',
    };
    if (count) data.store.put('source', source);
    const names = [
      'Q',
      'SwiftUI accessibility and keyboard interaction for international enterprise applications',
      '王秀英 — 移动应用开发规范',
      '👩🏽‍💻 Developer experience and release verification',
      'customer-feedback-from-enterprise-onboarding',
      'Field guide — release review',
    ];
    for (let index = 0; index < count; index++) {
      const name = worst
        ? `${names[index % names.length]}${index ? ` ${index}` : ''}`
        : `Project guide ${index + 1}`;
      const description = worst
        ? 'Review the concrete behavior, preserve the author’s intent, and keep the result useful. '
            .repeat(25)
            .slice(0, 2000)
        : 'Use for focused project work.';
      const body = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\nLiteral preview: <b>text</b> &amp; **Markdown**. Fixture ${index}.`;
      const entry = saveSkill(
        data.store,
        body,
        [{ path: 'SKILL.md', content: Buffer.from(body).toString('base64'), executable: false }],
        source,
      );
      entry.tags = worst
        ? [
            'enterprise-mobile-observability-and-release-engineering',
            'design',
            'frontend',
            'q3',
            'needs-review',
            'accessibility',
            'native',
            'release',
            'quality',
            'keyboard',
            'international',
            'performance',
          ]
        : ['typescript'];
      if (worst && index === 1) entry.updatedAt = '2027-01-01T00:30:00Z';
      if (worst && index === 2) entry.updatedAt = '2020-06-01T23:30:00-08:00';
      data.store.saveEntry(entry);
      const project = {
        id: `fixture-project-${index}`,
        name: worst
          ? `International Client Applications — ${name}`.slice(0, 200)
          : `Project ${index + 1}`,
        path: join(data.root, `fictional-project-${index}`),
        stacks: worst
          ? ['enterprise-mobile-observability-and-release-engineering', 'expo', 'typescript']
          : ['typescript'],
        dependencies: [],
        providers: [],
        documents: [],
        detectedAt: now(),
        requirements: '',
      };
      data.store.put('project', project);
      data.store.installation({
        entryId: entry.id,
        projectId: project.id,
        provider: 'codex',
        path: join(project.path, '.agents/skills/guide'),
        scope: 'project',
        lastSeen: now(),
      });
    }
  })();
}

seedScenario('Demo');
const server = startServer(data.store, 47974);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const findings: { scenario: Scenario; page: string; width: number; issue: string }[] = [];
await page.route('**/api/qa-scenario', async (route) => {
  seedScenario((await route.request().postDataJSON()).scenario as Scenario);
  await route.fulfill({ json: { ready: true } });
});
await page.addInitScript((scenarios) => {
  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.createElement('div');
    toolbar.setAttribute('aria-label', 'Development fixture controls');
    toolbar.style.cssText =
      'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#ddd;padding:4px;border-radius:8px;display:flex;gap:3px;font:12px system-ui;max-width:96vw;overflow:auto;';
    for (const scenario of scenarios) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = scenario;
      button.style.cssText =
        'padding:6px;background:white;color:#222;white-space:nowrap;border-radius:4px;';
      button.onclick = async () => {
        await fetch('/api/qa-scenario', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scenario }),
        });
        location.reload();
      };
      toolbar.append(button);
    }
    document.body.append(toolbar);
  });
}, SCENARIOS);
try {
  await page.goto(server.accessUrl);
  for (const scenario of SCENARIOS) {
    await page.getByRole('button', { name: scenario, exact: true }).click();
    await page.waitForLoadState('networkidle');
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const section of ['Library', 'Projects']) {
        await page.getByRole('button', { name: section, exact: true }).first().click();
        await expect(
          page.getByRole('heading', {
            name: section === 'Library' ? 'Library' : 'Your projects',
            exact: true,
          }),
        ).toBeVisible();
        if (section === 'Library')
          await page.getByRole('button', { name: 'All items', exact: true }).click();
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          text: document.querySelector('main')?.textContent || '',
          projects: document.querySelectorAll('.project-card').length,
        }));
        if (metrics.overflow)
          findings.push({ scenario, page: section, width, issue: 'Horizontal document overflow' });
        if (
          scenario === 'One' &&
          /1 (?:projects|capabilities|capability groups)/.test(metrics.text)
        )
          findings.push({
            scenario,
            page: section,
            width,
            issue: 'Singular count uses a plural label',
          });
        if (metrics.projects > 40)
          findings.push({
            scenario,
            page: section,
            width,
            issue: `Unpaginated project rendering: ${metrics.projects} cards`,
          });
        await page.screenshot({
          path: join(directory, `${scenario.replace(/\W/g, '-')}-${section}-${width}.png`),
        });
        if (scenario === '41 rows') {
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(
            page.locator(section === 'Library' ? '.entry-list-row' : '.project-card'),
          ).toHaveCount(1);
          await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
          await page.getByRole('button', { name: 'Previous', exact: true }).click();
        }
        if (scenario === '40 rows' && section === 'Library')
          await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.screenshot({ path: join(directory, 'large-text.png') });
  const report = {
    fieldMap,
    scenarios: SCENARIOS,
    widths: [1440, 320],
    findings,
    errors,
    darkMode: 'Not offered by this product',
    rtl: 'Interface is English; non-Latin catalog data tested',
    toggle: 'Development-only browser overlay in this script; never included in the build',
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ findings, errors }, null, 2)}\n`);
  expect(findings).toHaveLength(0);
  expect(errors).toHaveLength(0);
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
