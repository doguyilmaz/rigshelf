# Rigshelf development

Rigshelf sets up coding agents per project. The private library is separate from activation. Backup is secondary. Keep the primary flow simple: choose a project, review a focused kit, choose harnesses, inspect the plan, apply.

Keep the Rigshelf name, mark and visual identity (Instrument Sans, Newsreader, neutral surfaces) unless a change is requested.

## Boundaries

- Share domain behavior between CLI, HTTP and MCP. Provider adapters own documented native formats and explicit compatibility gaps.
- Keep snapshots immutable. Preserve supporting resources, executable intent, historical receipts and custom lineage.
- Repository manifests are data, not proof of ownership or automation permission. Private ownership records bind reviewed kits to directory identity.
- Never execute an imported installation recipe, skill script or plugin hook merely to inspect it.
- Keep credentials outside portable definitions. Do not inspect account token stores or collect conversations.
- Preserve unrelated configuration and authored guidance. Project writes use reviewed plans, preconditions, locking, journals and recovery.
- Automatic additions need current project approval and exact clean snapshot approval. Revocation must stop and drain pending work. Automatic additions preserve existing guidance.
- Do not claim that source reachability, directory popularity, a content heuristic or a passing test establishes safety.

## Engineering

Use strict TypeScript and validate untrusted input at boundaries. Prefer descriptive names, focused functions, named limits and explicit async error handling. Extract meaningful logic and UI components instead of introducing generic frameworks for one-off operations. Avoid explicit `any`, leftover debug logging and unrelated dependencies.

UI copy and public documentation are English. Use neutral white/gray surfaces, readable local fonts, accessible controls and responsive lists. Keep labels concrete; avoid decorative green/purple themes, marketing slogans and ambiguous mixed filter dimensions. Keep editors practical and light. Private filesystem paths, project inventories, imported content and screenshots never belong in public source.

Localized interfaces preserve technical vocabulary such as Skills, MCP, Plugins, Agent, Harness, Preset, Snapshot and Provider. Translate the surrounding interface copy; follow the terminology policy in `docs/LOCALIZATION.md`.

## Verification

- Use `bun run check` for TypeScript checks and `bun run format` for formatting; use these package scripts instead of ad-hoc compiler/formatter invocations.
- Run `bun run verify` and `bun run lint` for implementation changes after formatting.
- Run `bun run test:ui` for visible web changes. Chromium must already be installed, or install it explicitly as documented.
- Add tests for meaningful authority, lifecycle, data-integrity or user-flow changes. Avoid tests that merely repeat implementation details.
- Use isolated fixtures under ignored `.local/tests`. Never use real projects or global agent configuration as test state.
- Keep screenshots and reports in ignored `.local/qa`.
- Update compatibility, data and agent-contract documentation when their contracts change. Do not promise support for an undocumented harness feature.

Do not commit, publish, register services or delete global installations without authorization.
