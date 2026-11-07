import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import { guides } from './src/docs.ts';

const origin = process.env.RIGSHELF_SITE_URL;
if (origin) {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'RIGSHELF_SITE_URL must be an HTTPS origin without credentials, query or fragment.',
    );
  }
}

export default defineConfig({
  site: origin,
  output: 'static',
  publicDir: './.generated/public',
  devToolbar: { enabled: false },
  compressHTML: true,
  build: { inlineStylesheets: 'never' },
  markdown: { shikiConfig: { theme: 'github-light' } },
  vite: { build: { assetsInlineLimit: 0 } },
  server: { port: 4321, host: '127.0.0.1' },
  integrations: [
    {
      name: 'rigshelf-sitemap',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          if (!origin) return;
          const paths = ['/', '/docs/', ...guides.map((guide) => `/docs/${guide.slug}/`)];
          const urls = paths
            .map((path) => `<url><loc>${new URL(path, origin).href}</loc></url>`)
            .join('');
          await writeFile(
            new URL('sitemap.xml', dir),
            `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
          );
        },
      },
    },
  ],
});
