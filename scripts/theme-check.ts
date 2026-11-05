import type { Page } from '@playwright/test';

const semantic =
  '.button.danger,.badge.amber,.badge.red,.notice.warning,.warnings,.toast.error,.detail-danger';
const properties = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
];

/** Check painted colors, including inherited text, shadows and the shared modal backdrop. */
export async function assertNeutralTheme(page: Page, state: string): Promise<void> {
  const violations = await page.evaluate(
    ({ semantic, properties }) => {
      const failures: string[] = [];
      const inspect = (element: Element, pseudo?: string) => {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && (style.content === 'none' || style.content === 'normal')) return;
        for (const property of properties) {
          const value = style.getPropertyValue(property);
          for (const match of value.matchAll(/rgba?\(([^)]+)\)/g)) {
            const channels = match[1]!
              .split(/[,\s/]+/)
              .filter(Boolean)
              .map(Number);
            const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
            if (!alpha || Math.max(red, green, blue) - Math.min(red, green, blue) <= 1) continue;
            // Only red/amber feedback can depart from neutral chrome; green is never exempted.
            if (element.closest(semantic) && red >= green && green >= blue) continue;
            failures.push(
              `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}${pseudo ?? ''}: ${property}=${value}`,
            );
          }
        }
      };
      for (const element of document.querySelectorAll('*')) {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden')
          continue;
        inspect(element);
        inspect(element, '::before');
        inspect(element, '::after');
      }
      return failures.slice(0, 15);
    },
    { semantic, properties },
  );
  if (violations.length)
    throw new Error(`Non-neutral interface colors in ${state}:\n${violations.join('\n')}`);
}
