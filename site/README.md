# Rigshelf website

The public landing page and field guide, built with Astro. The application remains in the repository root; this site is static and has no connection to a user’s running workbench.

```sh
# From the repository root
bun install --cwd site --frozen-lockfile --backend=copyfile
bun run site:dev
```

The default site address is `http://127.0.0.1:4321`. Use `bun run site:build` for `site/dist`, `bun run test:site` for the isolated browser suite, and `bun run site:preview` to inspect the production build.

The landing page uses original SVG modules, a finite assembly sequence and an interactive project/Harness example. JavaScript is limited to those interactions, local documentation search, code copying and reading-position hints. Fonts and assets are local. No React, animation framework or graphics runtime is shipped to the browser.

Documentation is generated from an explicit list of canonical repository files. Edit those files and rerun the command; `.generated` is disposable. See [website maintenance and hosting](../docs/WEBSITE.md) for commands, origin configuration, content flow and deployment headers.

Framework references: [Astro content loaders](https://docs.astro.build/en/reference/content-loader-reference/), [static deployment](https://docs.astro.build/en/guides/deploy/) and [Astro 7 Markdown behavior](https://docs.astro.build/en/guides/upgrade-to/v7/). Dependencies are pinned in the separate Bun lockfile. Install the site dependencies before its own check/format scripts; the application can still be developed independently.
