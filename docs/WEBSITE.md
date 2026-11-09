# Website

The website in `site/` is a static Astro application: an introduction, an interactive example and the documentation from `docs/`. It does not connect to a workbench, a catalog or any agent. Example projects are fictional, and nothing on the site installs tools or calls a model.

## Develop

```sh
bun install --cwd site --frozen-lockfile --backend=copyfile
bun run site:dev
```

The site opens at `http://127.0.0.1:4321`, separate from the workbench on port 47471.

## Check

```sh
bun run --cwd site format
bun run site:check
bun run --cwd site lint
bun run --cwd site test
bun run site:build
bun run test:site
```

`test:site` serves the built files with the production header policy and checks every page for broken links, layout at phone and desktop widths, accessibility, search, page transitions and navigation without JavaScript. It needs Chromium (`bunx playwright install chromium`).

## Documentation

`site/src/docs.ts` lists the published guides. `site/scripts/prepare.ts` copies those documents, adds frontmatter and rewrites relative Markdown links to site routes; a link to an unpublished file fails the build. Edit the document in `docs/`, never `site/.generated`.

`site/.generated`, `site/.astro` and `site/dist` are build output.

## Hosting

Set `RIGSHELF_SITE_URL` to the public HTTPS origin before building; it adds canonical URLs, the social image URL and a sitemap. Publish only `site/dist`, with the security headers from `site/public/_headers` and `404.html` for missing routes. The site has no server, credentials, analytics or forms.

## Design

The Rigshelf mark, Instrument Sans and Newsreader are the identity. The homepage uses a charcoal stage, warm paper sections and an orange accent; the documentation uses the same type at reading sizes (18px prose, 15px code). The hero starts as an SVG illustration and loads the Three.js renderer only for visible, motion-enabled browsers with WebGL2. Links between pages use a short native view transition; keyboard navigation and reduced motion stay immediate.

The social card source is `site/public/social.svg`; regenerate the PNG with `bun site/scripts/social.ts`.
