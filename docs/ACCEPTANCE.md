# Acceptance record

## Remote backup and daily-flow review

Settings now opens a dedicated Backups workspace with selected GitHub/S3/R2/MinIO connections, environment-reference guidance, explicit tests, searchable reviewed changes, Sync receipts, separate PR merge/closure and integrity-checked history/restore. The same engine serves HTTP, CLI and MCP. Destination authoring stays outside MCP; imports never restore project authority. Review, conflict, cancellation, uncertain outcome and frozen retry are separate states. [Backup documentation](BACKUP-SYNC.md) records current limits and provider acceptance.

The daily-flow review revisits setup/returning projects, acquisition/AI drafts, large grouped libraries, filters, defaults, file reading, recovery, localization and responsive controls. The development command now watches frontend and backend, offers an explicit reload notice and preserves unsaved drafts. An isolated checkout fixture runs the actual dev command and both watchers. See [review findings](PRODUCT-REVIEW.md), [verification](VALIDATION.md) and [security scope](SECURITY-REVIEW.md).

## File reading follow-up

Project inspection opens a dedicated Files workspace. File navigation and the reader have independent scroll areas; content never appears below the full inventory. Project setup, classification and automation remain reachable in a separate section. The same list/reader layout handles Skill supporting files, with search and bounded rendering.

Narrow screens show one pane at a time with explicit list/reading actions. Switching panes preserves search, selection, both scroll positions and keyboard focus. Read errors have an inline retry, obsolete read responses cannot replace a newer selection, and file switching/closing preserves draft-discard checks. Viewing global or external guidance does not enable editing; project edits still require reviewed plans and supporting-file edits create new Snapshots.

Normal-motion browser fixtures exercise 522 project files and 521 Skill files, desktop/mobile/short-window layouts, English/Turkish copy, keyboard scrolling, reader/list geometry, delayed reads, inline failure recovery and immutable data preservation. See [validation](VALIDATION.md) for scope and limits.

## Rebrand compatibility follow-up

Fresh catalogs use the Rigshelf directory; existing legacy catalogs retain their actual path with an English/Turkish explanation. Conflicting default catalogs require explicit selection rather than an implicit merge or empty replacement. Isolated fixtures retain Snapshot/resources/recovery content and verify explicit override precedence. New connection snippets and MCP handshake labels use Rigshelf; the old executable/environment, MCP tool names, portable format keys and project ownership/recovery identifiers remain compatible. Current naming/run instructions distinguish these choices from historical candidates. See [the brand audit](BRANDING.md).

## UI stability, own AI and backup follow-up

The Library uses explicit deterministic tie-breakers for equal names, dates and usage counts. Normal-motion browser cases check editor frames, page scroll, focus recovery and item order across tab changes, viewport changes, closing/reopening and catalog refresh. Existing English/Turkish terminology checks preserve Skills, MCP, Plugins, Agent, Harness, Preset, Snapshot, Provider and other documented technical terms.

Saved local/remote Chat Completions profiles are available in Settings and authoring panels. Endpoint selection is explicit, authentication uses server-only environment references, redirects are refused, response bodies and generation lifecycle stay bounded, and proposals still require adoption/save. Protocol fixtures do not establish live vendor acceptance or guarantee local model routing.

Backup review compares an earlier export, shows record changes/exclusions, refuses a stale reviewed download and emits one portable archive. It does not import its comparison baseline. GitHub PR/merge and S3-compatible publication are now available under [the batch-sync contract](BACKUP-SYNC.md); the remote-backup follow-up supersedes the earlier local-export-only limit. Four additional interface locales, live provider acceptance and cross-platform acceptance remain release work.

The implementation follows the [request ledger](PRODUCT.md). This record distinguishes implemented behavior from operating limits. It does not claim defect-free software or manual certification of every vendor CLI release.

| Requirement | Implemented behavior and evidence |
| --- | --- |
| R01 | Immutable multi-file snapshots, source families, versions, provenance and installation locations. Ingestion, library and rescan tests cover deduplication and preservation. |
| R02 | Canonical stdio/HTTP/SSE definitions, project/global locations and sanitized environment requirements. Native adapters and the bridge are exercised with fixtures. |
| R03 | Preset create/edit/duplicate/delete, inheritance, pins and exclusions. Explicit pins page beyond 60, remain selected under filtering and are retained beyond the small automatic recommendation limit. Duplicate preserves edited selectors/stack tags; new same-name definitions cannot overwrite existing IDs. Fresh explicit Presets supply Agent defaults while deliberate/recovered/reviewed choices remain explicit. |
| R04 | Seventeen presets cover the requested mobile, Apple, Android, web and backend branches, plus common CLI/JVM/Astro workflows. Classification is editable. |
| R05 | Manifest/workspace detection (including `package.json` workspaces, `pnpm-workspace.yaml`, Python `pyproject.toml`/`requirements.txt`, Go modules, Unity projects, AWS CDK apps, and first-level packages when the root has no manifest), requirements, recommendation reasons, manual selections and new/existing directories. Exact technology matches precede overlapping alternatives; a dependency matches whole name parts, and a single-word dependency matches inside a longer name only when it is a detected stack. |
| R06 | Six documented project Harness mappings. T3 model choice is separate from its Harness. Authoring can use native Claude Code/Codex generation, local Ollama or connected-Agent MCP proposals; other unattended runner formats remain explicit gaps. |
| R07 | Resources, executable modes, invocation-policy checks, native MCP conversion and explicit bridge requirements. Unsupported semantics are reported or refused. |
| R08 | bunx/npx, marketplace, CLI, curl and manual recipes remain data. GitHub snapshots and local imports never execute installers or hooks. |
| R09 | Immutable commit/content pins, dated checks, indexes, latest snapshot fetches and before/after plans. Unchanged content retains historical commit receipts. Installed pins change only through setup. |
| R10 | Scoped, prioritized, editable directives with provenance and managed instruction blocks. Findings are visible; credential-looking guidance is blocked. Semantic contradictions require human/AI review. |
| R11 | Editable communication, engineering and typing defaults. Strict TypeScript and Biome reject explicit any and debug logging in maintained source. |
| R12 | Bounded project instruction/memory viewing, digest-bound edit plans, exact rollback and scoped reusable guidance. No transcript or session store. |
| R13 | Debounced root/workspace watchers. Automatic additions require private ownership, current project permission and an exact approved clean snapshot. Revocation cancels/drains work; existing guidance is preserved. |
| R14 | Opt-in public queries and periodic known-source checks. Dated results remain suggestions; no background model loop. |
| R15 | Functional local English/Turkish web UI, CLI and stdio MCP share one domain engine. A separate TUI is optional and is not shipped. |
| R16 | Custom metadata/content/resource revisions, resource add/remove, tags/source relationships, presets, directives and protected drafts. Browser flows exercise the management controls. |
| R17 | Actual development/global files are inventoried read-only, including plugin caches and Claude user-level project MCP sections. Setup tests use isolated fixtures. |
| R18 | Every supplied reference is retained in data/resource-notes.txt. Public collections are indexed. Missing images, ambiguous names and social posts remain references rather than invented skills. |
| R19 | Custom grouping, forks, lineage, archives, protected purge and portable copies. Upstream bytes and installed pins survive edits. |
| R20 | Reachability, source metadata, popularity, findings and owner approval remain separate. No fabricated verified/safe badge. |
| R21 | Import/update scans, path/link checks, digests, bounded parsing, placeholders and dependency auditing. Independent source-review evidence is separate from normal development tests. |
| R22 | Versioned UTF-8 JSON/gzip, transactional validation, conflicts and exclusion reports. No hosted registry or mandatory Git/object-storage service. |
| R23 | Global/project/library-only filters and project setup/rollback support gradual migration. Global removal remains a separate owning-harness action; archive visibility never deletes installations. |
| R24 | Source/name/version families, project grouping, manual relationships and normalized portable-name conflict checks. |
| R25 | Metadata lists, bounded lazy MCP reads, small kits, paginated library/projects and no continuous LLM. Real-library round trips and 1,284-row UI fixtures are exercised. |
| R26 | Read/plan MCP by default, explicitly writable/root-scoped connections, source/rule/preset/custom operations and per-harness snippets. No CLI token-store access. |
| R27 | Read-only planning, private ownership, preimages, locks, atomic file replacement, compensation, crash recovery and rollback. Later edits and replacement roots are protected. |
| R28 | Keyboard navigation, native focus-managed dialogs, loading/error/empty states, mobile layouts, reduced motion and draft protection. Accessibility and stress checks supplement visual inspection. |
| R29 | Product, architecture, compatibility, data, research, naming, validation, contribution and security documents. Private inventories and audit work stay outside published source. |
| R30 | Independent setup product. No abandoned catalog import or backup-first architecture. |
| R31 | Three interactive prototypes, an inline visual comparison and separately addressable built preview URLs. Those layout studies belong to the preserved baseline; the independent Rigshelf direction is recorded under R48. |
| R32 | Stable editor frames, retained exit presence, a shared backdrop, inert exiting controls and native focus restoration. Browser tests exercise delayed content, tabs, close and editor replacement. |
| R33 | Browser-persisted English/Turkish UI with lazy Turkish loading, matching catalogs, interpolation checks, localized dates/counts and cross-tab updates. Six-language release work is tracked in [localization](LOCALIZATION.md); the remaining four are not shipped yet. |
| R34 | Family-based search/filter engine, separate item/source views, visible status, independent facets, manual classification and browser saved views. Seven core regressions and a 520-item browser flow cover behavior. |
| R35 | Neutral application chrome, direct page titles, readable library rows and a component-based interactive preview. Visual direction remains open to user feedback. |
| R36 | English technical vocabulary is retained in the Turkish catalog and documented for future locales. Catalog and browser regressions cover primary type labels; authored content stays unchanged. |
| R37 | Shared Browse controls cover all four host-directory fields, with manual input, cancellation/error fallback and no implicit import/save/approval. Native chooser command, lifecycle and HTTP boundaries are tested; platform-specific manual QA limits are recorded in [directory selection](DIRECTORY-SELECTION.md). |
| R38 | Bounded nested/gitignored AI discovery, exact Claude memory keys with worktree/config-root support, known Aims profiles, canonical alias provenance and scoped metadata. Regression fixtures cover excluded dependency/account/session links, lazy redacted reads, replaced roots and partial scans. Projects and read-only MCP expose the same inventory. See [AI discovery](AI-DISCOVERY.md) for storage and discovery limits. |
| R39 | Compressed checksum-bound private checkpoints precede scans; failure to save aborts discovery. Partial scans preserve earlier file/installation metadata; unrecognized projects remain with diagnostics. Fast dependency checks and Apply/rollback preserve richer indexes. The overwrite regression was observed failing before correction. Settings downloads receipts without restoring authority. |
| R40 | Known-project/Browse choices inspect read-only automatically; typed paths retain an explicit action. Current inspection is required for review. Late detection or plan responses cannot replace changed drafts. Changed shared directives/presets invalidate review; unavailable selected snapshots are reported and block it. Browser fixtures exercise these transitions. |
| R41 | First-use example link, reopenable workflow guide and a local review/Apply/rollback simulation. Browser checks verify zero example API requests, unchanged real project/plan counts, preserved setup drafts, dismissal persistence, both locales and narrow layouts. See [quickstart](QUICKSTART.md). |
| R42 | AGENTS.md, CONTRIBUTING.md and README use `bun run check` and `bun run format`; verify/lint and applicable browser suites remain required. |
| R43 | Folder-first single-page setup, selected kit rows, optional disclosures, draft retention across navigation and discard protection for replacing edited projects. Suggestion refresh preserves exact manual pins, family exclusions and Agents. The picker groups revisions, pages the full result set and separates type/platform/technology/search. Browser fixtures exercise navigation, catalog updates, nested inspection, selection, narrow layouts and unchanged source files. Bounded optional current-tab recovery survives reload with fresh inspection and no restored authority. |
| R44 | A shared on-demand AI panel prepares validated drafts and fills the corresponding editor after review. Library starts with note/link/command intake; existing forms remain available. Native runners, connected-Agent completion, cancellation, offered-ID validation, masked bounded context and private retention share domain behavior. A readable preview leads; structured fields are optional. See [AI assistance](AI-ASSISTANCE.md) for runner compatibility, privacy and lifecycle limits. |
| R45 | Source groups lead Library and the project picker. Searches filter all items before grouping; nested and outer paging expose the full result set. Existing source IDs, custom content, missing source metadata and Snapshot history remain distinct. Browser checks cover 47-item collections, later-page matches, relationship edits and preference migration. The layout suite covers seven populated pages in two locales, nine viewport sizes, clipped modal bodies, close-action hit testing and scroll/focus recovery. |

| R46 | Library indexes native Claude/Codex/OpenCode Plugin evidence rather than only saved recipes. User/project/local scopes, disabled declarations, cache/catalog separation, canonical aliases, native manifests and nested ignored contexts are covered by read-only fixtures. Plugin evidence is filterable and grouped across Snapshot revisions. Partial scans retain prior observations; full catalog backups and unchanged Snapshot/source-file checks precede private refreshes. Native package activation/conversion and undocumented stores remain explicit compatibility limits. |

| R47 | Scan diagnostics distinguish incomplete/unreadable coverage from empty MCP files and deliberate exclusions, with localized explanations and optional technical details. Known cache/catalog paths avoid arbitrary package internals; Unity generated directories do not consume the authored-source discovery budget. Empty/malformed MCP sources retain earlier observations without source edits or parser-content disclosure. |

| R48 | Independent branch `experience/project-first` preserves `main` at `1fad90c`. Rigshelf adds a project-first launchpad, visible Harnesses, separate Skills/MCP kit sections, applicable Directives, contextual source/AI/local intake, exact private returning choices, optional tab recovery, concrete Agent handoff and neutral local-font brand assets. A normal-motion empty-to-applied browser flow covers collection paging, immutable resource pins, reload, separate Apply and subsequent project return. Naming availability observations are dated, not registration/trademark claims. See [experience brief](EXPERIENCE.md). |

Library carries the current project kit and can return an explicitly inspected Skill/MCP revision to it without replaying that choice into another project. Dirty metadata remains protected. Archived-only results have a recovery action. Browser storage failures are visible, oversized draft choices remain recoverable for trimming under the unchanged write limit, and classification/default changes invalidate retained inspection. Read-only dependency checks and pending suggestions lead back to the relevant kit; older plans remain searchable and reachable.

Shared-definition web editors refuse stale saves/deletes and preserve drafts. CLI and writable MCP offer the same explicit create-only/expected controls, with legacy upserts retained for compatibility. Two-page, CLI/MCP and HTTP fixtures cover the concurrency boundary. Clipboard failure has a real read-only/manual-selection recovery path rather than only a changed button label.

## Operating limits

Native discovery may require a new or reloaded agent session. Rigshelf does not inject tools into a running harness without a supported reload mechanism. The bridge covers tools/resources/prompts and documented filtering/interpolation gaps; experimental extensions, sampling and elicitation need an appropriate native integration.

Automation runs while the workbench or `rigshelf watch` is running. Project and snapshot permissions can be revoked independently. Portable archives grant neither permission on another machine. A copied kit must be reviewed and applied locally before automation can be enabled.

Memory support covers inventoried local and user-scoped project files and global guidance, not conversation databases or restored model context. External/shared documents are read-only in a project's editor. Local model review is proposal-only. Remote billing and credential management remain in the selected agent.

The primary development platform is macOS. Linux CI is configured; hosted CI execution and native Windows acceptance are separate release checks. Global uninstallation, external publication and domain/package registration were not performed.
