# Validation record

Tests use fictional data and isolated projects under ignored `.local/tests`. Existing development repositories and global agent configuration are read-only inventory sources. Private benchmark artifacts and screenshots stay under `.local/qa`, outside published source.

The current suite exercises planning without writes, exact rollback including empty files and modes, conflict preconditions, compensation after I/O failures, stale/live locks, interrupted apply/rollback recovery, managed removal, alias containment, source canonicalization, metadata recovery, directive precedence and preset cycles.

Six provider adapters are tested for native layouts, environment/header conversion, tool restrictions, preserved unrelated configuration and TOML/JSONC idempotence. A real local stdio MCP fixture verifies bridge tool filters and declared-secret forwarding while excluding an ambient dummy secret. HTTP tests verify private access keys, foreign Origin rejection, JSON requirements and safe data responses.

Library tests cover custom revisions with resources and lineage, archive/restore, protected deletion, portable archive integrity, traversal/tampering/duplicate rejection, exclusion reports, trusted-automation isolation and dated directory suggestions. Detection tests distinguish macOS/iOS Swift and Android/JVM Kotlin and include a mixed workspace. Rescan tests protect canonical pins, source edits and archived records, and prune only known missing locations.

Public archive parser tests cover immutable roots, exact bytes, executable modes, inert links, traversal, duplicate entries and special files. Live development research successfully listed Expo's source and imported a pinned skill with supporting files. Source access is a development network check, not an isolated security reproduction or vendor certification.

Browser flows exercise setup/apply, library custom forks, supporting-file revisions, archive/restore, source editing, preset inheritance, scoped directive saving, AI prompt handoff, memory editing/promotion, and compressed export/import. Axe WCAG A/AA checks run on primary pages and the tested dialogs; mobile overflow and uncaught page errors are checked. This is a useful automated accessibility check, not a substitute for a screen-reader audit or every vendor CLI's manual acceptance.

A representative private inventory of 1,053 entries produced 1,051 exported records, two reported sensitive exclusions, and a 56.7 MB gzip archive. On the development machine, metadata state serialization took about 114 ms, export 2.6 s and full re-import 2.0 s. These are local measurements, not cross-platform performance guarantees. The initial 32 MiB archive limit failed that test and was increased with independent decompression/resource bounds.

Dependency audit initially reported GHSA-mrhx-c7xc-m3w5 in Zod. The dependency was upgraded to the patched 4.6.7 release, schema usage was migrated and the full suite rerun. `bun audit --json` subsequently returned an empty advisory object. Dependency status is point-in-time; continue checking it before releases.

The final security review and its source revision/coverage must be reported separately. Passing tests and heuristic content checks do not establish absence of defects. No public release, registry publication, existing-project migration or global-skill deletion is performed by this validation workflow.

A real-protocol nested-project regression verifies that an empty local MCP bridge definition fails before starting its parent server, while an absent file still supports parent discovery. A dummy start marker distinguishes those cases without invoking any third-party tool.

The final normal-development run passed 83 unit/integration tests across 13 files, type checking, Biome and the production build. Browser management flows and primary screens reported no uncaught page errors or automated accessibility violations. Seven stress datasets cover empty, one, 40, 41 and 1,284 records plus ordinary and long/Unicode data at 320 and 1,440 CSS pixels. They caught and fixed mobile project-grid overflow, singular labels and unpaginated project rendering. Final import regressions also verify global-link containment, unknown MCP JSON rejection and the shared instruction-size bound. These are development checks, not sandboxed exploit reproductions.
