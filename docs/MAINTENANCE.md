# Maintain sources and integrations

Library storage, upstream availability, content revision and project activation are separate states. A reachable URL, directory listing or clean static scan is not a safety approval.

## Check an upstream Skill

In the workbench: **Library → open a Skill → Fetch latest snapshot** imports a revision without changing installed projects. In the project's kit, items with multiple saved revisions offer **Snapshot for …**. Choose the exact revision, then **Review setup** to inspect file differences and **Apply** deliberately. Other choices from the same source/name remain available, including the prior pin; a newer saved date is not an upstream safety or freshness claim. Existing project selections never silently move to another revision when Library refreshes.

```sh
bun run rigshelf sources
bun run rigshelf check-source <source-id>
bun run rigshelf source-skills <source-id>
bun run rigshelf import-skill <source-id> skills/example/SKILL.md
```

`check-source` records a dated check and, for supported GitHub sources, an immutable commit. `source-skills` discovers actual repository paths. `import-skill` snapshots the selected path and supporting files from one immutable tree without executing them. Size, path and sensitive-resource limits still apply; review excluded files and findings before use.

Identical bytes reuse the existing Snapshot and add provenance; changed bytes create another Snapshot. Existing pins, authored tags on existing entries, historical receipts, installation relationships and automation approvals are preserved. A newer source commit can have unchanged Skill bytes. Review the new content and prepare a separate project setup to choose a newer revision. Never rewrite an old Snapshot to make it appear current.

If a source is renamed, retargeted or removed while research is in flight, the result must not resurrect it or attribute old-repository content to its replacement. Checks merge evidence into the current record without replacing authored notes, names or recipes. Retry after an identity conflict.

## Interpret incomplete evidence

| Content | What a check can establish | What remains separate |
| --- | --- | --- |
| GitHub Skill with a proven repository path | Available commit, exact selected bundle and content digest | Author review, code execution safety and project upgrade approval |
| Local/custom Skill | Captured bytes, digest and local provenance | A latest upstream version unless its source/path can be established |
| Native Plugin | Recorded version, manifest/components and installed/configured/cache/catalog evidence | Whether that version is the publisher's latest release; native update and activation |
| MCP definition | Captured transport, executable/endpoint and declared environment references | Current package/server version, authentication readiness and runtime behavior |
| Documentation, social or listing link | Dated availability where a supported public host permits checking | Publisher identity, content correctness and executable compatibility |

A package command such as `bunx package@latest` is not an immutable release pin. A cached Plugin is not necessarily installed or enabled. A remote MCP endpoint can change without its URL changing. Report these as unresolved version evidence rather than “up to date”. Do not execute an installer, Hook, package or MCP server to discover a version during a library source check.

A source path can move or disappear. Keep the historical Snapshot and report the missing path. A matching name alone is not enough to attribute different upstream content to it. The source editor supports correcting relationships after review.

## Preserve your catalog

Before broad maintenance, make a consistent SQLite backup including committed WAL state, or stop all workbenches before copying the catalog. Keep the backup private and outside public source. Portable library exports intentionally omit project state and rollback preimages; see [data ownership](DATA.md).

Work on a separate catalog when researching large source sets. Adopt only verified evidence and immutable Snapshots through domain operations. Do not replace the live database with a working copy: other windows may have saved newer definitions, ownership or approvals in the meantime. Existing project installations are read-only inputs to this process.

## Keep Rigshelf's own integrations current

The maintained artifacts are the catalog MCP server, forwarding bridge, integration Skill and six project-file adapters. There is no distributable Rigshelf native Plugin package today.

1. Compare actual CLI/MCP schemas and adapters with [primary vendor contracts](RESEARCH.md). Distinguish local CLI, IDE and hosted surfaces.
2. Preserve documented environment, invocation and tool-filter semantics. Refuse unsupported execution/authentication behavior instead of silently converting it to a local or anonymous server.
3. Update the [MCP guide](MCP.md), [compatibility matrix](COMPATIBILITY.md) and integration Skill together when behavior changes.
4. Run formatting, TypeScript, protocol/integrity fixtures, `verify` and `lint`; run UI flows when visible behavior changes. Validate Skill metadata against the [Agent Skills specification](https://agentskills.io/specification).
5. Record tested versions and practical limits. Dependency freshness and vulnerability-advisory checks are distinct from a qualified security review.

For example, Codex supports local and remote `env_vars` sources. Rigshelf imports local references; remote executor selection, remote references and dynamic header helpers stay native and produce inventory diagnostics. OAuth tokens and account credential stores are never imported. See [the official MCP contract](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
