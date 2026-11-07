import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { guides } from '../site/src/docs';

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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors: string[] = [],
  blocked: string[] = [],
  checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
});
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin === origin || url.protocol === 'data:') return route.continue();
  blocked.push(url.origin);
  return route.abort();
});
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
  for (const path of ['/', '/docs/', ...guides.map((guide) => `/docs/${guide.slug}/`)]) {
    const response = await page.goto(`${origin}${path}`);
    expect(response?.status()).toBe(200);
    if (path === '/') await page.screenshot({ path: join(evidence, 'home-viewport.png') });
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
      await page.screenshot({
        path: join(
          evidence,
          `${path === '/' ? 'home' : path.includes('data') ? 'doc' : 'guides'}-${width}.png`,
        ),
        fullPage: true,
      });
      if (path === '/' && width <= 390)
        await page.locator('.hero').screenshot({ path: join(evidence, `hero-${width}.png`) });
      if (path === '/docs/data/' && width === 390)
        await page.screenshot({ path: join(evidence, 'doc-viewport-390.png') });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
  const box = await page.locator('.workbench').boundingBox();
  await page.getByRole('button', { name: 'API service' }).click();
  await expect(page.locator('[data-project-name]')).toHaveText('Relay');
  await expect(page.locator('[data-kit-list]')).toContainText('API conventions');
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(page.locator('[data-file-name]')).toHaveText('.codex/config.toml');
  await expect(page.locator('[data-skill-path]')).toHaveText('.agents/skills/');
  const after = await page.locator('.workbench').boundingBox();
  expect(after?.height).toBe(box?.height);
  await page.getByRole('button', { name: 'Web app' }).click();
  await expect(page.locator('[data-project-name]')).toHaveText('Papertrail');
  checks.push(
    'Project and Harness selection update real example content and native paths without resizing the workbench or contacting services.',
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
  await page.getByRole('button', { name: 'Replay assembly' }).click();
  expect(
    await page.locator('.rig-art').evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Replay assembly' }).click();
  expect(
    await page.locator('.rig-art').evaluate((node) => node.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.locator('.rig-art').evaluate((node) => node.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  checks.push(
    'Assembly motion is interruptible, finite and removed immediately when reduced motion is requested.',
  );
  const offline = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await offline.newPage();
  await staticPage.goto(origin);
  await expect(staticPage.getByRole('heading', { level: 1 })).toBeVisible();
  await staticPage.getByRole('link', { name: 'Build your first kit' }).click();
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
  expect(clientBytes).toBeLessThan(20000);
  const report = {
    status: 'pass',
    pages: guides.length + 2,
    layoutCases,
    internalTargets: targets.size,
    clientBytes,
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
  await browser.close();
  await server.stop(true);
}
