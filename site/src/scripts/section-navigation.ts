const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SCROLL_LISTENER_LIFETIME_MS = 2000;
let cancelSectionScroll: (() => void) | undefined;

function allowScrollInterruption(section: HTMLElement): void {
  const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
  const destination = Math.min(
    document.documentElement.scrollHeight - innerHeight,
    Math.max(0, scrollY + section.getBoundingClientRect().top - margin),
  );
  const cleanup = (): void => {
    clearTimeout(timeout);
    for (const input of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      window.removeEventListener(input, interrupt);
    window.removeEventListener('scrollend', finish);
    cancelSectionScroll = undefined;
  };
  const interrupt = (): void => {
    scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
    cleanup();
  };
  const finish = (): void => {
    if (Math.abs(scrollY - destination) < 2) cleanup();
  };
  const timeout = setTimeout(cleanup, SCROLL_LISTENER_LIFETIME_MS);
  for (const input of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    window.addEventListener(input, interrupt, { passive: true });
  window.addEventListener('scrollend', finish);
  cancelSectionScroll = interrupt;
}

function sectionFor(link: HTMLAnchorElement): HTMLElement | null {
  const destination = new URL(link.href, location.href);
  if (
    destination.origin !== location.origin ||
    destination.pathname !== location.pathname ||
    destination.search !== location.search ||
    !destination.hash
  )
    return null;
  try {
    return document.getElementById(decodeURIComponent(destination.hash.slice(1)));
  } catch {
    return null;
  }
}

function focusSection(section: HTMLElement): void {
  const heading = section.matches('h1,h2,h3')
    ? section
    : (section.querySelector<HTMLElement>('h1,h2,h3') ?? section);
  if (!heading.hasAttribute('tabindex')) {
    heading.setAttribute('tabindex', '-1');
    heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
  }
  heading.focus({ preventScroll: true });
}

document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  )
    return;
  const link = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const section = sectionFor(link);
  if (!section) return;
  event.preventDefault();
  cancelSectionScroll?.();
  const destination = new URL(link.href, location.href);
  if (destination.hash !== location.hash) history.pushState(null, '', destination);
  focusSection(section);
  const smooth = event.detail > 0 && !reducedMotion.matches;
  if (smooth) allowScrollInterruption(section);
  section.scrollIntoView({
    behavior: smooth ? 'smooth' : 'instant',
    block: 'start',
  });
});

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) cancelSectionScroll?.();
});
