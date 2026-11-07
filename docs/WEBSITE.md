# Website and documentation

Rigshelf’s public website is a separate static Astro application in `site/`. It introduces the project, provides an interactive example and renders the maintained application documentation. It does not connect to a running workbench, its private catalog or any Agent. Example project names and configurations are fictional; interactions never install tools or call a model.

## Develop locally

From a source checkout, install the website’s separate dependencies once:

```sh
bun install --cwd site --frozen-lockfile --backend=copyfile
bun run site:dev
```

Open the local address printed by Astro, normally `http://127.0.0.1:4321`. This is separate from the application workbench on port `47471`. The site runs through Bun 1.4.4 or newer. If using Astro through Node instead, respect Astro’s Node engine requirement, currently 22.23.4 or newer. Framework telemetry is disabled in the website scripts.

## Build and verify

```sh
bun run format
bun run --cwd site format
bun run site:check
bun run --cwd site lint
bun run site:build
bun run test:site
bun run site:preview
```

The browser suite uses the root development dependencies and an already installed Chromium. It serves only the generated static files under an ephemeral loopback origin, applies the production header policy and stores evidence under ignored `.local/qa/site`. It checks the published guides, internal links/fragments, responsive geometry, accessibility, project/Harness examples, search, reduced motion, JavaScript-free navigation and the 404. The application’s separate `bun run verify`, `bun run lint` and `bun run test:ui` remain required for application changes.

## Maintain the documentation

The route inventory lives in `site/src/docs.ts`. `site/scripts/prepare.ts` reads only those named repository documents and the public brand/font assets. It generates frontmatter, removes the duplicate document heading and rewrites known relative Markdown links into site routes. An unmapped local link fails the build. Edit the canonical document, not `.generated`.

`site/.generated`, `site/.astro` and `site/dist` are disposable build outputs. Website dependencies are kept out of the application’s runtime package. No private inventory, real project screenshot, conversation, account store or user catalog is a website input. Public diagrams are original SVG illustrations, and local fonts retain their OFL notices.

Search loads a static same-origin index only when opened. It includes the published documentation text; the browser sends no query to an external search or AI service. Essential text and links work without JavaScript. Project examples are illustrative, with explicit native paths and compatibility links rather than claims that every native feature is interchangeable.

## Host the static build

Set `RIGSHELF_SITE_URL` to the actual HTTPS origin when preparing a public build. For example, supply your chosen origin through the build environment, then run `bun run site:build`. Credentials, query strings and fragments are refused. With that origin configured, the build adds canonical URLs, an absolute social image URL, a sitemap and its robots reference. Without it, no public domain is invented.

Publish **only `site/dist`** to a static host. For a repository-root Cloudflare Pages configuration, install with `bun install --cwd site --frozen-lockfile --backend=copyfile`, build with `bun run site:build`, and select `site/dist` as the output directory. Other static hosts can serve the same directory. Use the included `_headers` policy on hosts that support it; otherwise configure equivalent headers, including the Content Security Policy. Serve the branded `404.html` for missing routes.

The website has no production server, API credentials, account database, analytics or remote forms. It does not expose or proxy the loopback application. Hosting the website does not host Rigshelf’s workbench. The CI website job verifies and builds; it does not deploy, register a domain or publish a release.

## Visual direction

The approved Rigshelf mark, Instrument Sans and Newsreader remain the identity. Paper, graphite, precise rules and modular isometric drawings describe a physical rig assembled for a project. The finite assembly animation is explanatory, interruptible and disabled by reduced motion. Common controls stay immediate; the site has no infinite render loop, scroll hijacking, pointer chase or WebGL requirement.

The social card source is `site/public/social.svg`; regenerate its committed PNG with `bun site/scripts/social.ts`. The generated site includes both formats and font notices. Keep technical terms and product behavior consistent with [compatibility](COMPATIBILITY.md), [security](SECURITY-REVIEW.md) and [brand compatibility](BRANDING.md).
