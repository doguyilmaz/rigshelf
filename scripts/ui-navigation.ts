import type { Page } from '@playwright/test';

/** Exercise the visible navigation, including the secondary Defaults menu. */
export async function navigateTo(page: Page, name: string): Promise<void> {
  const target = page.getByRole('button', { name, exact: true });
  if ((await target.count()) === 0) await page.locator('.experience-more > summary').click();
  await target.click();
}
