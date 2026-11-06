# Rigshelf experience brief

Branch: `experience/project-first`. Baseline: `main` at `1fad90c`. The baseline branch remains unchanged and recoverable. This is a new product direction, not an approved public release or name registration.

## Product decision

Rigshelf prepares the coding agents for the project a person is working on. The daily entry point is a project, not a catalog or an administration dashboard. A large private collection supports a small, deliberate active setup. Skills, MCP, Plugins, Presets and guidance keep distinct meanings. AI helps users express intent, discover matching existing material and prepare drafts; generation never becomes permission to save or apply.

The visible journey is: choose a project → understand the suggested setup → choose actual agent Harnesses → review file changes → apply → know how to use the result. Returning to a project restores its actual reviewed choices where available. An observed install, a repository manifest and a private ownership receipt remain different evidence.

## Brand and visual direction

Name: **Rigshelf**. A rig is a fitted working setup; the shelf is the reusable source material behind it. Public exact-name searches and primary npm/GitHub/.dev RDAP lookups on 2026-11-05 found npm 404, zero repository-name matches and domain-record 404. These are dated observations, not exclusivity, reservation or trademark clearance. No external service is registered. Checks: [npm](https://registry.npmjs.org/rigshelf), [GitHub API](https://api.github.com/search/repositories?q=rigshelf%20in%3Aname), [domain record](https://pubapi.registry.google/rdap/domain/rigshelf.dev). Riglane, Harnest, Tackroom, Tackline and Rigsmith were rejected after finding overlapping developer/agent products. Fettled was rejected for ambiguity with existing Fettler products.

A quiet, precise desktop instrument: neutral paper/white surfaces, charcoal actions, purposeful typography, restrained borders, obvious hierarchy, compact navigation and useful space. No decorative green/purple themes, statistical filler, glowing AI controls, fictitious trust badges or giant blank administration panels. Typography assets must have distributable licenses and load locally. The logomark is custom, legible at small sizes and independent of the prior identity.

Motion explains a state change or preserves continuity. Repeated keyboard actions are immediate; occasional panels use short opacity/transform transitions with reduced-motion support. Dialogs retain their frame and focus. No animation blocks an action.

## Experience audit and decisions

| Before | After | Why |
| --- | --- | --- |
| Seven equally weighted management pages | Project-first home/workspace, Library and Defaults with secondary utilities | Users know where to begin and return every day |
| Project setup starts with a directory form and detached controls | A clear project invitation, recent projects, read-only inspection and one coherent kit canvas | The task is visible before configuration |
| Agent choice is hidden below the kit | Harness choices are visible with a concise explanation and real saved kit defaults | Multi-agent setup is the primary job |
| Skills/MCP rows mix type, descriptions and operational detail | Distinct kit sections with inclusion reasons, source grouping and a clear review action | Users can understand and adjust what is selected |
| AI is a generic extra button opening a large form | Contextual intent entry, useful examples, remembered available Provider and a readable proposal | Expressing intent should be easier than filling structured fields |
| New users must infer how catalog storage differs from activation | First-use actions explain import, project selection and review in context | No tutorial reading should be required for the first safe setup |
| Success ends with generic reload advice | A project-specific handoff showing Harnesses, written locations, next action and recovery access | Completion must lead to actual use |
| Snapshot, permission and scanner details compete with the main task | These remain available at the decision that needs them | Progressive disclosure preserves accuracy without burdening every screen |
| A draft survives navigation but disappears on reload | Bounded current-tab draft recovery with fresh inspection before review | Daily work must survive ordinary reloads without importing authority |
| A full collection feels like an unstructured registry | Source groups, independent facets, project usage and direct link/note intake | Large private collections must remain navigable without remembered names |

## Required outcomes

1. A first-time user sees one obvious way to prepare a project, can browse to a folder, understands the read-only inspection and reaches a readable setup review without reading documentation.
2. A returning user can search/select a recent project, see factual previous setup information and continue with preserved exact revisions and actual selected Harnesses. Dates do not imply that files are currently in sync.
3. A user can describe an Expo/React Native, Apple native, Android/Kotlin, macOS, web or backend project; recommendations and Presets remain stack-aware, and unknown stacks have a useful explicit path.
4. Source notes/links/commands enter through a simple intake with AI assistance or deterministic parsing; imported installer scripts, modules and Hooks never execute during preview.
5. Custom Skills/MCP/directives and Presets can be created, edited, grouped and revised without losing resources, lineage, source relationships or installed pins.
6. Global/project scope, Plugin evidence, compatibility gaps and missing credentials are understandable at the action that depends on them. Native Plugin activation is not falsely claimed by portable Skill setup.
7. Project guidance and memory can be inspected without importing conversations. Reuse/promote actions expose project/broader scope and preserve source files.
8. Automation remains optional per project, requires current exact approvals, has clear status/revocation and does not silently grow context.
9. Library maintenance, source updates, suggestions, history and recovery lead back to a particular project/task. Background work reports progress and useful next steps; cancelable operations drain their owned work, while graceful shutdown completes active inventory/file operations.
10. English and Turkish retain technical vocabulary. Remaining release locales are tracked explicitly; untranslated authored content stays intact.
11. The app is light, responsive, keyboard-usable and reliable with a large catalog, long paths/names, empty states, narrow/short windows, reduced motion, interrupted requests and absent native Providers.
12. Public source contains no private inventory, source content, screenshots or machine paths. Existing catalogs, portable schema-1 archives, CLI/MCP clients and project manifests remain readable through the rename.

## Scope and architecture

The existing Bun/TypeScript domain engine, immutable snapshots, private ownership, reviewed plans, locks/journals/recovery, scoped automation and guarded read paths remain the implementation foundation. New experience code must not substitute inference for these boundaries. CLI, HTTP and MCP continue to share domain behavior. New brand-facing commands may be aliases; portable format keys, current storage and native project records are compatibility contracts and are not mechanically renamed.

Existing repositories/global agent installations are read-only sources. All setup/rollback/automation tests use isolated fixtures. Comparison must not accidentally apply a baseline fixture plan to a real source project. No package/domain/publication operation is authorized by this brief.

## Work sequence

- [x] Preserve baseline, create the new branch, review requirements, screen a new brand and document this brief.
- [x] Implement brand assets/tokens, a new application shell and a project-first entry point.
- [x] Build a coherent project workspace with visible Harness selection, clear kit composition and contextual guidance.
- [x] Improve AI intake/proposals and first-run Provider setup without mandatory cloud accounts or surprise generation.
- [x] Make returning-project defaults, draft recovery, success/handoff, compatibility and recovery understandable.
- [x] Connect Library/source intake, Presets, directives, memory and maintenance to the daily workflow.
- [x] Exercise realistic first-time/returning flows, large catalogs, multi-agent review/apply/rollback, empty/offline/stale states, locales, responsive behavior and motion.
- [x] Perform focused source/data/security review, required check/format/verify/lint/UI suites, and document limits/evidence.
- [x] Produce a concrete comparison/run path and a concise handoff with meaningful grouped commits.

## Requirement traceability

The complete original ledger R01–R29 remains in PRODUCT.md, and subsequent requests R30–R47 remain in ACCEPTANCE.md. Every row remains applicable. This brief adds R48: a new branch, independent rebrand and coherent premium daily experience with usable first-run/returning flows. A visual refresh alone cannot satisfy R48. Unfinished items stay explicit rather than being labelled complete by a passing fixture.

## Run and compare

Use `bun run dev` on `experience/project-first` and open the private terminal URL. `bun run start` uses an existing build; use `bun run build` after changing the web source. Default-port collisions move to another loopback port; explicit `--port` does not move. Stop with Ctrl-C. The new command is `bun run rigshelf`; `kitfold`, `.kitfold/kit.json`, MCP tool names, portable schema-1 keys and the original private data directory remain compatibility contracts. No global configuration or data migration is performed.

The baseline is preserved as `main` at `1fad90c`. After saving unrelated work, stop the server, `git switch main`, `bun run build`, then `bun run start` to use the former interface. Return with `git switch experience/project-first` and rebuild. Both use the same compatible private catalog unless `KITFOLD_DATA_DIR` is explicitly changed. Comparing screens does not authorize Apply, automation or source changes. Legacy layout-study URLs are historical prototypes; they are not the current product journey.

## Current implementation notes

The first-use source flow stays in the project: filtered Library selection → Find more tools → related/all saved repositories, link/AI/local/MCP intake → individual immutable Skill import → exact selected pin → review. Source detail now pages beyond 40 Skills instead of silently truncating at 100. Importing a definition never starts its MCP server or executes its supporting scripts.

Unfinished setup choices are optional bounded current-tab recovery, not a memory system. Fresh inspection is required, missing selections remain visible, and no plan, reviewed flag, replacement consent, authority record or model conversation is stored in the recovery draft. Explicitly applying clears it. Returning-project choices come only from private directory-bound ownership, not a copied repository manifest.

The project inspection view now begins with Prepare and an explicit dependency check. Suggestions lead back to a particular project rather than remaining raw event text. Classification is optional, history search/paging exposes older plans, and successful imports that finish after leaving their editor stay in Library without changing the abandoned kit. Ollama model selection uses explicit metadata discovery with manual fallback, empty/offline feedback and reported remote-routing information; it does not run a model on opening a form.

Library now carries the current project context and can send one explicitly inspected Skill/MCP revision back to that kit. Requests bind to one project and are consumed once; dirty metadata still requires an explicit dismissal. Archived-only collections have a recoverable Show all action. Browser storage failure is visible, and oversized temporary selections can be recovered for trimming while plans remain capped at 100 items. Shared defaults and known project classification changes invalidate retained inspection.

Fresh explicit Presets supply Harness defaults, while manual/recovered/reviewed choices take precedence. An explicit Use Preset Agents action changes those choices. Duplicate retains edited selectors/stack tags/pins; new same-name definitions use a distinct ID and create-only transactions preserve existing records. Preset pins page through the full matching list rather than silently stopping at 60.

The final review covers 183 unit/integration tests and eighteen browser suites, including responsive/motion/keyboard behavior, first-use collection, exact returning choices, concurrent definitions, copy fallback, inventory shutdown, client disconnects and multi-connection import reconciliation. Read-only MCP can explicitly restore private returning choices, and the integration Skill routes setup, checked definition maintenance and pending draft proposals separately. The real CLI startup/access/SIGTERM flow is tested against an isolated catalog. Validation and focused source review retain their practical limits in VALIDATION.md and SECURITY-REVIEW.md.

Remaining release decisions are explicit: Rigshelf is a working identity; four additional languages must pass the six-language public-release gate; live vendor/platform acceptance remains separate from fixture tests. Native Plugin execution/conversion and arbitrary session injection are not claimed. External development repositories and global agent installations remained read-only during this branch's QA, and no service/package/domain was published or registered.

Multi-instance server reuse is a future reliability consideration; any implementation must verify catalog/server identity before sending or displaying a persistent access key. It must not probe another user's listener with credentials or infer ownership from a port/PID alone. Current fallback selects a free loopback port and prints the actual private URL; an older saved tab may still belong to an older server.
