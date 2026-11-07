import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type BrowserContext, chromium, expect, type Page } from '@playwright/test';
import { guides } from '../site/src/docs';
import {
  checkLandingReadability,
  checkSectionNavigation,
  checkSelectionStability,
} from './site-interaction-checks';

const root = resolve('site/dist');
const evidence = resolve('.local/qa/site');
await mkdir(evidence, { recursive: true });
const configured = (await readFile(join(root, '_headers'), 'utf8'))
  .split('\n')
  .slice(1)
  .filter((line) => line.trim())
  .map((line) => {
    const [name, ...value] = line.trim().split(':');
    return [name!, value.join(':').trim()];
  });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    let path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`) && path !== root)
      return new Response(null, { status: 400 });
    if (!extname(path)) path = join(path, 'index.html');
    const present = await Bun.file(path).exists();
    const file = Bun.file(present ? path : join(root, '404.html'));
    return new Response(file, {
      status: present ? 200 : 404,
      headers: { ...Object.fromEntries(configured), 'Content-Type': file.type },
    });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
let graphicsBrowser: Browser | undefined;
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [],
  blocked: string[] = [],
  checks: string[] = [];
function captureErrors(target: Page): void {
  target.on('pageerror', (error) => errors.push(error.message));
  target.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
}
async function localRequests(target: BrowserContext): Promise<void> {
  await target.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:') return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
}
captureErrors(page);
await localRequests(context);
const targets = new Set<string>();
let layoutCases = 0;
async function fits(label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow, label).toBe(false);
  expect(await page.locator('h1').count(), label).toBe(1);
  expect(
    await page.locator('h1').evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    label,
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })),
    label,
  ).toEqual([]);
  layoutCases++;
}
try {
  for (const path of [
    '/',
    '/previous/',
    '/docs/',
    ...guides.map((guide) => `/docs/${guide.slug}/`),
  ]) {
    const response = await page.goto(`${origin}${path}`);
    expect(response?.status()).toBe(200);
    if (path === '/' || path === '/previous/')
      await page.screenshot({
        path: join(evidence, path === '/' ? 'home-viewport.png' : 'previous-viewport.png'),
      });
    await fits(path);
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    for (const href of hrefs) if (new URL(href).origin === origin) targets.add(href);
  }
  checks.push(
    'Every published guide renders with one heading, no horizontal page overflow and no Axe violations under the production CSP.',
  );
  for (const href of targets) {
    const url = new URL(href);
    const response = await page.request.get(href);
    expect(response.status(), url.pathname).toBe(200);
    if (url.hash) {
      await page.goto(href);
      expect(
        await page.locator(`[id=${JSON.stringify(decodeURIComponent(url.hash.slice(1)))}]`).count(),
        href,
      ).toBeGreaterThan(0);
    }
  }
  checks.push(
    'All internal documentation links and referenced fragments resolve to the generated canonical pages.',
  );
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/docs/', '/docs/data/']) {
      await page.goto(`${origin}${path}`);
      await fits(`${path} at ${width}`);
      if (path === '/') {
        await checkLandingReadability(page, width);
        await checkSelectionStability(page);
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(
          evidence,
          `${path === '/' ? 'home' : path.includes('data') ? 'doc' : 'guides'}-${width}.png`,
        ),
        fullPage: path === '/',
      });
      if (path === '/' && width === 768) {
        for (const [selector, name] of [
          ['.context-machine', 'library-reading'],
          ['.native-bench', 'files-reading'],
          ['.principle-stack', 'principles-reading'],
        ] as const)
          await page.locator(selector).screenshot({ path: join(evidence, `${name}.png`) });
      }
      if (path === '/' && width <= 390)
        await page
          .locator('.studio-hero')
          .screenshot({ path: join(evidence, `hero-${width}.png`) });
      if (path === '/docs/data/' && width === 390)
        await page.screenshot({ path: join(evidence, 'doc-viewport-390.png') });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkSectionNavigation(page, origin);
  checks.push(
    'Pointer section links interpolate with a sticky-header offset; hash history, focus, keyboard/reduced-motion navigation, wheel interruption and search scroll restoration work.',
  );
  checks.push(
    'Readable 12px-minimum labels, 16px-minimum reading text, 40px controls and unobscured directive cards pass at five widths; all project/Harness selections retain layout height.',
  );
  await page.goto(origin);
  const box = await page.locator('.context-machine').boundingBox();
  await page.locator('[data-context-project="api"]').click();
  await expect(page.locator('[data-context-name]')).toHaveText('Relay');
  await expect(page.locator('[data-context-selection]')).toContainText('API design');
  await expect(page.locator('.context-item.is-selected')).toHaveCount(4);
  await expect(page.locator('[data-library-index="10"]')).not.toHaveClass(/is-selected/);
  await page.locator('[data-native-harness="codex"]').click();
  await expect(page.locator('[data-native-mcp]')).toHaveText('.codex/config.toml');
  await expect(page.locator('[data-native-skills]')).toHaveText('.agents/skills/');
  expect((await page.locator('.context-machine').boundingBox())?.height).toBe(box?.height);
  await page.locator('[data-context-project="swift"]').click();
  await expect(page.locator('[data-context-name]')).toHaveText('Daylight');
  await expect(page.locator('[data-context-selection]')).toContainText('SwiftUI patterns');
  await page.locator('[data-native-harness="kiro"]').click();
  await expect(page.locator('[data-native-mcp]')).toHaveText('.kiro/settings/mcp.json');
  checks.push(
    'Context selection changes four focused capabilities while keeping native Plugin references outside; Harness selection updates documented native paths without page jumps.',
  );
  await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Find your way.' });
  await expect(search).toBeVisible();
  const searchFrame = await search.boundingBox();
  await page.getByRole('searchbox').fill('immutable');
  await expect(search.locator('.search-results a').first()).toBeVisible();
  await page.getByRole('searchbox').fill('no-fixture-match-931');
  await expect(search.getByRole('status')).toContainText('No matching guides');
  expect((await search.boundingBox())?.height).toBe(searchFrame?.height);
  await page.getByRole('searchbox').fill('MCP');
  await expect(search.getByRole('link', { name: /MCP integration/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Search documentation', exact: true }),
  ).toBeFocused();
  checks.push(
    'Local documentation search finds body text, recovers from empty results and returns focus on Escape.',
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel('Navigation menu', { exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Documentation' })
    .click();
  await expect(page).toHaveURL(`${origin}/docs/`);
  await page.goto(`${origin}/docs/start/`);
  await page.getByText('Browse the guides', { exact: true }).click();
  await page.locator('.docs-mobile-tools').getByRole('link', { name: 'Backup & restore' }).click();
  await expect(page.locator('h1')).toHaveText('Backup & restore');
  checks.push('Mobile navigation and the docs guide drawer reach real pages at 320px.');
  await page.goto(origin);
  await page.getByRole('button', { name: 'Explode rig' }).click();
  await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-exploded', 'true');
  expect(
    await page
      .locator('[data-rig-stage]')
      .evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.locator('[data-rig-project="swift"]').click();
  await expect(page.locator('[data-rig-motion-label]')).toHaveText('Assembled for Daylight');
  await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-exploded', 'false');
  const reducedScripts = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.endsWith('.js')),
  );
  expect(reducedScripts.some((path) => path.includes('rig-renderer'))).toBe(false);
  checks.push(
    'Reduced-motion visitors keep the static artwork and working project/layer controls without loading the graphics runtime.',
  );
  graphicsBrowser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const graphics = await graphicsBrowser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
    deviceScaleFactor: 2,
  });
  await graphics.addInitScript(() => {
    const scope = globalThis as typeof globalThis & { rigFrameCount: number };
    const original = requestAnimationFrame;
    scope.rigFrameCount = 0;
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        scope.rigFrameCount++;
        callback(time);
      });
  });
  const graphicsPage = await graphics.newPage();
  captureErrors(graphicsPage);
  await localRequests(graphics);
  await graphicsPage.goto(origin);
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'webgl', {
    timeout: 30000,
  });
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false', {
    timeout: 10000,
  });
  await graphicsPage.waitForTimeout(150);
  const idleFrames = await graphicsPage.evaluate(
    () => (globalThis as typeof globalThis & { rigFrameCount: number }).rigFrameCount,
  );
  await graphicsPage.waitForTimeout(250);
  expect(
    await graphicsPage.evaluate(
      () => (globalThis as typeof globalThis & { rigFrameCount: number }).rigFrameCount,
    ),
  ).toBe(idleFrames);
  await graphicsPage.screenshot({ path: join(evidence, 'studio-webgl.png') });
  await graphicsPage.setViewportSize({ width: 768, height: 1000 });
  await graphicsPage.locator('[data-rig-stage]').scrollIntoViewIfNeeded();
  await graphicsPage
    .locator('.rig-installation')
    .screenshot({ path: join(evidence, 'rig-reading.png') });
  await graphicsPage.setViewportSize({ width: 390, height: 844 });
  await graphicsPage.locator('[data-rig-stage]').scrollIntoViewIfNeeded();
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'webgl');
  await graphicsPage
    .locator('.rig-installation')
    .screenshot({ path: join(evidence, 'rig-webgl-mobile.png') });
  await graphicsPage.setViewportSize({ width: 1440, height: 1000 });
  await graphicsPage.evaluate(() => scrollTo(0, 0));
  await graphicsPage.getByRole('button', { name: 'Rotate rig' }).focus();
  await graphicsPage.keyboard.press('Enter');
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false');
  await graphicsPage.getByRole('button', { name: 'Explode rig' }).click();
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'true');
  await graphicsPage.getByRole('button', { name: 'Rotate rig' }).click();
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false', {
    timeout: 10000,
  });
  await graphicsPage.getByRole('button', { name: 'Explode rig' }).click();
  await graphicsPage.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await graphicsPage.waitForTimeout(200);
  const pausedFrames = await graphicsPage.evaluate(
    () => (globalThis as typeof globalThis & { rigFrameCount: number }).rigFrameCount,
  );
  await graphicsPage.waitForTimeout(250);
  expect(
    await graphicsPage.evaluate(
      () => (globalThis as typeof globalThis & { rigFrameCount: number }).rigFrameCount,
    ),
  ).toBe(pausedFrames);
  await graphicsPage.locator('[data-rig-stage]').scrollIntoViewIfNeeded();
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false', {
    timeout: 10000,
  });
  await graphicsPage.emulateMedia({ reducedMotion: 'reduce' });
  await graphicsPage.getByRole('button', { name: 'Explode rig' }).click();
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false');
  await graphicsPage.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-rig-canvas]')!;
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect(graphicsPage.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'static');
  await graphics.close();
  checks.push(
    'Software WebGL renders the actual model; desktop/mobile framing works, idle/offscreen frames stop, keyboard changes are immediate, interrupted layer/rotation transitions settle, reduced motion stops interpolation and context loss restores the illustration.',
  );
  const fallback = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        return kind === 'webgl2' ? null : Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const fallbackPage = await fallback.newPage();
  captureErrors(fallbackPage);
  await localRequests(fallback);
  await fallbackPage.goto(origin);
  await expect(fallbackPage.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'static');
  await fallbackPage.getByRole('button', { name: 'Explode rig' }).click();
  await expect(fallbackPage.getByRole('button', { name: 'Explode rig' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await fallback.close();
  checks.push(
    'A browser without WebGL retains the artwork and usable controls rather than showing an empty canvas.',
  );
  const offline = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await offline.newPage();
  captureErrors(staticPage);
  await localRequests(offline);
  await staticPage.goto(origin);
  await expect(staticPage.getByRole('heading', { level: 1 })).toBeVisible();
  await staticPage
    .locator('.studio-hero')
    .getByRole('link', { name: 'Build your first kit' })
    .click();
  await expect(staticPage.locator('.prose')).toBeVisible();
  await offline.close();
  const missing = await page.goto(`${origin}/no-such-page/`);
  expect(missing?.status()).toBe(404);
  checks.push(
    'Primary content and documentation navigation work without JavaScript; missing routes use the branded 404.',
  );
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  const scripts = (await readdir(join(root, '_astro'))).filter((name) => name.endsWith('.js'));
  const clientBytes = (
    await Promise.all(scripts.map((name) => Bun.file(join(root, '_astro', name)).size))
  ).reduce((sum, size) => sum + size, 0);
  const graphicsGzipBytes = (
    await Promise.all(
      scripts.map(
        async (name) =>
          Bun.gzipSync(await Bun.file(join(root, '_astro', name)).arrayBuffer()).byteLength,
      ),
    )
  ).reduce((sum, size) => sum + size, 0);
  expect(graphicsGzipBytes).toBeLessThan(240 * 1024);
  const report = {
    status: 'pass',
    pages: guides.length + 3,
    layoutCases,
    readabilityCases: 5,
    selectionVariants: 50,
    internalTargets: targets.size,
    clientBytes,
    graphicsGzipBytes,
    reducedScripts,
    checks,
    errors,
    externalRequests: blocked,
  };
  await Bun.write(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  await page
    .screenshot({ path: join(evidence, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  throw error;
} finally {
  await graphicsBrowser?.close();
  await browser.close();
  await server.stop(true);
}
