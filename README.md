# Rigshelf

Set up coding agents for each project from your own private library.

Save Skills, MCP definitions, native Plugin references and reusable directives once. Choose a project, select a focused kit and its Harnesses, inspect the file changes, then Apply. Keeping something in Library does not load it into every Agent session.

**Claude Code · Codex · Kiro · OpenCode · Antigravity · Grok CLI**

## Run locally

Requires [Bun](https://bun.sh/) 1.4.4 or newer. macOS is the primary tested platform; Linux has CI coverage. Rigshelf runs a local web interface with a Bun server and SQLite. There is no hosted account or database service to configure.

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open the private access URL printed in the terminal. The server binds to `127.0.0.1`, starting at port `47471`. If that default is occupied, it tries the next seven ports. To choose a fixed port:

```sh
bun run rigshelf ui --port 47500
```

Keep the access URL private. Stop with Ctrl-C. The access key survives restarts; stop existing processes before using `ui --reset-access` to rotate access for subsequent starts.

For development, `bun run dev` watches both frontend and server files. Frontend changes rebuild automatically; a workbench notice offers Reload without discarding drafts automatically. The next development start cleans old build assets. See [Contributing](CONTRIBUTING.md).

For installation without a source checkout, build a portable archive with `bun run package`, or include a standalone executable with `bun run package:native`. Both retain the local browser UI, CLI and MCP engine. See [delivery options and installation](docs/DISTRIBUTION.md); local artifacts do not publish themselves.

English and Turkish are available in **Settings → Language**. Technical terms remain English. Four additional languages are tracked in the [localization release plan](docs/LOCALIZATION.md).

## Prepare your first project

1. **Choose a folder.** Start at **Set up a project**. Browse to an existing or empty folder, or try the built-in example without changing real files.
2. **Build your kit.** Inspect the detected stack, choose a Preset and select the Harnesses you use. Add Skills and MCP from Library. **Find more tools** offers local scanning, source links and AI assistance in the same flow.
3. **Review setup.** Inspect exact file changes, content findings and compatibility notes. Resolve conflicts before applying.
4. **Apply and start working.** Follow the handoff to open or reload your Agent. Activity retains the plan and recovery actions. Returning projects can reuse privately reviewed choices.

The [walkthrough](docs/QUICKSTART.md) covers first use, returning projects and recovery. Setup writes Agent configuration and guidance; it does not scaffold application code or install application dependencies.

## What belongs in Library

| Content | How Rigshelf handles it |
| --- | --- |
| Skills | Immutable Snapshots with supporting files, executable intent and source receipts; converted to documented project discovery formats during setup. |
| MCP | Canonical server definitions with environment references; native configuration where supported, a local forwarding bridge for documented gaps. |
| Plugins | Native references, versions, components and installation/cache/catalog evidence. Native package installation and Hook execution remain with the Harness. |
| Directives and Presets | Editable scoped guidance and reusable kit defaults, with checked edits to protect concurrent changes. |
| Memory and other AI files | Inventoried locations; content opens explicitly. Reviewed edits use the plan engine. Conversations and account token stores are excluded. |

Browse [by source](docs/LIBRARY.md), or filter by type, platform, technology, task, project and Harness. Custom Skills retain their own lineage. Gitignored AI locations are included in [bounded read-only discovery](docs/AI-DISCOVERY.md); dependencies and private runtime stores are excluded.

A source check records reachability and, where available, an upstream commit. Importing a newer Skill creates or reuses an immutable Snapshot. It does not upgrade an existing project, move its pins or approve automation. See [source maintenance](docs/MAINTENANCE.md).

## CLI and Agent sessions

Commands work directly from this checkout:

```sh
bun run rigshelf --help
bun run rigshelf scan --root /absolute/projects --no-global
bun run rigshelf setup /absolute/project --preset expo --agents claude,codex
bun run rigshelf diff <plan-id> --file AGENTS.md
bun run rigshelf apply <plan-id>
bun run rigshelf rollback <plan-id>
bun run rigshelf connection --agents claude,codex
```

`setup` prepares a plan; `--apply` explicitly applies it immediately. `--entries ""` selects guidance only. A reviewed replacement requires `--replace-existing`; rollback protects later edits with preconditions.

To register local executable aliases, run `bun link` in this checkout. It registers `rigshelf` and compatibility alias `kitfold`, without installing global Skills. Generated MCP forwarding bridges require `kitfold` on the target Harness's `PATH`.

The [MCP integration guide](docs/MCP.md) covers connection snippets, every shipped tool, pagination, read/plan mode, writable roots and the optional [integration Skill](skills/kitfold/SKILL.md). The Skill ID and `kitfold_*` tool names are retained compatibility contracts. In T3, select the actual Harness; the chosen model alone does not determine discovery paths.

AI assistance can use your installed Claude Code/Codex CLI, local Ollama, a saved local/remote Chat Completions connection, or a pending draft answered in a connected MCP session. Generation is explicit; proposals are reviewed before use. API credentials use server environment references. See [AI assistance](docs/AI-ASSISTANCE.md) for setup and limits.

Automatic additions are optional. They require both current project approval and approval of each exact clean Snapshot. New revisions require a new review; revocation stops pending automatic work. Existing authored guidance is preserved. See the [automation walkthrough](docs/QUICKSTART.md#continue-and-recover).

## Data and backup

Fresh installs use `~/.local/share/rigshelf/catalog.sqlite`. An existing `~/.local/share/kitfold` location stays in use. If both default catalogs exist, choose explicitly with `RIGSHELF_DATA_DIR`; Rigshelf does not merge or move them. Legacy `KITFOLD_DATA_DIR` remains accepted. [Brand compatibility](docs/BRANDING.md) explains retained storage and protocol names. Rigshelf is the confirmed product name; no public package or domain registration is claimed.

**Settings → Review backup** compares a previous export, previews record changes and downloads one complete library archive. Archives include sources, content, Presets and directives; they exclude project state, rollback preimages, access keys and automation approvals. An exclusion report identifies omitted sensitive-looking records. A library export is not a full workbench backup; see [data formats](docs/DATA.md).

**Settings → Manage backups** connects an existing private GitHub repository or S3-compatible bucket (R2, S3 or MinIO). Review the changes, then Sync. GitHub creates one batch commit and PR; merge is a separate reviewed action. S3 publishes an immutable archive and manifest before conditionally updating the current pointer. History offers an integrity-checked restore preview. Credentials use selected server environment references and stay outside portable archives. No automatic uploads, per-file commits or remote pruning. See [backup setup and limits](docs/BACKUP-SYNC.md).

## Verify and contribute

```sh
bun run format
bun run check
bun run verify
bun run lint
bunx playwright install chromium
bun run test:ui
```

Tests use isolated disposable projects. See [validation scope](docs/VALIDATION.md), [security policy](SECURITY.md) and [security review limits](docs/SECURITY-REVIEW.md). Passing tests and source reachability do not establish content safety.

- [Harness formats and limitations](docs/COMPATIBILITY.md) · [primary-source research](docs/RESEARCH.md)
- [Product requirements](docs/PRODUCT.md) · [architecture decisions](docs/DECISIONS.md) · [acceptance record](docs/ACCEPTANCE.md)
- [Daily-use review](docs/PRODUCT-REVIEW.md) · [Experience and branch comparison](docs/EXPERIENCE.md) · [Contributing](CONTRIBUTING.md)

MIT licensed. Local fonts retain their original OFL licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Rigshelf is independent of the supported Harness vendors.
