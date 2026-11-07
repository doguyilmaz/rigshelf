import { expect, type Page } from '@playwright/test';

export async function checkLandingReadability(page: Page, width: number): Promise<void> {
  const smallText = await page.evaluate(() => {
    const failures: { text: string; size: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (
        !parent ||
        !node.textContent?.trim() ||
        parent.closest('script,style,noscript,[aria-hidden="true"],.sr-only')
      )
        continue;
      const range = document.createRange();
      range.selectNode(node);
      const bounds = range.getBoundingClientRect(),
        style = getComputedStyle(parent);
      if (!bounds.width || !bounds.height || style.visibility !== 'visible') continue;
      const size = Number.parseFloat(style.fontSize);
      if (size < 12) failures.push({ text: node.textContent.trim().slice(0, 70), size });
    }
    return failures;
  });
  expect(smallText, `Readable labels at ${width}px`).toEqual([]);
  const bodySizes = await page
    .locator(
      '.studio-intro,.context-heading>p,.principles-copy>p:not(.section-index),.review-sequence p,.local-columns p,.studio-faq p',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
    );
  expect(
    bodySizes.every((size) => size >= 16),
    `Reading text at ${width}px`,
  ).toBe(true);
  const controls = await page
    .locator(
      '.rig-project-buttons button,.rig-view-controls button,.context-project-selector button,.native-agent-rail button',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        size: Number.parseFloat(getComputedStyle(node).fontSize),
        height: node.getBoundingClientRect().height,
      })),
    );
  expect(controls.every((control) => control.size >= 14 && control.height >= 40)).toBe(true);
  const sheets = await page.locator('.principle-sheet').evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    }),
  );
  expect(
    sheets.every((sheet, index) => index === 0 || sheet.top >= sheets[index - 1]!.bottom),
    `Directive cards are fully readable at ${width}px`,
  ).toBe(true);
}

export async function checkSelectionStability(page: Page): Promise<void> {
  for (const [container, selector, attribute] of [
    ['.context-machine', '[data-context-project]', 'data-context-project'],
    ['.native-bench', '[data-native-harness]', 'data-native-harness'],
  ] as const) {
    const height = await page
      .locator(container)
      .evaluate((node) => node.getBoundingClientRect().height);
    for (const button of await page.locator(selector).all()) {
      await button.click();
      expect(await button.getAttribute('aria-pressed')).toBe('true');
      const nextHeight = await page
        .locator(container)
        .evaluate((node) => node.getBoundingClientRect().height);
      expect(
        Math.abs(nextHeight - height),
        `${container}: ${await button.getAttribute(attribute)}`,
      ).toBeLessThan(1);
    }
  }
}

async function expectSectionPosition(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.locator(selector).evaluate((node) => {
          const margin = Number.parseFloat(getComputedStyle(node).scrollMarginTop);
          return Math.abs(node.getBoundingClientRect().top - margin);
        }),
      { timeout: 4000 },
    )
    .toBeLessThan(2);
}

export async function checkSectionNavigation(page: Page, origin: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const scope = window as typeof window & { sectionScrolls: number[] };
    scope.sectionScrolls = [];
    addEventListener('scroll', () => scope.sectionScrolls.push(scrollY));
  });
  await page.locator('.studio-watch').click();
  await expectSectionPosition(page, '#how-it-works');
  const positions = await page.evaluate(
    () => (window as typeof window & { sectionScrolls: number[] }).sectionScrolls,
  );
  expect(positions.length, 'Pointer navigation interpolates rather than jumping').toBeGreaterThan(
    3,
  );
  expect(
    Math.max(...positions.map((value, index) => (index ? value - positions[index - 1]! : 0))),
  ).toBeLessThan(positions.at(-1)! * 0.5);
  await expect(page.locator('#context-title')).toBeFocused();
  await expect(page).toHaveURL(`${origin}/#how-it-works`);
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'Harnesses' })
    .click();
  await expectSectionPosition(page, '#harnesses');
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/#how-it-works`);
  await expectSectionPosition(page, '#how-it-works');

  const search = page.getByRole('button', { name: 'Search documentation', exact: true });
  const beforeDialog = await page.evaluate(() => ({
    x: document.querySelector('h1')!.getBoundingClientRect().x,
    y: scrollY,
  }));
  await search.click();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  expect(
    await page.evaluate(() => ({
      x: document.querySelector('h1')!.getBoundingClientRect().x,
      y: scrollY,
    })),
  ).toEqual(beforeDialog);

  const link = page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'Harnesses' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expectSectionPosition(page, '#harnesses');
  await expect(page.locator('#native-title')).toBeFocused();
  const keyboardY = await page.evaluate(() => scrollY);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => scrollY)).toBe(keyboardY);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'How it works' })
    .click();
  await expectSectionPosition(page, '#how-it-works');
  const reducedY = await page.evaluate(() => scrollY);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => scrollY)).toBe(reducedY);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin);
  await page.locator('.studio-watch').click();
  await page.waitForTimeout(80);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(250);
  const interruptedY = await page.evaluate(() => scrollY);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => scrollY),
    'Wheel input keeps control after interrupting section navigation',
  ).toBe(interruptedY);
  expect(
    await page.locator('#how-it-works').evaluate((node) => node.getBoundingClientRect().top),
  ).toBeGreaterThan(250);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByLabel('Navigation menu', { exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'How it works' })
    .click();
  await expectSectionPosition(page, '#how-it-works');
  await expect(page.locator('#context-title')).toBeFocused();
  expect(await page.locator('.nav-disclosure').getAttribute('open')).toBeNull();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
