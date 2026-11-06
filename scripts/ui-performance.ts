import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { saveSkill } from '../src/core/ingest';
import { route } from '../src/core/service';
import { startServer } from '../src/server';
import { fixture } from '../tests/helpers';

// Local measurements are evidence for this checkout, not portable timing assertions.
const LIBRARY_SIZE = 1284;
const SAMPLE_COUNT = 3;
const data = await fixture();
const directory = resolve('.local/qa/performance');
await mkdir(directory, { recursive: true });
data.store.db.transaction(() => {
  const source = {
    id: 'performance-fixture',
    name: 'Fixture engineering collection',
    url: 'https://example.invalid/fixture',
    type: 'local' as const,
    recipe: '',
    status: 'unchecked' as const,
    notes: 'Fictional measurement fixture.',
  };
  data.store.put('source', source);
  for (let index = 0; index < LIBRARY_SIZE; index++) {
    const name = `fixture-guide-${String(index).padStart(4, '0')}`;
    const body = `---\nname: ${name}\ndescription: Use this focused guide when reviewing ${index % 2 ? 'SwiftUI' : 'Expo'} applications.\n---\n\nPreserve the project’s authored instructions.\n`;
    const entry = saveSkill(
      data.store,
      body,
      [{ path: 'SKILL.md', content: Buffer.from(body).toString('base64'), executable: false }],
      source,
    );
    entry.tags =
      index % 2 ? ['ios', 'swift', 'accessibility'] : ['expo', 'react-native', 'testing'];
    data.store.saveEntry(entry);
  }
})();
const server = startServer(data.store, 48016);
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const unexpectedRequests: string[] = [];
const samples: Record<string, number>[] = [];
try {
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(server.accessUrl).origin)
        unexpectedRequests.push(new URL(request.url()).origin);
    });
    const started = performance.now();
    await page.goto(server.accessUrl);
    await page.getByRole('heading', { name: 'Set up a project', exact: true }).waitFor();
    const usableMs = performance.now() - started;
    await page.evaluate(() => document.fonts.ready);
    const fontsReadyMs = performance.now() - started;
    const libraryStart = performance.now();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
    const libraryOpenMs = performance.now() - libraryStart;
    await page.getByRole('button', { name: 'All items', exact: true }).click();
    await expect(page.locator('.entry-list-row')).toHaveCount(40);
    const searchStart = performance.now();
    await page.getByLabel('Search library', { exact: true }).fill('fixture-guide-1283');
    await expect(page.locator('.entry-list-row')).toHaveCount(1);
    const searchMs = performance.now() - searchStart;
    const inspectionStart = performance.now();
    await page.getByRole('button', { name: 'Open fixture-guide-1283', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'fixture-guide-1283', exact: true });
    await detail.getByRole('button', { name: 'Content', exact: true }).click();
    await expect(detail.locator('.content-preview').first()).toContainText('Preserve the project');
    const inspectionMs = performance.now() - inspectionStart;
    if (sample === 0) await page.screenshot({ path: join(directory, 'snapshot-inspection.png') });
    const stateTiming = await page.evaluate(() => {
      const entry = performance.getEntriesByName(`${location.origin}/api/state`).at(-1) as
        | PerformanceResourceTiming
        | undefined;
      return { stateDurationMs: entry?.duration || 0, stateBytes: entry?.decodedBodySize || 0 };
    });
    samples.push({ usableMs, fontsReadyMs, libraryOpenMs, searchMs, inspectionMs, ...stateTiming });
    await context.close();
  }
  const metadataStart = performance.now();
  const state = await route(data.store, 'GET', 'state', undefined);
  const stateSerializationMs = performance.now() - metadataStart;
  expect(data.store.entries()).toHaveLength(LIBRARY_SIZE);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  const report = {
    librarySize: LIBRARY_SIZE,
    samples,
    stateSerializationMs,
    serializedMetadataBytes: Buffer.byteLength(JSON.stringify(state)),
    errors,
    unexpectedRequests,
    limits:
      'Unthrottled local Chromium, isolated fictional catalog, three cold browser contexts. Not a universal latency guarantee or independent usability study.',
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
  await server.stop(true);
  await data.cleanup();
}
