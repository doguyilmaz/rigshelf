# Build log

This is a working engineering record, not a release-completion claim.

## Established

- The product is an independent implementation; no third-party catalog seeds it. Discovery reads actual files.
- Working name changed from Strata to Kitfold. UI, CLI, MCP names, and file markers use Kitfold.
- English product and documentation; Turkish conversation.
- Automation: only explicitly permitted projects and approved immutable snapshots.
- Grok: official CLI adapter, with a separate explanation for model selection inside T3.
- Public source and private inventory are separated by `.gitignore` and private storage permissions.

## Implemented and exercised

- Bun/TypeScript domain engine, SQLite catalog, local static web UI, CLI and stdio MCP.
- Six researched harness adapters; MCP native conversion and conditional bridge.
- Direct local scanning, immutable multi-file skill snapshots, source grouping, custom content, scoped rules, inherited presets, and recommendations.
- Plan/apply/rollback with conflict detection, safe output-path checks, preserved authored guidance, managed removals, executable resources, and project locks.
- Optional manifest watcher and source-check scheduling. No continuous LLM loop.
- Real-protocol bridge tests prove tool restrictions and declared-environment forwarding.
- Isolated test fixtures; no setup was applied to the user's development repositories.
- First browser run covered project detection → plan → apply and every primary screen, desktop/mobile layouts, and automated accessibility checks. It exposed contrast issues, which were corrected and rechecked.

## Bugs caught during development

- Export imports initially trusted caller-provided digests; snapshot bytes and body now must match the digest.
- New snapshot approval initially did not invalidate dependency-check idempotence; approval state is now included.
- Nested package folders initially appeared as separate projects; root grouping now avoids that.
- Invalid YAML initially disappeared from import; it is now retained with a review finding.
- SDK browser context setup and navigation accessible-name mismatches were corrected in UI tests.
- Secret values in MCP metadata/body are sanitized consistently; separate token arguments are recognized.
- Provider-specific environment interpolation and tool filters are preserved rather than silently flattened.
- HTTP access keys were removed from public HTML and moved to an owner-visible fragment launch URL.

## Completed acceptance checks

Crash/recovery and filesystem failure tests, custom revision/resource editing, source research/editing, CLI management, real-library archive round trips, workspace automation and permission revocation are implemented and exercised. The browser management and stress suites, automated accessibility checks, type checking, lint and production build pass. Installation, architecture, compatibility, data, privacy and acceptance documentation are present.

The independent security review retains its own source revision, coverage and validation limits. It is distinct from development tests and does not certify every native harness version or hosted release environment. No public release or existing-project migration was performed.

The final import review additionally caught global directory aliases escaping inventoried roots, ignored MCP JSON fields bypassing canonical credential inspection, and a missing upstream instruction byte limit. Shared containment/validation now enforces those boundaries, with three regression cases. The final suite including the bridge regression passes 83 tests; the browser suites, lint, build and dependency audit were rerun successfully.

The interface review caught a truthiness check that treated an empty project-local MCP bridge definition as missing. Discovery now stops on any existing definition and rejects invalid JSON before considering a parent. A nested-project protocol test verifies that the parent server starts only when the child definition is absent.
