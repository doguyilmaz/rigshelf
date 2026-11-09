# Rigshelf

Set up coding agents for each project from your own library.

Keep Skills, MCP servers, Plugins and directives in one local Library. For each project, pick a small kit and the agents you use, review the exact file changes, and apply. Nothing in the Library loads into an agent session until a project's kit includes it.

**Claude Code · Codex · Kiro · OpenCode · Antigravity · Grok CLI**

## Install

```sh
brew install doguyilmaz/tap/rigshelf
rigshelf ui
```

Or run it without installing: `bunx @doguyilmaz/rigshelf ui`. Rigshelf opens a private workbench in your browser at `http://rigshelf.localhost:47471/#access=…`. It listens on loopback only; keep the access link private.

To let Claude Code or Codex use your Library from a session, add the plugin (it needs `rigshelf` on `PATH`):

```sh
claude plugin marketplace add doguyilmaz/rigshelf && claude plugin install rigshelf@rigshelf
codex plugin marketplace add doguyilmaz/rigshelf && codex plugin add rigshelf@rigshelf
```

Portable archives, standalone executables and a container image are described in [installation](docs/DISTRIBUTION.md).

## Set up a project

1. **Choose a folder:** an existing project, an empty folder, or the built-in example.
2. **Build the kit:** Rigshelf detects the stack and suggests a Preset. Choose your agents and add Skills or MCP servers from the Library.
3. **Review:** see every file that will change, with content findings and compatibility notes.
4. **Apply:** files are written through a plan you can roll back. Reopen your agent to pick them up.

The [walkthrough](docs/QUICKSTART.md) covers returning projects and recovery. Setup writes agent configuration and guidance only; it does not scaffold code or install dependencies.

## The Library

| Content | How Rigshelf handles it |
| --- | --- |
| Skills | Immutable Snapshots with their supporting files, converted to each agent's documented layout. |
| MCP | One definition with environment placeholders, rendered to each agent's native format. |
| Plugins | Native references and install evidence; installing and running hooks stays with the agent. |
| Presets and directives | Reusable starting kits per stack and scoped guidance. |
| Memory and AI files | Discovered and opened on request; edits go through a plan. Conversations and account files are never read. |

Add sources from GitHub, [skills.sh](https://skills.sh) or local folders; see [the Library](docs/LIBRARY.md). Updating a source adds a new Snapshot and never changes an existing project on its own ([maintenance](docs/MAINTENANCE.md)).

## CLI

```sh
rigshelf scan --root ~/Developer
rigshelf setup ~/Developer/app --preset expo --agents claude,codex
rigshelf diff <plan-id> --file AGENTS.md
rigshelf apply <plan-id>
rigshelf rollback <plan-id>
rigshelf --help
```

## Working on a server

```sh
rigshelf machine compare my-server   # what differs, grouped and per item
rigshelf machine sync my-server      # prepare plans there; add --apply to apply
rigshelf ui my-server                # the server's workbench here, through an SSH tunnel
```

Uses your `~/.ssh/config`; nothing is exposed to the network. See [remote machines](docs/REMOTE.md).

## AI assistance

Turn rough notes, links or install commands into reviewed drafts with your installed Claude Code or Codex CLI, a local Ollama model or any Chat Completions endpoint. Drafts never save or apply on their own. See [AI assistance](docs/AI-ASSISTANCE.md).

## Data and backup

The catalog lives in `~/.local/share/rigshelf` (override with `RIGSHELF_DATA_DIR`). **Settings → Manage backups** syncs the Library to a private GitHub repository or an S3-compatible bucket after you review the changes. See [data](docs/DATA.md) and [backup](docs/BACKUP-SYNC.md).

## Documentation

- [Agent formats and limits](docs/COMPATIBILITY.md) · [agent contracts](docs/AGENT-CONTRACTS.md) · [MCP integration](docs/MCP.md)
- [Product](docs/PRODUCT.md) · [engineering decisions](docs/DECISIONS.md) · [security model](docs/SECURITY-MODEL.md)
- [Contributing](CONTRIBUTING.md) · [testing](docs/TESTING.md) · [languages](docs/LOCALIZATION.md)

## License

MIT. Bundled fonts keep their OFL licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Rigshelf is independent of the agent vendors it supports.
