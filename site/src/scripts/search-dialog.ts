export {};

type SearchEntry = { slug: string; title: string; description: string; text: string };
type Phase = 'closed' | 'opening' | 'open' | 'closing';
const dialog = document.querySelector<HTMLDialogElement>('#doc-search')!;
const panel = dialog.querySelector<HTMLElement>('.search-panel')!;
const scrim = dialog.querySelector<HTMLElement>('.search-scrim')!;
const query = dialog.querySelector<HTMLInputElement>('input')!;
const results = dialog.querySelector<HTMLElement>('.search-results')!;
const status = dialog.querySelector<HTMLElement>('.search-status')!;
const clearButton = dialog.querySelector<HTMLButtonElement>('[data-search-clear]')!;
const triggers = [...document.querySelectorAll<HTMLElement>('[data-search-open]')];
const featured = [...results.children].map((node) => node.cloneNode(true));
const resultArrow = results.querySelector('svg')!.cloneNode(true);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const EASING = 'cubic-bezier(.23,1,.32,1)';
let entries: SearchEntry[] | undefined, loading: Promise<SearchEntry[]> | undefined;
let phase: Phase = 'closed',
  wantsOpen = false,
  epoch = 0,
  generation = 0;
let animations: Animation[] = [],
  outsideStart = false;
let returnTarget: HTMLElement | undefined,
  returnTabindex: string | null = null;
let savedScroll = { top: 0, left: 0 };

function measureViewport(): void {
  const viewport = window.visualViewport;
  dialog.style.setProperty('--search-viewport-height', `${viewport?.height ?? innerHeight}px`);
  dialog.style.setProperty('--search-viewport-top', `${viewport?.offsetTop ?? 0}px`);
}

function updateViewport(): void {
  if (dialog.open) measureViewport();
}

function restoreFocus(): void {
  const target =
    returnTarget?.isConnected && returnTarget.getClientRects().length ? returnTarget : triggers[0];
  if (!target) return;
  if (target === returnTarget && returnTabindex !== null && !target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', returnTabindex);
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}

function finish(open: boolean, revision: number): void {
  if (revision !== epoch) return;
  phase = open ? 'open' : 'closed';
  dialog.dataset.state = phase;
  if (!open) {
    dialog.close();
    restoreFocus();
    scrollTo({ ...savedScroll, behavior: 'instant' });
  }
  for (const animation of animations) animation.cancel();
  animations = [];
}

function transition(open: boolean, animate: boolean, initial = false): void {
  const revision = ++epoch;
  const surface = getComputedStyle(panel),
    backdrop = getComputedStyle(scrim);
  const from = initial
    ? { opacity: '0', transform: 'translateY(8px) scale(.99)' }
    : { opacity: surface.opacity, transform: surface.transform };
  const backdropFrom = initial ? '0' : backdrop.opacity;
  for (const animation of animations) animation.cancel();
  animations = [];
  phase = open ? 'opening' : 'closing';
  dialog.dataset.state = phase;
  for (const trigger of triggers) trigger.setAttribute('aria-expanded', String(open));
  if (!animate || reduced.matches) {
    finish(open, revision);
    return;
  }
  const options = { duration: open ? 200 : 140, easing: EASING, fill: 'both' as const };
  animations = [
    panel.animate(
      [
        from,
        { opacity: open ? '1' : '0', transform: open ? 'none' : 'translateY(4px) scale(.995)' },
      ],
      options,
    ),
    scrim.animate([{ opacity: backdropFrom }, { opacity: open ? '1' : '0' }], options),
  ];
  void Promise.all(animations.map((animation) => animation.finished)).then(
    () => finish(open, revision),
    () => undefined,
  );
}

function showFeatured(): void {
  results.replaceChildren(...featured.map((node) => node.cloneNode(true)));
  status.textContent = 'Start with a guide, or search a topic.';
}

async function searchIndex(): Promise<SearchEntry[]> {
  if (entries) return entries;
  if (!loading)
    loading = fetch('/docs/search.json', { credentials: 'omit' }).then(async (response) => {
      if (!response.ok) throw new Error('Search index unavailable');
      const value: unknown = await response.json();
      if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid search index');
      return value.filter(
        (item): item is SearchEntry =>
          item &&
          typeof item === 'object' &&
          typeof item.slug === 'string' &&
          /^[a-z0-9-]+$/.test(item.slug) &&
          ['title', 'description', 'text'].every((key) => typeof item[key] === 'string'),
      );
    });
  try {
    entries = await loading;
    return entries;
  } finally {
    loading = undefined;
  }
}

function matching(index: SearchEntry[], text: string): SearchEntry[] {
  const words = text.split(/\s+/).filter(Boolean);
  return index
    .map((entry) => {
      const title = `${entry.title} ${entry.description}`.toLowerCase();
      const body = entry.text.toLowerCase();
      return {
        entry,
        score: words.every((word) => `${title} ${body}`.includes(word))
          ? words.reduce((score, word) => score + (title.includes(word) ? 10 : 1), 1)
          : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || first.entry.title.localeCompare(second.entry.title),
    )
    .map((item) => item.entry);
}

function showResults(items: SearchEntry[]): void {
  results.replaceChildren();
  for (const entry of items.slice(0, 7)) {
    const link = document.createElement('a'),
      title = document.createElement('strong'),
      description = document.createElement('small');
    link.href = `/docs/${entry.slug}/`;
    title.textContent = entry.title;
    description.textContent = entry.description;
    link.append(title, description, resultArrow.cloneNode(true));
    results.append(link);
  }
  results.scrollTop = 0;
  status.textContent = items.length
    ? `${items.length} ${items.length === 1 ? 'guide' : 'guides'} found${items.length > 7 ? ' · showing the first 7' : ''}.`
    : 'No matching guides. Try “MCP”, “backup”, “install” or another word.';
}

async function search(): Promise<void> {
  const current = ++generation,
    text = query.value.trim().toLowerCase().slice(0, 200);
  clearButton.hidden = query.value.length === 0;
  results.inert = false;
  results.removeAttribute('aria-busy');
  if (!text) {
    showFeatured();
    return;
  }
  if (!entries) {
    status.textContent = 'Loading the local search index…';
    results.inert = true;
    results.setAttribute('aria-busy', 'true');
  }
  try {
    const index = await searchIndex();
    if (current !== generation || !wantsOpen) return;
    showResults(matching(index, text));
  } catch {
    if (current !== generation || !wantsOpen) return;
    showFeatured();
    status.textContent = 'Search could not load. Type again to retry, or choose a guide below.';
  } finally {
    if (current === generation) {
      results.inert = false;
      results.removeAttribute('aria-busy');
    }
  }
}

function openSearch(animate: boolean, trigger?: HTMLElement): void {
  const initial = !dialog.open;
  if (initial) {
    returnTarget =
      trigger ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    returnTabindex = returnTarget?.getAttribute('tabindex') ?? null;
    savedScroll = { top: scrollY, left: scrollX };
    for (const menu of document.querySelectorAll<HTMLDetailsElement>(
      '.nav-disclosure, .docs-mobile-tools > details',
    ))
      menu.open = false;
    measureViewport();
    dialog.showModal();
  }
  wantsOpen = true;
  updateViewport();
  transition(true, animate, initial);
  query.focus({ preventScroll: true });
  if (!animate) query.select();
  scrollTo({ ...savedScroll, behavior: 'instant' });
  void search();
}

function closeSearch(animate: boolean): void {
  if (!dialog.open) return;
  wantsOpen = false;
  generation++;
  transition(false, animate);
}

for (const trigger of triggers)
  trigger.addEventListener('click', (event) => openSearch(event.detail > 0, trigger));
dialog
  .querySelector('[data-search-close]')!
  .addEventListener('click', (event) => closeSearch((event as MouseEvent).detail > 0));
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSearch(false);
});
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  epoch++;
  generation++;
  wantsOpen = false;
  phase = 'closed';
  dialog.dataset.state = 'closed';
  for (const animation of animations) animation.cancel();
  animations = [];
  for (const trigger of triggers) trigger.setAttribute('aria-expanded', 'false');
});
dialog.addEventListener('pointerdown', (event) => {
  outsideStart = !panel.contains(event.target as Node);
});
dialog.addEventListener('pointercancel', () => {
  outsideStart = false;
});
dialog.addEventListener('click', (event) => {
  if (outsideStart && !panel.contains(event.target as Node)) closeSearch(event.detail > 0);
  outsideStart = false;
});
dialog.querySelector('.search-field')!.addEventListener('click', (event) => {
  if (event.target instanceof Element && !event.target.closest('button'))
    query.focus({ preventScroll: true });
});
query.addEventListener('input', () => {
  if (wantsOpen) void search();
});
clearButton.addEventListener('click', () => {
  query.value = '';
  query.focus({ preventScroll: true });
  void search();
});
dialog.addEventListener('keydown', (event) => {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || !wantsOpen || results.inert) return;
  const links = [...results.querySelectorAll<HTMLAnchorElement>('a')],
    active = document.activeElement;
  if (!links.length) return;
  if (event.key === 'Enter') {
    if (active === query) {
      event.preventDefault();
      links[0]!.click();
    }
    return;
  }
  if (active !== query && !links.includes(active as HTMLAnchorElement)) return;
  event.preventDefault();
  const current = links.indexOf(active as HTMLAnchorElement);
  if (event.key === 'ArrowUp' && current === 0) query.focus({ preventScroll: true });
  else
    links[
      current < 0
        ? event.key === 'ArrowDown'
          ? 0
          : links.length - 1
        : Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))
    ]!.focus({ preventScroll: true });
  if (document.activeElement !== query)
    (document.activeElement as HTMLElement).scrollIntoView({
      block: 'nearest',
      behavior: 'instant',
    });
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape' && dialog.open) {
    event.preventDefault();
    closeSearch(false);
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'k'
  ) {
    event.preventDefault();
    if (wantsOpen) closeSearch(false);
    else openSearch(false);
  }
});
reduced.addEventListener('change', () => {
  if (reduced.matches && dialog.open) transition(wantsOpen, false);
});
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
