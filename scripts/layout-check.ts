import { expect, type Locator, type Page } from '@playwright/test';

/** Validate the rendered control geometry, including nested form labels. */
export async function assertSelectionControlsAligned(root: Locator, label: string): Promise<void> {
  const issues = await root.locator('label').evaluateAll((labels) =>
    labels.flatMap((node) => {
      const input = node.querySelector<HTMLInputElement>(
        ':scope > input[type="checkbox"], :scope > input[type="radio"]',
      );
      if (!input?.getClientRects().length) return [];
      const style = getComputedStyle(input);
      if (style.opacity === '0' || style.visibility === 'hidden') return [];
      const control = input.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      const offset = Math.abs(control.top + control.height / 2 - bounds.top - bounds.height / 2);
      const name =
        node.textContent?.trim().slice(0, 100) ||
        input.getAttribute('aria-label') ||
        'Unlabeled control';
      return [
        ...(offset > 1 ? [`${name}: control is ${offset}px off the label center`] : []),
        ...(control.width < 14 || control.width > 18 || control.height < 14 || control.height > 18
          ? [`${name}: unexpected control size ${control.width}×${control.height}`]
          : []),
        ...(control.left < bounds.left - 1 || control.right > bounds.right + 1
          ? [`${name}: control escapes its label`]
          : []),
      ];
    }),
  );
  expect(issues, label).toEqual([]);
}

export async function assertSurfaceFits(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 1)
      issues.push(`Document width ${document.documentElement.scrollWidth} exceeds ${innerWidth}`);
    for (const card of document.querySelectorAll<HTMLElement>('.preset-card, .project-card')) {
      if (card.scrollWidth > card.clientWidth + 1)
        issues.push(`Card clips ${card.querySelector('h2, .project-name')?.textContent}`);
    }
    return issues;
  });
  expect(problems, label).toEqual([]);
  await assertSelectionControlsAligned(page.locator('main'), label);
}

export async function assertDialogFits(page: Page, dialog: Locator, label: string): Promise<void> {
  await expect.poll(() => dialog.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  const problems = await dialog.evaluate((node) => {
    const issues: string[] = [];
    const bounds = node.getBoundingClientRect();
    const header = node.querySelector('.modal-head')!;
    const title = header.querySelector('h2')!;
    const close = header.querySelector('button')!;
    const body = node.querySelector<HTMLElement>('.modal-body')!;
    if (
      bounds.left < -1 ||
      bounds.right > innerWidth + 1 ||
      bounds.top < -1 ||
      bounds.bottom > innerHeight + 1
    )
      issues.push('Dialog escapes viewport');
    if (node.scrollLeft || header.scrollLeft) issues.push('Dialog scrolled horizontally');
    if (body.scrollWidth > body.clientWidth + 1) issues.push('Body clips horizontal content');
    if (body.clientHeight < 40) issues.push('Header leaves no usable body');
    for (const [name, element] of [
      ['title', title],
      ['close', close],
    ] as const) {
      const box = element.getBoundingClientRect();
      if (
        box.left < bounds.left - 1 ||
        box.right > bounds.right + 1 ||
        box.top < bounds.top - 1 ||
        box.bottom > bounds.bottom + 1
      )
        issues.push(`${name} is clipped`);
    }
    const target = close.getBoundingClientRect();
    const hit = document.elementFromPoint(
      target.left + target.width / 2,
      target.top + target.height / 2,
    );
    if (!hit || !(hit === close || close.contains(hit))) issues.push('Close action is covered');
    return issues;
  });
  expect(problems, label).toEqual([]);
  await assertSurfaceFits(page, label);
}

export async function assertPopupFits(page: Page, label: string): Promise<void> {
  const box = await page.locator('.select-popup').last().boundingBox();
  const viewport = page.viewportSize()!;
  expect(
    Boolean(
      box &&
        box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
    ),
    label,
  ).toBe(true);
}
