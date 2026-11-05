# Engineering decisions

## One local engine

Bun + TypeScript serves CLI, web API, and MCP. SQLite provides transactional catalog updates, indexes, and a versioned on-disk schema. React is compiled into static assets; there is no SSR server, hosted database, account service, or mandatory model call. A native Go/Rust binary could reduce runtime dependencies, but a second implementation would increase adapter drift and maintenance. Standalone packaging can reuse the same engine.

## Library versus activation

The private library lives outside every agent's skill discovery folders. Only an explicitly selected project kit is materialized. Full skill bodies never go into a global instruction index. The generated directive points to the pinned kit; native agents perform progressive skill discovery. Shared AGENTS.md guidance is generated once where supported, with a Claude import when needed.

## Immutable capability snapshots

A snapshot includes SKILL.md and supporting resources, with a deterministic digest. Updating a source adds a revision; it does not replace installed files. Custom edits create new revisions. Existing project files need matching preconditions before any replacement. This makes daily setup reproducible even when upstream repositories change.

## Provider conversion has boundaries

Different harnesses use different MCP schemas, environment syntax, and invocation policies. Native conversion is preferred. A small stdio bridge handles unsupported transport, working-directory, interpolation, or tool-filter requirements. It forwards tools/resources/prompts and enforces filters at both discovery and call time. It is not a universal proxy for experimental MCP features. Unpreservable manual-only skill invocation is rejected instead of broadened.

## Project writes are reviewable

Plans retain exact preimages in the private database. Per-file writes use exclusive temporary files and atomic rename. A project lock serializes writes, and an operation journal supports recovery. Preconditions are checked both before the operation and before each write. Multi-file filesystem operations cannot be one database transaction; crash recovery must be explicit and documented.

## Automation has a narrow job

Only projects with explicit approval and an existing kit can receive automatic additions. Every automatic capability must match an approved content digest. Dependency checks are debounced and idempotent. They do not fetch a newer capability version, uninstall global skills, or continuously invoke an LLM. Library edits and reusable lessons remain deliberate user decisions.

The ownership baseline is private and bound to directory identity. Repository metadata cannot authorize deletion, claim a catalog snapshot or silently change approved providers. Automatic additions preserve instruction files. Cancellation is checked at write boundaries, and shutdown drains active work before closing the catalog.

## Trust labels report evidence

Reachability, publisher identity, listing presence, content review, and scan findings are distinct concepts. A GitHub URL is not a safety badge. Built-in scans are heuristics and report their limits. Installation recipes are retained as data and never executed merely because a source was added.

## Local HTTP access is still authenticated

The workbench binds to loopback and checks Host and Origin. A private access key is printed only in the launch URL, consumed from the URL fragment, and retained in tab-scoped storage. It is never embedded in unauthenticated HTML or exposed through an API bootstrap endpoint. This prevents another local OS user from obtaining the owner's API authority by fetching the landing page. CSP and ordinary React text rendering reduce script-injection surfaces.

## No conversation platform

Instruction and memory documents are bounded files, viewed only on request. Reusable guidance retains provenance and an explicit scope. The application does not collect chat transcripts, restore model context, switch accounts, or synchronize sessions. Existing third-party catalog data is not imported.

## Open-source boundary

Public source contains generic presets and the supplied public reference URLs. Local project names, paths, private GitHub metadata, imported skill content, scan output, database files, and QA artifacts stay ignored and private. No repository, domain, package, or registry has been published or registered during development.
