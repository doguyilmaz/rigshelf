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
bun run --cwd site test
bun run site:build
bun run test:site
bun run site:preview
```

The browser suite uses the root development dependencies and an already installed Chromium. It serves only the generated static files under an ephemeral loopback origin, applies the production header policy and stores evidence under ignored `.local/qa/site`. It checks the published guides, internal links/fragments, responsive geometry, accessibility, project/Harness examples, search, reduced motion, JavaScript-free navigation and the 404. Separate interaction checks cover readable text/control sizes, non-overlapping directive cards, selection height, smooth section progress, header clearance, wheel interruption, fragment history and focus/scroll restoration. Graphics checks exercise software WebGL, interrupted transitions, stopped idle frames, context loss and the static fallback; they do not substitute for native GPU/device acceptance. The application’s separate `bun run verify`, `bun run lint` and `bun run test:ui` remain required for application changes.

## Maintain the documentation

The route inventory lives in `site/src/docs.ts`. `site/scripts/prepare.ts` reads only those named repository documents and the public brand/font assets. It generates frontmatter, removes the duplicate document heading and rewrites known relative Markdown links into site routes. An unmapped local link fails the build. Edit the canonical document, not `.generated`.

`site/.generated`, `site/.astro` and `site/dist` are disposable build outputs. Website dependencies are kept out of the application’s runtime package. No private inventory, real project screenshot, conversation, account store or user catalog is a website input. Public diagrams use original SVG illustrations and procedural Three.js geometry; no model downloads or external texture services are required. Local fonts retain their OFL notices. Website dependency notices are included under `/licenses/`.

Code blocks and tables are wrapped at build time by a native Sätteri HAST plugin, after syntax highlighting. The wrapper preserves the original code and table nodes. Code has a separate language/Copy toolbar; enabling Copy does not insert a new row or cover commands. If clipboard access fails, the code is selected for manual copying. Tables and long code scroll within their own keyboard-accessible regions. The production build forces content-cache invalidation so changes to the Markdown plugin cannot leave stale rendered guides.

Guides use 18px prose, 15px code, 16px table text and 14px navigation. Narrow screens change the layout instead of shrinking reading text. The article is capped at 760px; the outline becomes an “On this page” disclosure below 1350px, and the guide sidebar becomes a disclosure below 1000px. The browser suite checks every guide at desktop and 320px, plus installation/data pages at seven widths, canonical command preservation, Copy with a memory-only clipboard substitute, denied clipboard access and keyboard scrolling.

Search opens with five server-rendered guide suggestions and loads its static same-origin index only after the first nonempty query. It includes the published documentation text; the browser sends no query to an external search or AI service. Input focus is immediate. The fixed-height results region keeps the panel in place when results change; its measured visual viewport accommodates short windows. Pointer entry/exit use short opacity/transform transitions, while keyboard and reduced-motion actions are immediate. Rapid reopen, stale requests, clear, arrow navigation, composing input, focus return and scroll retention have browser checks. Essential text and links work without JavaScript. Project examples are illustrative, with explicit native paths and compatibility links rather than claims that every native feature is interchangeable.

## Host the static build

Set `RIGSHELF_SITE_URL` to the actual HTTPS origin when preparing a public build. For example, supply your chosen origin through the build environment, then run `bun run site:build`. Credentials, query strings and fragments are refused. With that origin configured, the build adds canonical URLs, an absolute social image URL, a sitemap and its robots reference. Without it, no public domain is invented.

Publish **only `site/dist`** to a static host. For a repository-root Cloudflare Pages configuration, install with `bun install --cwd site --frozen-lockfile --backend=copyfile`, build with `bun run site:build`, and select `site/dist` as the output directory. Other static hosts can serve the same directory. Use the included `_headers` policy on hosts that support it; otherwise configure equivalent headers, including the Content Security Policy. Serve the branded `404.html` for missing routes.

The website has no production server, API credentials, account database, analytics or remote forms. It does not expose or proxy the loopback application. Hosting the website does not host Rigshelf’s workbench. The CI website job verifies and builds; it does not deploy, register a domain or publish a release.

## Visual direction

The approved Rigshelf mark, Instrument Sans and Newsreader remain the identity. The landing page has its own editorial presentation: a charcoal equipment stage, warm paper sections and a signal-orange accent. It explains the product through a physical rig, selective project context, native Harness file routes and layered guidance. The workbench UI is not a marketing-page template. Documentation keeps the quieter light reading theme.

The hero starts with a usable SVG illustration. Visible, motion-enabled browsers with WebGL2 load the separate Three.js chunk; reduced-motion visitors retain the illustration without downloading that renderer automatically. The SVG supports project and layer selection; real rotation explicitly requests the 3D renderer, including for reduced-motion visitors, whose pose changes remain immediate. Unavailable graphics disable rotation with an explanation. Surface markings are large symbols; explanatory text lives in readable HTML rather than angled texture labels. The model starts assembled, and layer/rotation motion is requested through the controls. Finite transitions retarget from the current pose, choose the nearest equivalent rotation, stop when settled and preserve their remaining duration while paused. They pause offscreen, behind Search or while the document is hidden, and dispose resources on exit. Delayed initialization retains the latest project/layer choice and waits for the overlay to close. Drag draws at most once per frame and releases on cancellation, lost capture or window blur. Context loss restores the current illustrated layer state. No infinite render loop, scroll hijacking or external runtime request is required. Touch visitors use explicit controls instead of capturing page scrolling.

The homepage uses 16–18px reading text, labels no smaller than 12px and controls at least 40px tall. Directive examples do not cover each other. All four project examples and six Harness choices retain their container height at the seven tested widths. Navigation, Search and rig controls share geometric SVG icons; the approved R mark is reused directly. FAQ disclosures preserve native semantics and animate intrinsic height where supported, with immediate keyboard/reduced-motion changes.

Same-page pointer links use the browser’s native smooth scrolling, with offsets for the sticky header. Fragment URLs and Back/Forward remain native history entries, and focus follows the destination heading without a second jump. Keyboard navigation and reduced motion are immediate. Wheel/touch scrolling is not replaced by an animation engine; wheel input can interrupt a section transition. Search keeps the page position and restores focus on close.

| Before | After | Why |
| --- | --- | --- |
| Pointer section links jumped immediately. | Native smooth scrolling, sticky-header clearance and destination focus; keyboard/reduced motion remain immediate. | Make the destination legible while preserving user input and browser history. |
| Labels shrank to 5–10px and descriptions to 11–13px. | Labels are at least 12px; reading text is 16–18px; example controls are at least 40px tall. | A passing overflow or contrast check does not establish readability. |
| Angled textures carried microtext; paper examples covered one another. | Large model symbols with HTML explanations; fully visible directive cards and wider native-file diagrams. | The illustration explains the product without hiding information. |
| Harness-specific prose changed layout height. | Shared compatibility guidance and stable file rows. | Keep nearby content stationary without reserving a large empty text area. |
| Search opened empty, briefly focused the close button and used the light theme on the dark homepage. | Immediate query focus, useful initial links, matching theme, stable results area and interruptible pointer exit. | Make opening, searching and closing predictable. |
| Documentation body text was 12–13px; code and tables fell to 10px at smaller widths. | Prose stays 18px, code 15px and tables 16px; navigation changes shape instead of shrinking. | Long instructions must be readable at normal browser zoom. |
| Copy floated over code and depended on client-created markup. | A build-time language/Copy toolbar with reserved height, exact code preservation and selection fallback. | Commands remain unobscured, copyable and available without JavaScript. |
| Repeated rig visibility events restarted transitions; delayed graphics could lose the selected pose. | Pause/resume retains timing, selection uses the nearest rotation and initialization preserves the current choice. | Avoid jumps or extra spins during interrupted interaction. |

The earlier homepage is preserved at `/previous/` for comparison. It has `noindex` metadata and is excluded from the public sitemap. The redesign is isolated on the `website/rig-studio` branch; the application and its private data are unchanged.

The social card source is `site/public/social.svg`; regenerate its committed PNG with `bun site/scripts/social.ts`. The generated site includes both formats and font notices. Keep technical terms and product behavior consistent with [compatibility](COMPATIBILITY.md), [security](SECURITY-REVIEW.md) and [brand compatibility](BRANDING.md).
