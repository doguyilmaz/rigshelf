import './page-transitions';
import './section-navigation';

import './search-dialog';

for (const pre of document.querySelectorAll<HTMLPreElement>('.prose pre')) {
  const button = pre.closest('.code-example')?.querySelector<HTMLButtonElement>('.copy-code');
  if (!button) continue;
  button.hidden = false;
  let reset: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
      button.textContent = 'Copied';
    } catch {
      const code = pre.querySelector('code');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      button.textContent = 'Selected';
    }
    clearTimeout(reset);
    reset = setTimeout(() => {
      button.textContent = 'Copy';
    }, 1800);
  });
}

const tables = [...document.querySelectorAll<HTMLElement>('.table-scroll')];
function updateTableFocus(): void {
  for (const table of tables) table.tabIndex = table.scrollWidth > table.clientWidth + 1 ? 0 : -1;
}
if (tables.length) {
  const observer = new ResizeObserver(updateTableFocus);
  for (const table of tables) observer.observe(table);
  void document.fonts.ready.then(updateTableFocus);
}

const headingLinks = new Map(
  [...document.querySelectorAll<HTMLAnchorElement>('.docs-outline nav a')].map((link) => [
    link.hash.slice(1),
    link,
  ]),
);
if (headingLinks.size && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (observed) => {
      for (const entry of observed) {
        if (!entry.isIntersecting) continue;
        for (const link of headingLinks.values()) link.removeAttribute('aria-current');
        headingLinks.get(entry.target.id)?.setAttribute('aria-current', 'location');
      }
    },
    { rootMargin: '-5% 0px -70% 0px' },
  );
  for (const heading of document.querySelectorAll('.prose h2, .prose h3'))
    observer.observe(heading);
}

for (const menu of document.querySelectorAll<HTMLDetailsElement>(
  '.nav-disclosure, .docs-mobile-tools > details',
)) {
  menu.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
}
