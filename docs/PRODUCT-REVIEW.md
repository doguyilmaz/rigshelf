# Daily-use review · 2026-11-06

The primary path remains **choose a project → build a focused kit → choose Harnesses → inspect changes → Apply**. Library storage, backup and activation are separate. This review exercised existing flows and added reviewed remote backups. Real development projects and global installations were not test fixtures.

## UI and UX

| Flow | Review result and resulting behavior |
| --- | --- |
| First project/onboarding | Folder selection inspects before planning. The example and guide preserve the real draft and make no project writes. |
| Returning project | Privately reviewed Harnesses, brief and exact pins can be reused. Copied manifests grant no authority; changed inputs invalidate stale review. |
| Acquire tools | AI proposals, research, scanning and import remain explicit. Saving a Skill/MCP does not activate it. Late results cannot replace an abandoned kit. |
| Large Library | Source collections group Skills/revisions. Independent type/platform/technology/task/project/Harness filters run before grouping/paging. Saved views and empty-result recovery remain available. |
| Presets/directives | Include/Exclude alignment, keyboard controls, checked edits, duplication and concurrent-window conflicts are exercised. Technical vocabulary stays English in Turkish chrome. |
| Files/memory | Large inventories have independent list/reader scrolling, search beyond the first page, explicit content reads, draft protection and read-only external guidance. |
| Apply/recovery | File preview stays separate from Apply. Busy writes retain review context. Recovery/rollback protect subsequent authored changes. |
| Backups | Settings opens a dedicated workspace for connection, Review, Sync, status, history and restore. Saving a connection sends no requests. GitHub PR creation and merge are separate; an unmerged PR is unfinished. |
| Backup inspection | Search/paging bounds changes. Before/after reading retains modal geometry. Nested unfocusable scrolling was replaced with one keyboard-focusable content region. |
| Connection editing | The newly saved connection becomes selected. Cancel/navigation protects drafts. Missing credentials show variable names and terminal instructions without a browser secret field. |
| Responsive/localized use | Existing screens/dialogs and new backups cover desktop/tablet/390/320 px, short windows, English/Turkish and normal/reduced motion where applicable. Screenshot inspection complements automated checks. |

Geometry and contrast checks wait for dialog opening transitions to finish. Measuring the intentional intermediate scale frame initially produced a false content-jump report; settled bounds remain unchanged across inspection.

## DX and reliability fixes

- `bun run dev` watches frontend and backend. A new build offers explicit Reload without discarding drafts. Old hashed chunks remain until the next clean start. A disposable checkout fixture runs the real command, edits CSS, declines reload, saves and reloads successfully, then stops both owned processes.
- CLI, HTTP and MCP share the backup engine. CLI has JSON/help and checked profile files. MCP pages reviews; only writable mode executes reviewed actions, and it cannot author/reroute destinations.
- Import validation and mutation share a database reservation, closing a concurrent authored-directive overwrite gap.
- Archives, manifests and staged pointers have independent integrity checks. Schema defaults do not rewrite historical hashes. Remote format errors omit response excerpts.
- Persistent operation identity/exclusion handles duplicate clicks, aliases, interruption, status races and frozen retries. A stale retry cannot reset a completed receipt. Shutdown drains jobs before SQLite closure.
- GitHub preserves unrelated paths, rejects file/link/submodule collisions, batches one commit/PR and checks repository/PR identity. An externally edited then closed PR releases pending work without claiming backup success.
- S3/R2 require conditional writes and ETags. The pointer publishes last. Probe cleanup failure blocks publication and reports its key; conflicts retain immutable objects.
- Restore adds missing records by default. Reviewed Preset/directive replacement is transactional. Local-only records, immutable Snapshot identity and project authority remain protected.

The watcher regression has its own four-second completion deadline plus a 950 ms negative assertion. Its outer test budget now allows that bounded work and scheduling overhead to finish. Product deadlines/assertions were not relaxed.

## Evidence and remaining acceptance

[Validation](VALIDATION.md) records exact counts; [security review](SECURITY-REVIEW.md) defines assurance scope. Fixtures cover authority, integrity, stale/concurrent changes, cancellation, ambiguous publication, native credential selection, provider failures and restore. They are ordinary development tests, not independent usability research, qualified penetration tests or universal browser/provider certification.

No live destination was configured; the user will provide details separately. Live GitHub/R2/S3 acceptance, non-macOS native interactions, other browsers and four additional release locales remain separate work. Archives are private portable library copies, not encrypted full-database/device backups. Remote retention/pruning and OAuth/Enterprise login are not shipped.

Private screenshots, reports and catalogs stay under ignored `.local/qa` and `.local/tests`. This document contains no private inventories, content or access URLs.
