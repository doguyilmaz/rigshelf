# Contributing

Use Bun 1.4.4 or newer and the checked-in lockfile. Use `bun run check` for TypeScript and `bun run format` for formatting. Run `bun run verify`, `bun run lint`, and the browser flows before proposing behavior changes. Fixtures belong under ignored `.local/tests`; never use a real development repository, global agent configuration, account token or running external MCP server as test state.

Keep business logic in `src/core`. CLI, web and MCP should call that engine rather than implement alternate setup paths. Prefer small typed functions, explicit error states and meaningful boundary tests. A source URL or install recipe is untrusted data, never permission to execute code.

Provider adapters need primary documentation, conversion tests and explicit notes for capabilities that cannot retain their semantics. Do not replace an unsupported permission or invocation policy with a more permissive guess. Preserve unrelated configuration and supporting files.

Public changes must not contain real catalog files, project names, local paths, credentials, screenshots of private projects, or rollback preimages. Use fictional data in documentation and screenshots. Do not include third-party skill snapshots in this repository; retain authorship and license information in the private library.

Write change descriptions around the resulting behavior, its reason, validation, and material limitations. Avoid adding infrastructure, background model loops or public registry features without a concrete product need.
