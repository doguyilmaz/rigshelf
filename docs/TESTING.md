# Testing

| Command | What it checks |
| --- | --- |
| `bun run lint` | Biome formatting and lint rules for the app, tests, scripts and website. |
| `bun run verify` | Strict TypeScript, English/Turkish catalog parity, unit and integration tests, production build. |
| `bun run test:ui` | Chromium flows for every workbench area: setup, Library, Presets, AI drafts, backups, machines, localization, layout at phone and desktop widths, and Axe accessibility checks. Requires Chromium (`bunx playwright install chromium`). |
| `bun run test:package` | Builds a release archive and smoke-tests the CLI, workbench, API and stdio MCP from an unrelated directory. |
| `bun run site:check`, `bun run test:site` | Website type check, internal links, responsive and accessibility checks, JavaScript-free navigation. |

CI runs `lint`, `verify` and `test:ui` for the app, and the website checks for the site.

## Isolation

Tests create temporary projects, homes and catalogs under the ignored `.local/tests` folder. They never read or write your real projects, agent configuration or account files. Browser screenshots and reports go to the ignored `.local/qa` folder.

## Limits

Passing tests show the exercised behavior works; they do not prove imported content is safe. Agent formats are tested against fixtures that follow each vendor's documentation, not against every agent version. Live GitHub, S3-compatible storage, Windows and each native agent combination need their own acceptance before you rely on them.
