# Contributing

Use Bun 1.4.4 or newer and the checked-in lockfile. Use `bun run check` for TypeScript and `bun run format` for formatting. Run `bun run verify`, `bun run lint`, and the browser flows before proposing behavior changes. Fixtures belong under ignored `.local/tests`; never use a real development repository, global agent configuration, account token or running external MCP server as test state.

`bun run dev` builds once, then watches web assets and the Bun server. A new frontend build offers an explicit Reload action in the workbench, preserving unsaved drafts until you choose. Use `bun run dev --port 47500` for an explicit port. Watch builds keep previously referenced hashed chunks until the next clean development start; the production build cleans `dist`. Ctrl-C stops both owned processes. `bun run start` serves the existing `dist`; rebuild first when changing the interface. Install Chromium explicitly with `bunx playwright install chromium` before the UI suites. Never rebuild `dist` while those suites are loading its chunks.

Keep business logic in `src/core`. CLI, web and MCP should call that engine rather than implement alternate setup paths. Prefer small typed functions, explicit error states and meaningful boundary tests. A source URL or install recipe is untrusted data, never permission to execute code.

Provider adapters need primary documentation, conversion tests and explicit notes for capabilities that cannot retain their semantics. Do not replace an unsupported permission or invocation policy with a more permissive guess. Preserve unrelated configuration and supporting files.

Public changes must not contain real catalog files, project names, local paths, credentials, screenshots of private projects, or rollback preimages. Use fictional data in documentation and screenshots. Do not include third-party skill snapshots in this repository; retain authorship and license information in the private library.

Write change descriptions around the resulting behavior, its reason, validation, and material limitations. Avoid adding infrastructure, background model loops or public registry features without a concrete product need.

The separate Astro website has its own dependencies and check/format scripts. See [website development](docs/WEBSITE.md) for the static content pipeline, browser verification and hosting policy. Never copy private application state into a public site fixture.

When changing an integration contract, update [MCP documentation](docs/MCP.md), [compatibility](docs/COMPATIBILITY.md) and the [integration Skill](plugin/skills/rigshelf/SKILL.md) where relevant. See [maintenance](docs/MAINTENANCE.md) for source checks and immutable revision handling. Public docs describe available behavior and explicit limitations; do not publish private inventory counts, source receipts or QA evidence.
