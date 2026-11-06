# Rigshelf

A local workbench for setting up coding agents, one project at a time.

Collect skills, MCP definitions and reusable guidance in a private library. Choose a project, review a focused kit, select your agents, and apply a reversible setup plan. Your whole library stays outside agent context.

**Claude Code · Codex · Kiro · OpenCode · Antigravity · Grok CLI**

## Run locally

Requires [Bun](https://bun.sh/) 1.4.4 or newer. macOS is the primary tested platform; the CI workflow targets Linux. No account, database service or model subscription is required.

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open the **private access URL** printed in the terminal. The workbench binds only to `127.0.0.1`, starting at port `47471`. If that default is occupied, it tries the next seven ports. An explicit `bun run rigshelf ui --port 47500` uses only that port and never stops another process. The URL contains an access key; keep it private. Stop with Ctrl-C. The private key survives restarts. To rotate it, stop existing workbench processes and run `bun run rigshelf ui --reset-access`; servers started afterward use the new key.

Choose **Settings → Language** for English or Turkish. The choice is local to your browser and preserves current drafts. The [six-language release plan](docs/LOCALIZATION.md) tracks additional translations.

This branch implements the [project-first Rigshelf experience](docs/EXPERIENCE.md). The former interface remains on `main` at `1fad90c`; [comparison instructions](docs/EXPERIENCE.md#run-and-compare) explain how to return to it. The new name is a working product identity, not a registered package or domain.

For a global executable, run `bun link` in this checkout. It registers `rigshelf` and the compatibility command `kitfold`; it does not install global Skills. Generated MCP bridges still use `kitfold` on the target Harness's `PATH`.

## A normal day

1. **Prepare → choose a folder.** Inspect an existing or empty project folder. Agents, detected stack and the focused kit appear together.
2. **Choose the tools and Agents.** Keep the suggested Preset or adjust it. Add saved Skills/MCP; **Find more tools** lets you scan, paste a link/command, use AI or import individual Skills from a source without leaving the project.
3. **Review → Apply.** Read the exact file changes and compatibility notes. Applying is a separate action; existing authored guidance stays protected.
4. **Start working.** The handoff shows your Agent's project discovery paths, a starting prompt and history/recovery access. Returning to the folder restores privately reviewed exact choices. Unfinished edits can be recovered in the same tab after reload.

The [library explorer](docs/LIBRARY.md) separates content type, platform, technology and task, with source/project/agent refinements, visible filter chips and saved browser views. Classification can be corrected without editing snapshot content.

The library groups sources and content versions, with project/tag filters, custom forks, supporting-file editors, archives and provenance receipts. Presets inherit; directives follow global → domain → stack → project scope. Instruction and memory files load only when opened, and edits use the same plan/rollback engine.

## CLI

```sh
bun run rigshelf --help
rigshelf scan
rigshelf setup ~/Developer/my-app --preset expo --agents claude,codex
rigshelf diff <plan-id> --file AGENTS.md
rigshelf apply <plan-id>
rigshelf rollback <plan-id>
rigshelf find "SwiftUI gestures"
rigshelf add-source "bunx skills add expo/skills"
rigshelf connection --agents claude,codex
mkdir -p "$HOME/Backups"
rigshelf export "$HOME/Backups/kitfold-library.json.gz"
```

`setup` prepares a plan by default; add `--apply` for an explicitly requested immediate setup. `--entries ""` produces guidance only. `--replace-existing` permits reviewed replacements of differing skill files while preserving original bytes for rollback. Project-external symlinks remain protected.

Automatic additions need both project permission and approval of each exact clean snapshot:

```sh
rigshelf trust <entry-id>
rigshelf automation ~/Developer/my-app on
rigshelf watch ~/Developer/my-app --auto
```

Use `automation ... off` or `untrust <entry-id>` to revoke either permission. The workbench runs the same watcher while open. New upstream versions require a new review; existing guidance stays unchanged during automatic additions.

## In an agent session

Rigshelf exposes a stdio MCP server and a small [integration skill](skills/kitfold/SKILL.md).

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

This is a Claude-style example; other harnesses use their own MCP configuration. Read/plan tools are available by default. To authorize mutations, use `mcp --write --root /absolute/project/path`. Write tools reject plans outside those roots. A writable connection can also edit the private library; enable it only in a trusted session. Model selection inside T3 is separate from the underlying harness's file discovery.

AI assistance uses an explicitly chosen installed Claude Code/Codex CLI, local Ollama model or a waiting draft request in a connected MCP session. Generation starts only when requested; CLI login, usage limits and billing can apply. The app does not read CLI credential stores. Review the proposal before saving. See [AI assistance](docs/AI-ASSISTANCE.md).

## Your data

The default catalog is `~/.local/share/kitfold/catalog.sqlite`; `RIGSHELF_DATA_DIR` overrides it; the legacy `KITFOLD_DATA_DIR` remains accepted. Renaming does not move or empty an existing catalog. SQLite and the data directory are private to the local user. Content snapshots, rollback preimages and project paths stay outside this source tree. There is no hosted registry, telemetry or conversation/session collection.

Versioned JSON and compressed JSON archives contain library content, sources, presets and rules. Projects, access keys, session data, automation approvals and rollback preimages are excluded. Sensitive-looking records are omitted with an explicit report inside the archive. Treat custom content and source notes as private. See [data formats](docs/DATA.md) and [security](SECURITY.md).

## Verification

```sh
bun run check
bun run format
bun run verify
bun run lint
bunx playwright install chromium
bun run test:ui
```

Tests use isolated disposable projects. They do not write into existing development repositories or agent configuration. [Validation notes](docs/VALIDATION.md) describe coverage and practical limitations; heuristics and passing tests are not security guarantees.

## More detail

- [First project walkthrough](docs/QUICKSTART.md) and the in-app **Getting started** guide
- [Product requirements](docs/PRODUCT.md) and [acceptance record](docs/ACCEPTANCE.md)
- [Architecture and decisions](docs/DECISIONS.md)
- [Provider formats and limitations](docs/COMPATIBILITY.md)
- [Source research](docs/RESEARCH.md)
- [Security review and evidence limits](docs/SECURITY-REVIEW.md)
- [Contributing](CONTRIBUTING.md)

UI fonts are distributed under their original OFL licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

MIT licensed. Rigshelf is an independent project and is not affiliated with the supported harness vendors.
