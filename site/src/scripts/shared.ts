export {};

type SearchEntry = { slug: string; title: string; description: string; text: string };
const dialog = document.querySelector<HTMLDialogElement>('#doc-search')!;
const query = dialog.querySelector<HTMLInputElement>('input')!;
const results = dialog.querySelector<HTMLElement>('.search-results')!;
const searchStatus = dialog.querySelector<HTMLElement>('.search-status')!;
let entries: SearchEntry[] | undefined;
let loading: Promise<SearchEntry[]> | undefined;
let generation = 0;

async function searchIndex(): Promise<SearchEntry[]> {
  if (entries) return entries;
  if (!loading) {
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
  }
  try {
    entries = await loading;
    return entries;
  } finally {
    loading = undefined;
  }
}

function showResults(items: SearchEntry[], text: string): void {
  results.replaceChildren();
  for (const entry of items.slice(0, 7)) {
    const link = document.createElement('a');
    link.href = `/docs/${entry.slug}/`;
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const description = document.createElement('small');
    description.textContent = entry.description;
    link.append(title, description);
    results.append(link);
  }
  searchStatus.textContent = text
    ? `${items.length} ${items.length === 1 ? 'guide' : 'guides'} found${items.length > 7 ? ' · showing the first 7' : ''}.`
    : 'Start with a guide, or search a topic.';
  if (!items.length)
    searchStatus.textContent =
      'No matching guides. Try “MCP”, “backup”, “install” or another word.';
}

async function search(): Promise<void> {
  const current = ++generation;
  const text = query.value.trim().toLowerCase().slice(0, 200);
  searchStatus.textContent = 'Loading the local search index…';
  try {
    const index = await searchIndex();
    if (current !== generation || !dialog.open) return;
    const words = text.split(/\s+/).filter(Boolean);
    const scored = index
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
      );
    showResults(
      scored.map((item) => item.entry),
      text,
    );
  } catch {
    if (current === generation && dialog.open)
      searchStatus.textContent =
        'Search could not load. Type again to retry, or browse the field guide.';
  }
}

for (const button of document.querySelectorAll('[data-search-open]')) {
  button.addEventListener('click', () => {
    dialog.showModal();
    query.focus();
    void search();
  });
}
dialog.querySelector('[data-search-close]')?.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  generation++;
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
query.addEventListener('input', () => void search());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialog.open) {
    event.preventDefault();
    dialog.close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (dialog.open) dialog.close();
    else {
      dialog.showModal();
      query.focus();
      void search();
    }
  }
});

for (const pre of document.querySelectorAll<HTMLPreElement>('.prose pre')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code example');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select text';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1800);
  });
  pre.prepend(button);
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

for (const menu of document.querySelectorAll<HTMLDetailsElement>('.nav-disclosure')) {
  menu.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.open = false;
  });
}
