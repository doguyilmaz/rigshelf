# Connect Rigshelf to an Agent

Rigshelf ships a stdio catalog MCP server, an optional project-local MCP forwarding bridge, and a Claude Code and Codex plugin that connects the server and adds the integration Skill. Third-party Plugins remain references in the Library; their Harness owns installation and activation.

## Connect the catalog

After `bun link`, generate the format for the Harness that actually runs your session:

```sh
rigshelf connection --agents claude
rigshelf connection --agents codex
```

The command prints a target file and configuration; it does not edit that file. Without linking, use `bun run rigshelf connection --agents codex` from the checkout. The generated process still needs its configured executable on the Harness's `PATH`. See [compatibility](COMPATIBILITY.md) for the six native formats. Keep one catalog connection per Harness, including when replacing an older `kitfold` connection.

For example, a Claude-style project connection is:

```json
{
  "mcpServers": {
    "rigshelf": {
      "command": "rigshelf",
      "args": ["mcp"]
    }
  }
}
```

Without a linked executable, use the absolute path to Bun as `command` and `["/absolute/checkout/src/cli.ts", "mcp"]` as `args`. This is a local process, not an HTTP MCP URL. The workbench's browser access key is not an MCP credential. Native project trust, tool approvals and process environment still belong to the Harness.

Read/plan mode is the default. It may save project detection, recommendations, plans, discovery caches and a response to an existing AI draft request in the private catalog. It cannot Apply, rollback, grant automation approval or explicitly author library definitions. It is not a promise of a stateless database connection.

To enable writing:

```sh
rigshelf connection --agents codex --write --root /absolute/project
```

Review the generated snippet before adding it. `--root` bounds project writes for Apply, rollback, recovery and automation. It does not isolate library reads or restrict writable definition tools to that project's records. Use writable connections only in trusted sessions. A repository manifest is not ownership evidence or automation permission.

## Available tools

The compatibility prefix is `rigshelf_`; the server handshake name is `rigshelf`. Tool schemas returned by MCP `tools/list` are authoritative for input types and limits. Responses contain JSON in text content. Handle protocol/tool errors before treating content as a successful result.

Default read/plan tools:

| Tool | Purpose and principal input |
| --- | --- |
| `rigshelf_backup_review` | Read selected saved destinations; explicitly prepare Sync, restore and merge reviews, reconcile status or page backup changes/history. Does not publish, merge or restore. |
| `rigshelf_projects` | Project metadata; `query`, `offset`, `limit`. No instruction bodies. |
| `rigshelf_project_files` | Inventoried AI file metadata for `projectId`; filter by `query`, `scope`, `kind`. |
| `rigshelf_project_document` | Explicit document read using `projectId` and `documentId` or an inventoried `path`. |
| `rigshelf_connection` | Generate configuration for `provider`, optionally `writable` and `projectPath`. Generation grants no authority. |
| `rigshelf_catalog` | Search saved items with `query`, `kind`, `offset`, `limit`. |
| `rigshelf_item` | Read one `id`, findings and paginated redacted body using `offset`, `length`. |
| `rigshelf_file` | Read supporting-file metadata or a bounded text page using item `id`, file `index`, `offset`. Binary files return metadata. |
| `rigshelf_sources` | Source summaries with `query`, `offset`, `limit`, or full detail by `id`. |
| `rigshelf_source_skills` | Discover immutable upstream Skill paths for `sourceId`; `query`, `offset`, `limit`. Makes explicit network requests and caches evidence. |
| `rigshelf_discover` | Search skills.sh with public technology `query`; suggestions do not activate anything. |
| `rigshelf_presets` | Preset summaries with `query`, `offset`, `limit`, or complete definition by `id`. |
| `rigshelf_rules` | Directive summaries with `scope`, `offset`, `limit`, or content by `id`, `offset`, `length`. |
| `rigshelf_recommend` | Inspect `projectPath` and `requirements`, optionally `presetId` or `restorePrevious`. Returns suggestions and private returning-project choices. |
| `rigshelf_plan` | Prepare a setup using `projectPath`, `providers`, `entryIds` and optional setup controls. Returns metadata, not file bodies. |
| `rigshelf_plan_changes` | Page every prepared plan's file metadata using `planId`, `offset`, `limit`. Retains original file indices. |
| `rigshelf_plan_file` | Inspect a bounded redacted before/after preview using `planId`, `index`. |
| `rigshelf_pending_drafts` | List waiting workbench requests without their prompt bodies. |
| `rigshelf_draft_request` | Read the bounded masked prompt for one waiting request `id`. |
| `rigshelf_propose_draft` | Answer an existing waiting request using `id`, `proposal`; no save, Apply or permission grant. |

Additional tools with `mcp --write`:

| Tool | Effect |
| --- | --- |
| `rigshelf_backup_apply` | Explicitly execute Sync, restore, merge, cancel, close PR or frozen retry using a reviewed ID. No destination authoring or credential handling. |
| `rigshelf_add_source` | Register and research a public URL/repository/recipe from `input`; recipes are never executed. |
| `rigshelf_import_skill` | Import `sourceId`, `path` into an immutable library Snapshot, without project activation. |
| `rigshelf_custom_skill` | Save a reviewed custom Skill from `name`, `description`, `body`, optional `tags`. |
| `rigshelf_save_preset` | Save a Preset; use `createOnly` or full previous `expected` definition. |
| `rigshelf_save_rule` | Save a Directive; use `createOnly` or full previous `expected` definition. |
| `rigshelf_apply` | Apply a reviewed `planId` within allowed roots, subject to ownership, preconditions and locking. |
| `rigshelf_rollback` | Roll back `planId` within allowed roots, protecting later edits. |
| `rigshelf_recover` | Recover an interrupted `planId` within allowed roots after journal validation. |
| `rigshelf_snapshot_approval` | Approve/revoke exact clean Snapshot `id` with `approved`; never inferred from source trust. |
| `rigshelf_project_automation` | Enable/revoke automation for `projectPath` with `enabled`, within allowed roots. |

Backup review uses `action: "changes"` for Sync reviews or `"restore-changes"` for restore reviews, with `offset` and `limit`. Continue `nextOffset`, `nextExcludedOffset` and `nextConflictOffset` as applicable. Backup destinations are preconfigured in the workbench/CLI; MCP cannot author or reroute them. Sync returns an owned asynchronous operation; use `action: "status"` with its ID to reconcile. A PR waiting for merge is not a completed backup.

The catalog server exposes tools. The forwarding bridge can additionally forward upstream resources and prompts; those are separate capabilities, not catalog endpoints.

## Page before inspecting or editing

Lists generally return `total` and `nextOffset`; continue until `nextOffset` is `null`. Defaults vary by tool; list limits never exceed 100. `rigshelf_rules` retains its legacy array response: advance `offset` by returned row count until a short/empty page. In ID mode that same offset counts text characters, not rows.

`rigshelf_item`, text `rigshelf_file` and Directive ID reads provide continuation offsets. Item metadata includes file counts; fetch supporting files individually. Rule edit preconditions require the complete unmodified definition, reconstructed across all content pages. Redacted content cannot reconstruct the original; use the workbench editor when exact expected text is unavailable. Listing summaries are never complete edit preconditions.

`rigshelf_plan` includes the first 50 changes and `fileCount`. Use `rigshelf_plan_changes` for remaining metadata, then `rigshelf_plan_file` with each original `index`. File previews can be redacted, binary or truncated; inspect those flags before approving. Do not assume a truncated preview contains the whole source file.

## Use the integration Skill

The optional [Skill](../plugin/skills/rigshelf/SKILL.md) helps an Agent search Library, prepare a small kit, inspect the complete plan and answer UI draft requests. Copy that folder only into the selected project's documented Skills directory when you want it there. It is not required for the CLI or web interface, and does not register its MCP connection automatically.

For new Presets/directives, set `createOnly: true`. For updates, read by ID and pass full `expected`; conflicts retain the newer saved definition. Neither control authorizes project writes. Do not run imported recipes, Skill scripts or Plugin Hooks just to inspect them.
