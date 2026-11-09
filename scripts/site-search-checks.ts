import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page } from '@playwright/test';

const queryName = { name: 'Search documentation', exact: true };

export async function checkSearchLifecycle(page: Page, origin: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin);
  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  let requests = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/docs/search.json', async (route) => {
    requests++;
    await gate;
    await route.fulfill({ path: 'site/dist/docs/search.json', contentType: 'application/json' });
  });
  try {
    await page.evaluate(() => {
      const scope = window as typeof window & { searchFocus: string[] };
      scope.searchFocus = [];
      document.addEventListener('focusin', (event) => {
        const target = event.target as HTMLElement;
        scope.searchFocus.push(target.id || target.getAttribute('aria-label') || target.tagName);
      });
    });
    const position = await page.evaluate(() => ({
      y: scrollY,
      x: document.querySelector('h1')!.getBoundingClientRect().x,
    }));
    const dialog = page.getByRole('dialog', queryName),
      panel = dialog.locator('.search-panel');
    await page.getByRole('button', queryName).click();
    await expect(dialog).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('searchbox')).toBeFocused();
    const focus = await page.evaluate(
      () => (window as typeof window & { searchFocus: string[] }).searchFocus,
    );
    expect(focus).not.toContain('Close search');
    expect(requests, 'Featured guides appear without an index request').toBe(0);
    await expect(dialog.locator('.search-results a')).toHaveCount(5);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: '.local/qa/site/search-desktop.png' });

    // Reopen while the pointer exit is still running; its old completion must not close the new intent.
    await dialog
      .getByRole('button', { name: 'Close search' })
      .dispatchEvent('click', { detail: 1 });
    await expect(dialog).toHaveAttribute('data-state', 'closing');
    expect(await dialog.evaluate((node) => (node as HTMLDialogElement).open)).toBe(true);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(250);
    await expect(dialog).toHaveAttribute('data-state', 'open');
    await expect(page.getByRole('searchbox')).toBeFocused();
    expect(
      await page.evaluate(() => ({
        y: scrollY,
        x: document.querySelector('h1')!.getBoundingClientRect().x,
      })),
    ).toEqual(position);

    const box = await panel.boundingBox();
    await page.getByRole('searchbox').fill('MCP');
    await expect.poll(() => requests).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', queryName)).toBeFocused();
    await page.keyboard.press('Control+k');
    await page.getByRole('searchbox').fill('no-fixture-stale-771');
    release();
    await expect(dialog.getByRole('status')).toContainText('No matching guides');
    await expect(dialog.locator('.search-results a')).toHaveCount(0);
    expect((await panel.boundingBox())?.height).toBe(box?.height);
    await dialog.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(dialog.locator('.search-results a')).toHaveCount(5);
    await page.getByRole('searchbox').fill('MCP');
    await expect(dialog.getByRole('link', { name: /MCP integration/ })).toBeVisible();
    expect(requests).toBe(1);
    await page.getByRole('searchbox').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(`${origin}/`);
    await page.keyboard.press('ArrowDown');
    await expect(dialog.locator('.search-results a').first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => scrollY)).toBe(position.y);
  } finally {
    release();
    await page.unroute('**/docs/search.json');
  }
}

export async function checkSearchViewports(page: Page, origin: string): Promise<void> {
  for (const [width, height] of [
    [768, 800],
    [390, 844],
    [320, 420],
    [640, 320],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin);
    await page.getByRole('button', queryName).click();
    const dialog = page.getByRole('dialog', queryName),
      panel = dialog.locator('.search-panel');
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    expect(
      await page
        .getByRole('searchbox')
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await panel.evaluate((node) => node.getAnimations().length)).toBe(0);
    expect(
      await dialog.locator('.search-results').evaluate((node) => node.clientHeight),
    ).toBeGreaterThan(30);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations, `${width}×${height}`).toEqual([]);
    if (width === 390) await page.screenshot({ path: '.local/qa/site/search-mobile.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', queryName)).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/docs/start/`);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', queryName);
  await expect(page.getByRole('searchbox')).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  const destination = await dialog.locator('.search-results a').nth(1).getAttribute('href');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.locator('.search-results a').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}${destination}`);
  await expect(page.locator('h1')).toBeVisible();
}

export async function checkLateRigBoot(browser: Browser, origin: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/*rig-renderer*.js', async (route) => {
    await gate;
    await route.continue();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.getByRole('button', { name: 'Explode rig' }).click();
    await page.locator('[data-rig-project="swift"]').click();
    await page.getByRole('button', { name: 'Rotate rig' }).click();
    await expect(page.locator('[data-rig-motion-label]')).toContainText('Preparing the 3D view');
    expect(
      await page
        .locator('[data-rig-stage]')
        .evaluate((node) => node.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await page.getByRole('button', queryName).click();
    release();
    await expect(page.getByRole('button', { name: 'Rotate rig' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'static');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-renderer', 'webgl', {
      timeout: 30000,
    });
    await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-moving', 'false');
    await expect(page.locator('[data-rig-stage]')).toHaveAttribute('data-exploded', 'false');
    await expect(page.locator('[data-rig-project="swift"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-rig-motion-label]')).toHaveText('Assembled for Daylight');
    expect(errors).toEqual([]);
  } finally {
    release();
    await context.close();
  }
}

export async function checkDisclosures(page: Page, origin: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin);
  const details = page.locator('.studio-faq details').first(),
    summary = details.locator('summary');
  await summary.scrollIntoViewIfNeeded();
  const top = (await summary.boundingBox())!.y;
  await summary.click();
  await page.waitForTimeout(300);
  expect(await details.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(true);
  expect(Math.abs((await summary.boundingBox())!.y - top)).toBeLessThan(2);
  const icons = await page.locator('.icon').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width && box.height)
      .map((box) => Math.abs(box.width - box.height)),
  );
  expect(
    icons.every((difference) => difference < 0.1),
    'SVG controls retain a square box',
  ).toBe(true);
  await page.screenshot({ path: '.local/qa/site/faq-open.png' });
  await summary.click();
  await summary.click();
  await summary.click();
  await page.waitForTimeout(300);
  expect(await details.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
  expect(Math.abs((await summary.boundingBox())!.y - top)).toBeLessThan(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
