import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

export async function checkDocsReadability(page: Page, label: string): Promise<void> {
  const sizes = await page.evaluate(() => {
    const size = (selector: string) =>
      [...document.querySelectorAll(selector)].map((node) =>
        Number.parseFloat(getComputedStyle(node).fontSize),
      );
    return {
      prose: size('.prose'),
      paragraphs: size('.prose > p, .prose > ul > li, .prose > ol > li'),
      code: size('.prose pre, .prose pre code'),
      tables: size('.prose table'),
      navigation: size('.docs-nav-group > a, .docs-outline nav a'),
      copy: size('.copy-code'),
      lineHeight: Number.parseFloat(getComputedStyle(document.querySelector('.prose')!).lineHeight),
    };
  });
  expect(sizes.prose, label).toEqual([18]);
  expect(
    sizes.paragraphs.every((size) => size >= 18),
    label,
  ).toBe(true);
  expect(
    sizes.code.every((size) => size >= 15),
    label,
  ).toBe(true);
  expect(
    sizes.tables.every((size) => size >= 16),
    label,
  ).toBe(true);
  expect(
    sizes.navigation.every((size) => size >= 14),
    label,
  ).toBe(true);
  expect(
    sizes.copy.every((size) => size >= 14),
    label,
  ).toBe(true);
  expect(sizes.lineHeight, label).toBeGreaterThanOrEqual(29);
  const toolbarOverlaps = await page.locator('.code-example').evaluateAll((examples) =>
    examples.some((example) => {
      const toolbar = example.querySelector('.code-toolbar')!.getBoundingClientRect(),
        code = example.querySelector('pre')!.getBoundingClientRect();
      return toolbar.bottom > code.top + 1;
    }),
  );
  expect(toolbarOverlaps, `${label}: toolbar never covers a command`).toBe(false);
  expect(await page.locator('.prose pre').count(), label).toBe(
    await page.locator('.prose .code-example').count(),
  );
  expect(await page.locator('.prose table').count(), label).toBe(
    await page.locator('.prose .table-scroll').count(),
  );
}

export async function checkDocsCommands(page: Page, origin: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}/docs/installation/`);
  const source = await readFile('docs/DISTRIBUTION.md', 'utf8');
  const commands = [...source.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) =>
    match[1]!.trimEnd(),
  );
  const rendered = await page.locator('.prose pre code').allTextContents();
  expect(rendered.map((code) => code.trimEnd())).toEqual(commands);
  await expect(page.locator('.code-toolbar > span').first()).toHaveText('Shell');
  await page.evaluate(() => {
    const scope = window as typeof window & { docsCopies: string[] };
    scope.docsCopies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          scope.docsCopies.push(value);
        },
      },
    });
  });
  for (const [index, example] of (await page.locator('.code-example').all()).entries()) {
    const button = example.getByRole('button', { name: 'Copy code example' });
    await button.click();
    await expect(button).toHaveText('Copied');
    expect(
      await page.evaluate(() =>
        (window as typeof window & { docsCopies: string[] }).docsCopies.at(-1),
      ),
    ).toBe(rendered[index]);
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
    });
  });
  await page.locator('.code-example .copy-code').first().click();
  await expect(page.locator('.code-example .copy-code').first()).toHaveText('Selected');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(rendered[0]);

  await page.setViewportSize({ width: 320, height: 740 });
  const code = page.locator('.code-example pre').last();
  await code.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => code.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollX)).toBe(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByText('On this page', { exact: true }).first().click();
  await page
    .getByRole('navigation', { name: 'Mobile table of contents' })
    .getByRole('link', { name: 'Build your own archive', exact: true })
    .click();
  await expect(page.locator('#build-your-own-archive')).toBeFocused();
  await expect(page.locator('.docs-mobile-tools details[open]')).toHaveCount(0);
  await page.goto(`${origin}/docs/harnesses/`);
  const table = page.getByRole('region', { name: 'Reference — table 1' });
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollX)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
