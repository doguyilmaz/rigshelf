# Product brief

Working name: **Kitfold**. A private, local workbench for the capabilities and instructions used by coding agents. Naming is provisional; package and trademark availability have not been established.

## Product promise

Choose a project, review its suggested kit, select your agents, apply. The library can be large; the active project kit should be small. A skill stored in the library is never automatically exposed to every agent session.

No hosted registry, accounts, telemetry, conversation store, or required cloud service. Open-source application code and private user data have separate storage locations. Existing projects and agent configuration must survive setup and updates.

## Complete request ledger

Each requirement retains an identifier so implementation and deferred work can be checked against the original request.

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| R01 | Central skill library | Import local and upstream skills; deduplicate while retaining source, versions, and installation locations. |
| R02 | MCP library | Model stdio and remote MCP definitions, project/global scope, environment requirements, and agent compatibility. No credentials in exports. |
| R03 | Reusable presets | Create, edit, duplicate, remove, and apply presets. Support inheritance and manual overrides. |
| R04 | Stack hierarchy | General → domain → platform/framework → project. Cover mobile, bare React Native, Expo, iOS SwiftUI/Objective-C, Android Kotlin, macOS, web, API/backend, Go, JS/TS, Bun, Hono. |
| R05 | Requirement-driven setup | Detect manifests and dependencies; show reasons for each recommendation; accept written requirements and manual selections. Greenfield and existing projects supported. |
| R06 | Agent selection | Claude Code, Codex, Kiro, OpenCode, Antigravity, Grok. Keep model providers separate from agent harnesses; Ollama is a model endpoint. |
| R07 | Provider adapters | Render canonical skills, directives, and MCP into supported project layouts. Explicitly report unsupported capabilities; do not invent formats. Preserve supporting resources. |
| R08 | Installation methods | Prefer bunx skills add. Retain recipes for npx, Git/local copy, plugin marketplaces, custom commands, and manual resources. Never silently run remote scripts. |
| R09 | Evolving upstreams | Track origin, ref, content digest, last check, update availability, and local modifications. Review changes before replacing a pinned version. |
| R10 | Directive system | Editable global/domain/stack/project rules with deterministic precedence, provenance, and conflict visibility. Generate managed sections in AGENTS.md/CLAUDE.md and supported provider rules. |
| R11 | Personal style | Concise replies; meaningful commit messages when commits are authorized; no leftover debug logging, explicit any, unexplained numbers, unreadable names, oversized functions, nested callbacks, or unhandled async failures. These are editable defaults, not universal hard errors. |
| R12 | Learning loop | Propose reusable lessons from project directives/memory; preserve provenance; user-editable approval before promoting project-specific content to shared rules. No session transcript collection. |
| R13 | Dependency hooks | On dependency changes, recommend relevant library entries (e.g. better-auth). Bounded, debounced, idempotent checks. Safe auto-apply limited to explicitly enabled, trusted items. |
| R14 | Periodic discovery | Optional skills.sh/find-skills/source checks. Queue suggestions, never continuously expand context or run network jobs without configuration. |
| R15 | Web UI and CLI | Local web workbench plus scriptable CLI, both using the same engine. Search, filters, source/project/custom groupings, tags, and keyboard-friendly controls. TUI is optional. |
| R16 | Integrated editors | Edit custom skills, presets, relationships, tags, and directive text. Show memory/instruction files without treating them as conversations. |
| R17 | Local audit/import | Inspect all projects under ~/Developer and global skills; record installation relationships. Do not modify or uninstall originals during discovery. |
| R18 | Public resources | Preserve every supplied link/command/note. Research and classify as skill, MCP, plugin, CLI, docs, or unresolved reference. Do not mistake a blog or tweet for an installable skill. |
| R19 | Custom content | Dedicated custom grouping; origin and local modifications remain visible. Custom items must be exportable. |
| R20 | Trust | Separate publisher/source verification, directory listings, local inspection, and security scan status. No invented verified/security badges. Record evidence and date. |
| R21 | Security lifecycle | Scan imports/updates for risky instructions, scripts, secrets, traversal, symlinks, and dangerous recipes. Findings are heuristics, not a guarantee. |
| R22 | Data ownership | Versioned portable JSON/YAML-compatible data, explicit export/import, migration handling, local backups. Future Git/R2/object storage adapters; no public personal registry. |
| R23 | Project-first migration | Show global installations and project usage; preview migration and rollback. Do not remove global copies without a separate explicit action. |
| R24 | Clear relationships | Skill/source/project views without duplicate cards for symlinked copies. Permit manual correction of tags, scope, presets, and source relationships. |
| R25 | Runtime efficiency | Index metadata for lists; load full content on demand. No always-on LLM loop. Library size must not inflate generated agent context. |
| R26 | AI integration | MCP interface for catalog, requirements, suggestions, rules, and setup plans; explicit mutation boundaries. Use existing CLI logins; never read token stores or launch a paid model unexpectedly. |
| R27 | Reliability | Plan → inspect changes → apply atomically with backups → verify/rollback. Detect modified managed files, invalid input, and concurrent edits. Preserve unmanaged config. |
| R28 | Pleasant setup | Few clear steps, informative empty/loading/error states, accessible responsive UI, useful progress. No decorative fake metrics or nonfunctional controls. |
| R29 | Documentation | Written architecture, decisions, source research, threat model, test evidence, limitations, and continuing roadmap. |
| R30 | Independent setup product | Keep the implementation independent and do not import another product’s catalog. Inspect actual files directly. Backup is secondary; fast project setup across agent harnesses is primary. Possible future integration must not influence initial complexity. |
| R31 | Review visual alternatives | Show interactive layout alternatives and direct preview URLs before adopting a redesign. The product name remains provisional and requires a clear comparison of researched candidates. |
| R32 | Stable dialogs | Smooth open/close and editor replacement; stable frame during asynchronous content and tabs, one backdrop, preserved keyboard/focus behavior, and reduced-motion support. |
| R33 | Interface localization | English/Turkish now, with at least six complete languages required for the first public release. Persist the browser choice, preserve drafts, and never translate authored library or project content implicitly. |

## Interaction design

Primary action: **Set up a project**. Navigation: Setup, Library, Projects, Presets, Directives, Activity, Settings. A source is a collection; a skill is a capability; a kit is the small selection activated for a project. Keep those concepts distinct in the interface. Details use focused dialogs; setup uses a reviewable sequence. Trust labels describe evidence, not decoration. Backup never leads the experience.

Current implementation baseline, pending user review of the interactive alternatives: a quiet technical workbench with warm paper surfaces, deep ink, restrained copper accents, fine rules, generous space, readable typography, and small purposeful motion. Dense information belongs in searchable lists rather than an ocean of statistic cards.

## Architectural boundaries

- One domain engine serves CLI, web API, and MCP.
- Private catalog and original local content live outside tracked source (an ignored local workspace during development, an OS data directory in installed use).
- Canonical records are independent of provider paths. Adapters own output formats and capability limitations.
- File-based progressive disclosure is preferable to appending skill bodies to agent directives.
- Detection and recommendations are deterministic first. AI assists with proposals through an explicit selected runner.
- Source/install recipes are data. Importing an item never executes its recipe.
- Memory support is bounded file viewing/editing and reusable-rule proposals, not a session/context platform.
- Backup is user-controlled; hosted collaboration and public marketplace operation are outside the initial product.

## Decisions awaiting validation

Provider formats and upstream install commands change. Only documented mappings should ship as supported. The Grok adapter targets the official CLI; T3 uses its selected underlying harness. Agent hooks may require a restarted session; the UI must explain that newly written files are not guaranteed to hot-load.
