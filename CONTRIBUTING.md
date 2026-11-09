# Contributing

## Run from source

Requires [Bun](https://bun.sh) 1.4.4 or newer.

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run dev` builds once, then watches the web assets and the server. When a new frontend build is ready, the workbench offers Reload and keeps unsaved drafts until you choose. `bun run build && bun run start` serves a production build. Use `bun run rigshelf <command>` to run the CLI from the checkout, or `bun link` to put `rigshelf` on your `PATH`.

## Checks

```sh
bun run format
bun run lint
bun run verify
bunx playwright install chromium
bun run test:ui
```

[Testing](docs/TESTING.md) lists what each check covers. Tests use temporary projects under the ignored `.local/tests` folder; never use a real project, your agent configuration, account files or a running MCP server as test state. Don't rebuild `dist` while the UI suites are running.

## Code

- Business logic lives in `src/core`. The CLI, web API and MCP call that engine instead of implementing their own setup paths.
- Validate untrusted input at boundaries. A source URL or install recipe is data, never permission to run code.
- Agent adapters follow the vendor's documentation (see [agent contracts](docs/AGENT-CONTRACTS.md)), have conversion tests and report what they cannot express. Never replace an unsupported permission or invocation policy with a more permissive guess, and keep unrelated configuration intact.
- When an integration contract changes, update [MCP](docs/MCP.md), [compatibility](docs/COMPATIBILITY.md) and the [integration Skill](plugin/skills/rigshelf/SKILL.md).

## Content

Use fictional data in tests, documentation and screenshots: no real catalogs, project names, local paths, credentials or screenshots of private projects. Don't add third-party Skill snapshots to the repository.

The website in `site/` has its own dependencies and checks; see [website](docs/WEBSITE.md).
