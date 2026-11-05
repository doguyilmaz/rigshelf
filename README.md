# Kitfold

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

Open the **private access URL** printed in the terminal. The workbench listens on `127.0.0.1:47471`. The URL contains an access key; keep it private. Stop with Ctrl-C.

Choose **Settings → Language** for English or Turkish. The choice is local to your browser and preserves current drafts. The [six-language release plan](docs/LOCALIZATION.md) tracks additional translations.

To compare the proposed setup layouts while the app is running, open `/prototypes/project-setup.html?v=1`, `?v=2` or `?v=3` on the same local server. The prototypes are interactive and use fictional data. They do not apply project changes. The product name and final visual direction remain under review; see [naming](docs/NAMING.md) and [design alternatives](docs/DESIGN-REVIEW.md).

For a global executable, run `bun link` in this checkout. This registers the `kitfold` command; it does not install global skills. Generated MCP bridges require that command on the target harness's `PATH`.

## A normal day

1. **Library → Scan this machine.** Read installed skills, plugin skill caches and MCP definitions directly. Scanning never edits those installations.
2. **Set up a project.** Enter a new or existing directory and optional requirements. Pick a preset or let manifests guide the recommendation.
3. **Choose your agents.** Inspect findings, adjust the small kit, review file previews and apply.
4. **Keep building.** Start or reload the agent session. Enable trusted additions per project if you want dependency changes to add already approved, pinned snapshots.

The [library explorer](docs/LIBRARY.md) separates content type, platform, technology and task, with source/project/agent refinements, visible filter chips and saved browser views. Classification can be corrected without editing snapshot content.

The library groups sources and content versions, with project/tag filters, custom forks, supporting-file editors, archives and provenance receipts. Presets inherit; directives follow global → domain → stack → project scope. Instruction and memory files load only when opened, and edits use the same plan/rollback engine.

## CLI

```sh
bun run kitfold --help
kitfold scan
kitfold setup ~/Developer/my-app --preset expo --agents claude,codex
kitfold diff <plan-id> --file AGENTS.md
kitfold apply <plan-id>
kitfold rollback <plan-id>
kitfold find "SwiftUI gestures"
kitfold add-source "bunx skills add expo/skills"
kitfold connection --agents claude,codex
mkdir -p "$HOME/Backups"
kitfold export "$HOME/Backups/kitfold-library.json.gz"
```

`setup` prepares a plan by default; add `--apply` for an explicitly requested immediate setup. `--entries ""` produces guidance only. `--replace-existing` permits reviewed replacements of differing skill files while preserving original bytes for rollback. Project-external symlinks remain protected.

Automatic additions need both project permission and approval of each exact clean snapshot:

```sh
kitfold trust <entry-id>
kitfold automation ~/Developer/my-app on
kitfold watch ~/Developer/my-app --auto
```

Use `automation ... off` or `untrust <entry-id>` to revoke either permission. The workbench runs the same watcher while open. New upstream versions require a new review; existing guidance stays unchanged during automatic additions.

## In an agent session

Kitfold exposes a stdio MCP server and a small [integration skill](skills/kitfold/SKILL.md).

```json
{
  "mcpServers": {
    "kitfold": {
      "command": "kitfold",
      "args": ["mcp"]
    }
  }
}
```

This is a Claude-style example; other harnesses use their own MCP configuration. Read/plan tools are available by default. To authorize mutations, use `mcp --write --root /absolute/project/path`. Write tools reject plans outside those roots. A writable connection can also edit the private library; enable it only in a trusted session. Model selection inside T3 is separate from the underlying harness's file discovery.

For explicit AI assistance, choose a prompt handoff provider or an installed Ollama model in Settings. The app does not read CLI credential stores or launch paid models. See [compatibility](docs/COMPATIBILITY.md).

## Your data

The default catalog is `~/.local/share/kitfold/catalog.sqlite`; `KITFOLD_DATA_DIR` overrides it. SQLite and the data directory are private to the local user. Content snapshots, rollback preimages and project paths stay outside this source tree. There is no hosted registry, telemetry or conversation/session collection.

Versioned JSON and compressed JSON archives contain library content, sources, presets and rules. Projects, access keys, session data, automation approvals and rollback preimages are excluded. Sensitive-looking records are omitted with an explicit report inside the archive. Treat custom content and source notes as private. See [data formats](docs/DATA.md) and [security](SECURITY.md).

## Verification

```sh
bun run verify
bun run lint
bunx playwright install chromium
bun run test:ui
```

Tests use isolated disposable projects. They do not write into existing development repositories or agent configuration. [Validation notes](docs/VALIDATION.md) describe coverage and practical limitations; heuristics and passing tests are not security guarantees.

## More detail

- [Product requirements](docs/PRODUCT.md) and [acceptance record](docs/ACCEPTANCE.md)
- [Architecture and decisions](docs/DECISIONS.md)
- [Provider formats and limitations](docs/COMPATIBILITY.md)
- [Source research](docs/RESEARCH.md)
- [Security review and evidence limits](docs/SECURITY-REVIEW.md)
- [Contributing](CONTRIBUTING.md)

MIT licensed. Kitfold is an independent project and is not affiliated with the supported harness vendors.
