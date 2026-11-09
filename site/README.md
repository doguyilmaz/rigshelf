# Rigshelf website

The landing page and documentation, built with Astro. The site is static and never connects to a running workbench.

```sh
# From the repository root
bun install --cwd site --frozen-lockfile --backend=copyfile
bun run site:dev
```

The site runs at `http://127.0.0.1:4321`. `bun run site:build` writes `site/dist`, `bun run site:preview` serves it, and `bun run test:site` runs the browser checks.

Guides are generated from the documents listed in `src/docs.ts`; edit the files in `docs/`, not `.generated`. See [website](../docs/WEBSITE.md) for checks, hosting and design notes.
