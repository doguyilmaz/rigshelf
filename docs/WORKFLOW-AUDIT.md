# Workflow verification

This record tracks the project-management and AI-authoring review started on 2026-11-08. Existing development repositories, global installations and account stores are not test fixtures. Runtime evidence belongs under ignored `.local/qa`; temporary projects and homes belong under ignored `.local/tests`.

Passing fixtures establish the exercised behavior, not universal discovery, vendor compatibility or content safety. Ordinary development tests and live vendor acceptance are recorded separately from qualified security reproductions.

## Acceptance cases

| Area | Required outcome | Status |
| --- | --- | --- |
| New and existing projects | Inspect a temporary project, select a focused kit and Harnesses, review a plan, Apply, reopen and recover without touching other projects. | Passed isolated lifecycle/setup fixtures. |
| Install/remove/rollback | Preserve authored guidance, unrelated configuration, Skill resources and executable intent; remove only owned unchanged content; retain recoverable history. | Passed, including one six-Harness install/revise/remove/rollback journey. |
| Updates | Detect an upstream change, show its difference, create an immutable revision, deliberately upgrade a project and retain old pins/rollback. Missing or unknown version evidence stays explicit. | Passed deterministic remote-revision fixtures and kit revision-switch UI. |
| Discovery | Find gitignored project Skills/MCP/guidance/memory and project memory outside the repository; separate global, profile and project scope; preserve previous evidence after incomplete scans. | Passed existing discovery/partial-retention fixtures and custom-profile project-memory case. |
| Profile managers and custom locations | Identify Aims/profile/environment origins, preserve aliases and offer an explicit way to include documented/custom AI locations without searching credentials or conversations. T3/Omni names alone are not a storage contract. | Added explicit native-format roots and origin inspection; fixture UI/domain checks passed. |
| AI authoring | Start from a link, installation command, notes or MCP definition; choose an available Provider and a suitable lightweight model; preview, adopt and save explicitly. | Fixture-driver journeys passed; account-backed vendor generation was not run. |
| Local Agent integrations | Check installed CLI capabilities and documented isolation controls. Implement unattended runners only where native tool/config controls can be established; expose connected-Agent routes and exact gaps otherwise. | Installed help checked; Claude/Codex direct adapters retained, other Harnesses have in-panel read-only MCP connection help. |
| Source intake | Research an explicitly supplied supported source, preserve exact provenance and resources, show what will be saved, and keep catalog save separate from project activation. | Added no-model/no-network source preview; GitHub research/import/resource/pin fixtures passed. Arbitrary website scraping is not supported. |
| Lifecycle and privacy | Cancel/drain work, reject stale results, mask credentials, bound reads/output and avoid executing imported installers or Hooks during inspection. | Cancellation/stale/masking/authority regressions passed; scoped source review found no retained new security finding. |
| UI and DX | Exercise complete user journeys, useful errors, recovery, model selection and navigation in isolated browsers; keep English/Turkish technical vocabulary intact. | New responsive/Axe journeys passed; final complete UI rerun recorded below. |

## Initial source observations

- AI authoring initially provided native Claude/Codex, Ollama, compatible API profiles and connected-Agent MCP requests. Kiro/OpenCode/Antigravity used connected-Agent routes rather than unattended native runners.
- AI source formatting turned supplied links/commands into fields; source research and import were later explicit steps. It did not read arbitrary supplied websites during generation.
- Claude/Codex model fields could remain empty and inherit the native default, without a visible lightweight choice.
- Discovery had explicit default/environment/Aims roots and bounded known AI layouts. Undocumented application stores and conversation databases were excluded; additional storage coverage needed an explicit, testable route.

## Changes made

- Added **Snapshot for …** inside selected project kit rows. Choosing a saved revision updates only the draft; Review setup shows the file difference before Apply. Refreshing Library retains exact previous choices.
- Added twenty optional machine-local AI configuration roots with a directory picker and native-format selector. Known native locations and full-path project-memory rules are reused. Source files are read-only, private/runtime roots are excluded, unavailable custom folders produce warnings, and portable exports contain no custom-root paths.
- Added deterministic source preview and a direct link/command route from the AI panel. Parsing uses no model/network/installer; explicit save/research/import remain separate.
- Added Haiku/Sonnet and Luna/Terra suggestions, exact model IDs, per-Provider panel preferences and an explicit Provider default. Codex drafts request low reasoning effort. A real UI failure exposed stale model-control state across Provider changes; keyed controls and a switch-away/back regression now preserve the choice. An explicit saved default is also verified in a fresh browser context.
- Added native-format read/plan MCP connection help inside connected-Agent panels. It neither enables write tools nor claims to select another Agent's running model.
- Missing production asset chunks now return HTTP 404 instead of a successful HTML response masquerading as JavaScript. During manual development QA, rebuilding assets underneath an older open tab required its existing explicit Reload action; builds are kept separate from the final browser run.

## Evidence and limits

`bun run verify` passed strict TypeScript, 1,310 English/Turkish messages, 258 unit/integration tests across 39 files and the production build. `bun run lint`, Astro check/build and the locked dependency audit passed; the dependency audit returned no known advisory. The new browser journeys cover source previews at 1440/768/390/320px, connected-Agent and custom-folder views at desktop/320px, Turkish controls, explicit AI adoption/save, exact model requests to a fixture driver and exact kit revision selection.

Final complete UI suite status is recorded in [validation](VALIDATION.md). Private evidence stays in `.local/qa/workflow-audit`, `.local/qa/daily-workflows` and the existing per-suite directories. These are normal development checks. The earlier qualified security evidence remains separate in [security review](SECURITY-REVIEW.md).

All 24 UI suites completed in one final run. Portable and native macOS arm64 packages were also built and smoke-tested in a disposable checkout, covering manifests/checksums, an unrelated working directory, CLI/compatibility launcher, exact UI assets, private API access, real stdio MCP and its filtered bridge. The workflow acceptance document is now included in the package's explicit public-document list. Existing release archives were not overwritten, nothing was published, and the disposable dependency/build copies were removed after the check.

No live model billing/authentication request, native Plugin installer, imported recipe, real project setup, backup upload or global installation change was performed. Installed Claude/Codex/Kiro/agy/OpenCode help is metadata evidence only; Ollama's binary was absent during inspection, and its service/model state was not inferred from that. Direct unattended Kiro/OpenCode/agy runners still require accepted isolation and live platform/account coverage. Their current route is an explicitly connected MCP session, with model choice owned by that Agent. Unknown manager databases and current versions of remote MCP servers/native Plugins are not asserted as covered or up to date.
