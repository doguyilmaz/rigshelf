# Rigshelf website

The public landing page and field guide, built with Astro. The application remains in the repository root; this site is static and has no connection to a user’s running workbench.

```sh
# From the repository root
bun install --cwd site --frozen-lockfile --backend=copyfile
bun run site:dev
```

The default site address is `http://127.0.0.1:4321`. Use `bun run site:build` for `site/dist`, `bun run test:site` for the isolated browser suite, `bun run --cwd site test` for motion unit tests, and `bun run site:preview` to inspect the production build. The build invalidates Astro's content cache so Markdown-rendering changes appear in every guide.

The landing page uses an original procedural 3D rig, an interactive project selection diagram and native Harness file routes. Three.js loads in a separate chunk for a visible, motion-enabled hero with WebGL2; reduced-motion visitors keep the usable SVG illustration. Motion ends when the state settles, and context loss restores the illustration. Fonts and assets are local. No React or animation framework is shipped. Section links use native smooth scrolling for pointer input, preserve fragment history and destination focus, and stay immediate for keyboard/reduced-motion navigation. Reading text, labels and control sizes have explicit browser checks. The earlier homepage remains at `/previous/` for comparison, with indexing disabled.

Search opens into its input with five suggested guides. Typing a query loads the same-origin index; queries stay in the browser. Pointer transitions are short and interruptible, while keyboard/reduced-motion actions are immediate. The native dialog keeps focus contained and preserves page position. Rig rendering pauses while Search covers it, and delayed graphics retain the current project/layer selection. Rotation requires the actual 3D renderer; unsupported browsers retain illustrated layer controls with an explicit rotation limitation.

Documentation is generated from an explicit list of canonical repository files. Edit those files and rerun the command; `.generated` is disposable. A native Sätteri plugin adds language/Copy toolbars and independently scrollable tables without changing command text. Guides keep 18px prose, 15px code and 16px table text at narrow widths. Browser checks cover every guide at desktop and 320px, seven installation/data layouts, exact command copying, clipboard denial and keyboard scrolling. See [website maintenance and hosting](../docs/WEBSITE.md) for commands, origin configuration, content flow and deployment headers.

Framework references: [Astro content loaders](https://docs.astro.build/en/reference/content-loader-reference/), [static deployment](https://docs.astro.build/en/guides/deploy/) and [Astro 7 Markdown behavior](https://docs.astro.build/en/guides/upgrade-to/v7/). Dependencies are pinned in the separate Bun lockfile. Install the site dependencies before its own check/format scripts; the application can still be developed independently.
