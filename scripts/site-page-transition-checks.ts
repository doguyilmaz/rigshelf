import { expect, type Page } from '@playwright/test';

type TransitionEvidence = {
  path: string;
  state: 'pending' | 'none' | 'animated' | 'skipped';
  finished: boolean;
  animations: { name: string; duration: number }[];
};
type ObservedWindow = Window & { pageTransitionEvidence?: TransitionEvidence };

async function transition(page: Page, animated: boolean): Promise<void> {
  await page.waitForLoadState('load');
  await expect
    .poll(() => page.evaluate(() => (window as ObservedWindow).pageTransitionEvidence?.finished))
    .toBe(true);
  const evidence = await page.evaluate(() => (window as ObservedWindow).pageTransitionEvidence!);
  if (animated) {
    expect(evidence.state, JSON.stringify(evidence)).toBe('animated');
    expect(
      evidence.animations.some((item) => item.name.includes('fade')),
      evidence.path,
    ).toBe(true);
    expect(
      evidence.animations.every((item) => item.duration === 180),
      evidence.path,
    ).toBe(true);
  } else expect(['none', 'skipped']).toContain(evidence.state);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(await page.locator('h1').count()).toBe(1);
  await expect(page.locator('h1')).toBeVisible();
  // Separate deliberate journeys from the immediate Back interruption checked below.
  await page.waitForTimeout(250);
}

export async function checkPageTransitions(page: Page, origin: string): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener('pagereveal', (event) => {
      const evidence: TransitionEvidence = {
        path: location.pathname + location.hash,
        state: event.viewTransition ? 'pending' : 'none',
        finished: !event.viewTransition,
        animations: [],
      };
      (window as ObservedWindow).pageTransitionEvidence = evidence;
      if (!event.viewTransition) return;
      void event.viewTransition.ready.then(
        () => {
          evidence.state = 'animated';
          evidence.animations = document
            .getAnimations()
            .filter(
              (animation): animation is CSSAnimation =>
                animation instanceof CSSAnimation &&
                animation.animationName.includes('view-transition'),
            )
            .map((animation) => ({
              name: animation.animationName,
              duration: Number(animation.effect!.getTiming().duration),
            }));
        },
        () => {
          evidence.state = 'skipped';
        },
      );
      const finish = () => {
        evidence.finished = true;
      };
      void event.viewTransition.finished.then(finish, finish);
    });
  });
  await page.goto(`${origin}/docs/installation/`);
  await transition(page, false);
  const header = () => page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await header().getByRole('link', { name: 'Harnesses', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/#harnesses`);
  await transition(page, true);
  expect(
    await page
      .locator('#harnesses')
      .evaluate((node) =>
        Math.abs(
          node.getBoundingClientRect().top -
            document.querySelector('.site-header')!.getBoundingClientRect().bottom,
        ),
      ),
  ).toBeLessThan(2);
  await header().getByRole('link', { name: 'Documentation', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/docs/`);
  await transition(page, true);
  await page.locator('.guide-grid a[href="/docs/installation/"]').click();
  await expect(page).toHaveURL(`${origin}/docs/installation/`);
  await transition(page, true);
  await page.locator('.doc-pagination a').last().click();
  await expect(page).toHaveURL(`${origin}/docs/library/`);
  await transition(page, true);
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/docs/installation/`);
  await transition(page, true);
  await page.goForward();
  await expect(page).toHaveURL(`${origin}/docs/library/`);
  await transition(page, true);

  await header().getByRole('link', { name: 'Harnesses', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/#harnesses`);
  await transition(page, false);
  await header().getByRole('link', { name: 'Documentation', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/docs/`);
  await transition(page, true);
  await page.locator('.guide-grid a[href="/docs/installation/"]').click();
  await page.waitForURL(`${origin}/docs/installation/`, { waitUntil: 'commit' });
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/docs/`);
  await page.waitForLoadState('load');
  await expect
    .poll(() => page.evaluate(() => (window as ObservedWindow).pageTransitionEvidence?.finished))
    .toBe(true);
  await expect(page.locator('h1')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.guide-grid a[href="/docs/installation/"]').click();
  await expect(page).toHaveURL(`${origin}/docs/installation/`);
  await transition(page, false);
  await page.reload();
  await transition(page, false);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
