# AI file discovery

Discovery reads existing installations into the private catalog. It does not install, activate, move or delete anything in a source project or global harness configuration. Gitignore rules do not control discovery: known AI locations are inspected even when ignored or untracked. Repository configuration and discovered files do not grant setup or automation permission.

The same physical-file discovery applies to every selected project. Directories with only local AI configuration can be inventoried before an application manifest exists. Standalone `SKILL.md` and ordinary `skills/` collections are recognized by the Skill file; dependency directories remain excluded.

Native Agent definitions, Commands, Config, Hooks and Plugin manifests are indexed as metadata, with type filters in Projects and MCP. Contents load only on request and remain read-only in the project editor. Config, Hook and Plugin files cannot be promoted wholesale as directives. Global native-file metadata is stored once and shared across project views.

Claude's project-local `.claude/agent-memory` and `.claude/agent-memory-local`, and user-level `agent-memory`, are included alongside auto-memory. Vendor-defined scopes are documented in [Claude subagent memory](https://code.claude.com/docs/en/sub-agents#enable-persistent-memory). Known Plugin cache and marketplace layouts are searched within bounds; indexing a native file does not establish that its Plugin is enabled. `OPENCODE_CONFIG_DIR` follows OpenCode's [custom-directory configuration](https://opencode.ai/docs/config/#custom-directory).

## Locations and scope

| Location | Indexed data | Display scope |
| --- | --- | --- |
| Project root and bounded nested source directories | Known instruction filenames, harness rules/steering, known memory directories, Skills and MCP configuration | Project files |
| Claude configuration `projects/<full-path-key>/memory` | Markdown memory index and topic-file metadata for that project | Project memory outside the repository |
| Known user harness roots | Root Markdown guidance, rules/steering, dedicated memory files, Skills, supported plugin caches and MCP configuration | Global guidance or global installations |
| `~/.aims/profiles/{claude,codex}/<profile>` | Only the same known AI sublocations; shared aliases retain provenance | The underlying harness and project/global scope |
| Explicit `CLAUDE_CONFIG_DIR` or `CODEX_HOME` | The corresponding known harness sublocations | The underlying harness and project/global scope |

Instruction names include `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `MEMORY.md`, `MEMORY.local.md` and supported legacy rule files. Dedicated rule directories include Claude/Codex/Agents rules, Kiro steering, Cursor rules, GitHub instructions and other enumerated harness locations. This is an allowlisted inventory, not a recursive import of every hidden file.

Project memory uses full-path keys rather than basename or prefix matching. Canonical path aliases and repository subdirectories are considered. A Git worktree is associated with its main repository only after a matching bounded Git metadata back-reference; discovery never runs Git hooks. `CLAUDE_CODE_PROJECT_DIR_NAME`, paired with the explicit Claude config root, accepts only a single bounded directory name. The vendor's [memory storage documentation](https://code.claude.com/docs/en/memory#storage-location) describes the native layout; indexing a file does not establish whether a running harness has loaded it.

Known Claude settings may declare `autoMemoryDirectory`. A user-level setting can identify an additional explicit memory root. A project setting is followed within the project or inspected AI config roots; an unrelated external path is reported without following it. Arbitrary external storage and undocumented profile layouts require a future explicit root-selection flow rather than a broad home-directory search.

## Exclusions and bounds

Source traversal reads directory names to locate AI contexts; it does not read ordinary source-file bodies. Dependency, build, cache, VCS and runtime directories are skipped, including `node_modules`, `Pods`, `.git`, `vendor`, `dist`, `.next`, `.expo`, sessions and transcripts. Aims sessions, meter, backups and runs, Codex rollout summaries, account token stores and conversation records are outside discovery. Links cannot make excluded dependency, account or runtime targets eligible.

Each project is bounded to 4,096 visited source directories, depth 12 and 256 AI contexts. Guidance collection is bounded to 2,048 files, 16,384 candidate paths, depth 5 within a known AI document directory, and 512 KiB per opened document. Aims profile enumeration is bounded to 128 entries per supported harness. MCP-referenced nested projects are only traversed within selected project roots and under the referenced-project bound. Partial, unavailable and excluded locations produce diagnostics; an empty inspected result is not proof that no AI file exists elsewhere.

Canonical file identity deduplicates guidance aliases while retaining their source paths. Skill snapshots deduplicate independently from installation locations, so distinct harness installations remain visible. A project-only scan retains previously inspected global and external guidance; a subsequent global scan refreshes those locations.

An invalid MCP definition is reported individually without suppressing later valid servers in that file. Configuration parse failures retain generic diagnostics rather than copying raw configuration or credential values into errors.

## Reading and editing

Discovery stores document metadata and provenance, not memory or instruction bodies. Projects groups local files, external project memory and collapsed global guidance, with filename/path/provider search. Files load only after selecting one. Opening verifies the inventoried root identity and source target, uses bounded regular-file reads and masks detected credentials. Replaced roots require a rescan.

External and shared guidance is read-only in the project editor. Local authored guidance retains digest-bound review plans, apply and rollback. Promoting selected guidance to a reusable directive is explicit and defaults to project scope. Catalog indexing never adds these files to an agent's context or enables automatic promotion.

Read-only MCP tools `kitfold_projects` and `kitfold_project_files` expose paginated metadata. `kitfold_project_document` explicitly reads one inventoried file through the same domain operation as HTTP. Arbitrary absolute-path reads are not accepted. Private project paths and document indexes are excluded from portable library exports.

## Preserve the previous index

Before changing the catalog, each scan writes an immutable compressed checkpoint of the previous project/file index, installation relationships and shared native-file metadata. A checksum protects the recorded bytes. Failure to create the checkpoint stops discovery before inventory changes. Checkpoints are private receipts, not source-file backups or transferable ownership/automation records. Settings lists the latest 50 and downloads a selected checkpoint; listing does not prune older records.

Partial project discovery retains earlier file metadata and does not prune installation relationships. A project no longer recognized in a selected root remains visible with a diagnostic. Complete scans can update current locations for genuinely missing installations; old relationships remain in the checkpoint and immutable library snapshots survive. Fast manifest detection during dependency checks, Apply and rollback preserves enriched AI indexes instead of replacing them with root-only results.

Native-file inventories are bounded to 4,096 unique files per project/global collection. Plugin-root discovery is bounded to 4,096 visited directories, depth 6 and 256 roots per searched location. Limits and unavailable locations produce diagnostics. Arbitrary undocumented storage and conversation/memory databases are not parsed. Their original data remains untouched.

## Native Plugin references in Library

Library imports Plugin **references**, separately from the native-file index. Previously only saved `/plugin` recipes appeared there. Supported read-only evidence is:

| Native metadata | Observation |
| --- | --- |
| Claude `plugins/installed_plugins.json`, versions 1 and 2 | Installation record, retaining user/project/local scope and reported version |
| Claude `settings.json` / project `settings.local.json` → `enabledPlugins` | Configuration declaration, including `false` |
| Codex `config.toml` → `plugins.<id>.enabled` | Configuration declaration, including `false` |
| Claude/Codex `plugins/cache`, `plugins/marketplaces`, `plugins/bundled-marketplaces` and bounded local marketplace indexes | Cache/catalog package presence; never installation proof |
| `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, recognized Agent Plugins `plugin.json` | Native package reference and component-presence summary |
| OpenCode `opencode.json` / `opencode.jsonc` → `plugin`, including project `.opencode` locations | npm or local-file declaration |
| OpenCode `plugins/` and legacy `plugin/` inside known configuration roots | Local JS/TS module presence; source is hashed, never executed or exported |

The same known locations apply to explicit config roots and Aims profiles. Physical aliases deduplicate configuration observations. When parent and explicitly discovered nested project contexts overlap, the deepest project owns a configuration observation. Registry-referenced nested projects are read only inside selected project roots; other absolute project references retain metadata without granting traversal or write authority. Gitignore does not hide these AI paths. Known local marketplace package sources must remain inside their inspected checkout and allowed roots. No network fetching or installer execution occurs.

The Plugin evidence filter distinguishes installation records, declarations, local packages/modules, cache, catalog and saved references. A family can have several kinds of evidence across Snapshot revisions. Location details show these observations together, including disabled declarations and reported versions. Cache/catalog observations do not count as project usage or global installations. Neither an installation registry nor an enabled flag proves loading in a particular running session; discovery has no live-session activation signal. Unversioned declarations remain references rather than being assigned an inferred package version.

Plugin references contain a strict typed identity, provider, optional reported version, manifest kind, component names and optional content hash. They do not contain raw manifest fields, install paths, hook bodies, module source or credentials. Legacy manifests can declare additional Skill directories; eligible directories inside the package are inspected without running scripts. Component summaries do not promise full interpretation of native extension/permission semantics or arbitrary declared Hook/Agent paths. Native package contents are not backed up by this reference record.

Native metadata reads are bounded to 4 MiB, refuse linked/hard-linked leaves, enforce canonical root containment and verify descriptor identity/size/timestamps. Already inspected Aims configuration aliases reuse their canonical observation. A registry supports at most 2,048 identifiers and 1,024 records per identifier; a configuration supports 2,048 declarations. Marketplace root enumeration is bounded to 256 locations per known index/directory and 2,048 entries per index; package materialization is bounded to 10,000 candidates. General Plugin directory bounds above still apply. Reaching a bound or encountering an invalid/unavailable location produces a diagnostic and retains previous observations. Current relationships are pruned only from clean, checked metadata or confirmed missing files in the inspected scope; immutable references remain in Library and prior relationships remain in the scan checkpoint.

Native formats are documented by [Claude Plugin discovery](https://code.claude.com/docs/en/discover-plugins), [Claude Plugin reference](https://code.claude.com/docs/en/plugins-reference), [Codex Plugin building](https://developers.openai.com/plugins/build/plugins) and [OpenCode Plugins](https://opencode.ai/docs/plugins/). Unlisted runtime stores and undocumented vendor formats remain outside discovery.
