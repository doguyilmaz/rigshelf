# Acceptance record

The implementation follows the [request ledger](PRODUCT.md). This record distinguishes implemented behavior from operating limits. It does not claim defect-free software or manual certification of every vendor CLI release.

| Requirement | Implemented behavior and evidence |
| --- | --- |
| R01 | Immutable multi-file snapshots, source families, versions, provenance and installation locations. Ingestion, library and rescan tests cover deduplication and preservation. |
| R02 | Canonical stdio/HTTP/SSE definitions, project/global locations and sanitized environment requirements. Native adapters and the bridge are exercised with fixtures. |
| R03 | Preset create/edit/duplicate/delete, inheritance, pins and exclusions. Explicit pins are retained beyond the small automatic recommendation limit. |
| R04 | Seventeen presets cover the requested mobile, Apple, Android, web and backend branches, plus common CLI/JVM/Astro workflows. Classification is editable. |
| R05 | Manifest/workspace detection, requirements, recommendation reasons, manual selections and new/existing directories. Exact technology matches precede overlapping alternatives. |
| R06 | Six documented harness mappings. T3 model choice is separate from its harness. Ollama provides optional local proposals; other runners use prompt handoff/current-session MCP. |
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
| R31 | Three interactive prototypes, an inline visual comparison and separately addressable built preview URLs. No final visual direction or replacement name has been selected. |
| R32 | Stable editor frames, retained exit presence, a shared backdrop, inert exiting controls and native focus restoration. Browser tests exercise delayed content, tabs, close and editor replacement. |
| R33 | Browser-persisted English/Turkish UI with lazy Turkish loading, matching catalogs, interpolation checks, localized dates/counts and cross-tab updates. Six-language release work is tracked in [localization](LOCALIZATION.md); the remaining four are not shipped yet. |
| R34 | Family-based search/filter engine, separate item/source views, visible status, independent facets, manual classification and browser saved views. Seven core regressions and a 520-item browser flow cover behavior. |
| R35 | Neutral application chrome, direct page titles, readable library rows and a component-based interactive preview. Visual direction remains open to user feedback. |
| R36 | English technical vocabulary is retained in the Turkish catalog and documented for future locales. Catalog and browser regressions cover primary type labels; authored content stays unchanged. |
| R37 | Shared Browse controls cover all four host-directory fields, with manual input, cancellation/error fallback and no implicit import/save/approval. Native chooser command, lifecycle and HTTP boundaries are tested; platform-specific manual QA limits are recorded in [directory selection](DIRECTORY-SELECTION.md). |

## Operating limits

Native discovery may require a new or reloaded agent session. Kitfold does not inject tools into a running harness without a supported reload mechanism. The bridge covers tools/resources/prompts and documented filtering/interpolation gaps; experimental extensions, sampling and elicitation need an appropriate native integration.

Automation runs while the workbench or `kitfold watch` is running. Project and snapshot permissions can be revoked independently. Portable archives grant neither permission on another machine. A copied kit must be reviewed and applied locally before automation can be enabled.

Memory support covers inventoried project files, not conversation databases or restored model context. Local model review is proposal-only. Remote billing and credential management remain in the selected agent.

The primary development platform is macOS. Linux CI is configured; hosted CI execution and native Windows acceptance are separate release checks. Global uninstallation, external publication and domain/package registration were not performed.
