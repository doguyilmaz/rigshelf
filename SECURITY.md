# Security and privacy

Kitfold runs as the current OS user. Its local workbench, CLI, stdio MCP server and MCP compatibility bridge have different authority boundaries.

The HTTP workbench binds to loopback, checks Host and Origin, requires a random access key for every API route, and does not expose that key in public HTML. The launch URL stores its key in tab-scoped session storage after removing the fragment. Do not share the URL or run this server behind a public proxy.

Read-only MCP connections can inspect the private catalog and prepare plans. `--write` adds private-library mutations and project writes, with project-root checks on apply/rollback/recovery. Only connect writable MCP to trusted agent sessions. A trusted local user or process with access to the same account can already access the underlying files; this is not a sandbox against that principal.

Setup uses bounded plans, exclusive project locks, atomic per-file replacement, a write journal and compensation on failure. Apply and rollback verify expected bytes. Later edits cause conflicts. Recovery requires a known interrupted plan and verified stale lock ownership. Project-external symlinks, hardlinked outputs and unsafe paths are refused. Same-project aliases are limited to the same skill location. These checks reduce accidents; filesystem races with an adversarial same-user process are outside the isolation guarantee.

Reviewed project ownership lives in the private catalog and is bound to the directory identity and reviewed manifest bytes. Repository manifests alone cannot authorize deletion, claim another file's trusted snapshot identity or change an automatic kit. A copied kit needs local review before automation. Project permission and exact snapshot approval can be revoked independently; stopping automation cancels and drains pending work.

Import reads snapshots without executing scripts, plugin commands or lifecycle hooks. Public GitHub imports pin a commit, bound download/decompression/file counts, retain resource modes, and exclude links and sensitive-looking files. API metadata is optional; an immutable public commit archive is a fallback. Directory popularity and repository reachability do not establish safety, publisher endorsement or code review.

Static content checks look for common credentials, private keys, dangerous shell recipes and instruction overrides. They can miss secrets and unsafe instructions. Review third-party instructions and executable resources before using them. Treat MCP servers as executable tools with their own permissions. The bridge forwards only declared environment references and a small runtime environment, and enforces supported tool filters; it does not sandbox the server itself.

Discovery follows aliases only inside inventoried project/global roots. Skill instruction bodies share a 512 KiB byte limit across local, upstream and portable imports; supporting resources use the separate bundle bound. Portable MCP JSON rejects unknown fields, and exports report invalid legacy definitions as exclusions rather than silently copying opaque data.

Exports omit projects, rollback preimages, local approvals and credentials managed by Kitfold. Sensitive-looking content is excluded with a report. Custom text, references and source notes may still be private. Imported archives are validated and rescanned; imported trust/automation permissions are never accepted.

Reusable directives are rescanned before setup. Credential-looking guidance is blocked; review-level findings require an explicit manual review. Dependency automation never rewrites guidance. Import preview shows the scope and enabled state of imported rules so that global directives are visible before adoption.

There is no telemetry or chat/session collection. Optional searches send the explicit public query to skills.sh. Source checks contact the saved public source. Ollama requests use the fixed local endpoint only when requested. `GITHUB_TOKEN`, when explicitly provided in the process environment, is sent only to api.github.com and is not saved in the catalog.

Please use the repository's private vulnerability reporting feature when enabled. Until a reporting contact is established, avoid posting credentials, private catalogs or exploit data in public issues. Security reports should identify a concrete trust boundary, source trace, minimal dummy-data reproduction and affected version.
