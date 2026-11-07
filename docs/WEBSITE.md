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

The browser suite uses the root development dependencies and an already installed Chromium. It serves only the generated static files under an ephemeral loopback origin, applies the production header policy and stores evidence under ignored `.local/qa/site`. It checks the published guides, internal links/fragments, responsive geometry, accessibility, project/Harness examples, search, reduced motion, JavaScript-free navigation and the 404. Separate interaction checks cover readable text/control sizes, non-overlapping directive cards, selection height, smooth section progress, header clearance, wheel interruption, fragment history and focus/scroll restoration. Graphics checks exercise software WebGL, interrupted transitions, stopped idle frames, context loss and the static fallback; they do not substitute for native GPU/device acceptance. The application’s separate `bun run verify`, `bun run lint` and `bun run test:ui` remain required for application changes.

## Maintain the documentation

The route inventory lives in `site/src/docs.ts`. `site/scripts/prepare.ts` reads only those named repository documents and the public brand/font assets. It generates frontmatter, removes the duplicate document heading and rewrites known relative Markdown links into site routes. An unmapped local link fails the build. Edit the canonical document, not `.generated`.

`site/.generated`, `site/.astro` and `site/dist` are disposable build outputs. Website dependencies are kept out of the application’s runtime package. No private inventory, real project screenshot, conversation, account store or user catalog is a website input. Public diagrams use original SVG illustrations and procedural Three.js geometry; no model downloads or external texture services are required. Local fonts retain their OFL notices. Website dependency notices are included under `/licenses/`.

Search loads a static same-origin index only when opened. It includes the published documentation text; the browser sends no query to an external search or AI service. Essential text and links work without JavaScript. Project examples are illustrative, with explicit native paths and compatibility links rather than claims that every native feature is interchangeable.

## Host the static build

Set `RIGSHELF_SITE_URL` to the actual HTTPS origin when preparing a public build. For example, supply your chosen origin through the build environment, then run `bun run site:build`. Credentials, query strings and fragments are refused. With that origin configured, the build adds canonical URLs, an absolute social image URL, a sitemap and its robots reference. Without it, no public domain is invented.

Publish **only `site/dist`** to a static host. For a repository-root Cloudflare Pages configuration, install with `bun install --cwd site --frozen-lockfile --backend=copyfile`, build with `bun run site:build`, and select `site/dist` as the output directory. Other static hosts can serve the same directory. Use the included `_headers` policy on hosts that support it; otherwise configure equivalent headers, including the Content Security Policy. Serve the branded `404.html` for missing routes.

The website has no production server, API credentials, account database, analytics or remote forms. It does not expose or proxy the loopback application. Hosting the website does not host Rigshelf’s workbench. The CI website job verifies and builds; it does not deploy, register a domain or publish a release.

## Visual direction

The approved Rigshelf mark, Instrument Sans and Newsreader remain the identity. The landing page has its own editorial presentation: a charcoal equipment stage, warm paper sections and a signal-orange accent. It explains the product through a physical rig, selective project context, native Harness file routes and layered guidance. The workbench UI is not a marketing-page template. Documentation keeps the quieter light reading theme.

The hero starts with a usable SVG illustration. Visible, motion-enabled browsers with WebGL2 load the separate Three.js chunk; reduced-motion visitors retain the illustration without downloading that renderer. Layer and rotation controls have a static fallback. Surface markings are deliberately large symbols; explanatory text lives in readable HTML rather than angled texture labels. The model starts assembled, and layer/rotation motion is requested through the controls. The finite 3D transitions retarget from the current pose, stop when settled, pause offscreen or while the document is hidden, and dispose resources on exit. Context loss restores the illustration. No infinite render loop, scroll hijacking or external runtime request is required. Touch visitors use explicit controls instead of capturing page scrolling.

The homepage uses 16–18px reading text, labels no smaller than 12px and controls at least 40px tall. Directive examples do not cover each other. All four project examples and six Harness choices retain their container height at the five tested widths.

Same-page pointer links use the browser’s native smooth scrolling, with offsets for the sticky header. Fragment URLs and Back/Forward remain native history entries, and focus follows the destination heading without a second jump. Keyboard navigation and reduced motion are immediate. Wheel/touch scrolling is not replaced by an animation engine; wheel input can interrupt a section transition. Search keeps the page position and restores focus on close.

| Before | After | Why |
| --- | --- | --- |
| Pointer section links jumped immediately. | Native smooth scrolling, sticky-header clearance and destination focus; keyboard/reduced motion remain immediate. | Make the destination legible while preserving user input and browser history. |
| Labels shrank to 5–10px and descriptions to 11–13px. | Labels are at least 12px; reading text is 16–18px; example controls are at least 40px tall. | A passing overflow or contrast check does not establish readability. |
| Angled textures carried microtext; paper examples covered one another. | Large model symbols with HTML explanations; fully visible directive cards and wider native-file diagrams. | The illustration explains the product without hiding information. |
| Harness-specific prose changed layout height. | Shared compatibility guidance and stable file rows. | Keep nearby content stationary without reserving a large empty text area. |

The earlier homepage is preserved at `/previous/` for comparison. It has `noindex` metadata and is excluded from the public sitemap. The redesign is isolated on the `website/rig-studio` branch; the application and its private data are unchanged.

The social card source is `site/public/social.svg`; regenerate its committed PNG with `bun site/scripts/social.ts`. The generated site includes both formats and font notices. Keep technical terms and product behavior consistent with [compatibility](COMPATIBILITY.md), [security](SECURITY-REVIEW.md) and [brand compatibility](BRANDING.md).
