# Harness compatibility

New catalog connection snippets use the `rigshelf` command and connection name; the MCP handshake identifies Rigshelf. Existing `kitfold` commands/connections and `kitfold_*` tool names remain supported. Use one catalog connection per Harness: keep an existing legacy entry or deliberately replace it, rather than adding the new snippet alongside it. Persisted project files, forwarding bridges, format keys and recovery identities retain their documented compatibility names. See [brand compatibility](BRANDING.md).

AI authoring is a separate runtime capability: Claude Code and Codex have bounded native generation runners, Ollama uses the fixed local service, saved local/remote API profiles support a bounded Chat Completions text/JSON subset, and other Harnesses can answer explicitly created requests through a connected Rigshelf MCP session. API compatibility is protocol-level fixture coverage; each real vendor/model still needs acceptance. No unattended Kiro/OpenCode/Antigravity/Grok command format is claimed. See [AI assistance](AI-ASSISTANCE.md) for flags, native-login limits and source references. Project-file adapters below retain their existing behavior.

Read-only inventory recognizes native Agent definitions, Commands, Hooks, known config files, Plugin manifests/cache components and Claude Agent memory scopes. Files remain data for explicit inspection; discovery never runs them or promises portable conversion of Plugin execution/approval semantics. OpenCode's explicit `OPENCODE_CONFIG_DIR` is supported. See [AI discovery](AI-DISCOVERY.md) for exclusions and bounds.

Mappings were rechecked against primary vendor documentation on 2026-11-06; see [research](RESEARCH.md). They produce project files; the host agent controls when it discovers or approves those files.

| Harness | Skills | Guidance | MCP |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>` | managed block in `CLAUDE.md`; references shared `AGENTS.md` when applicable. A `CLAUDE.md` link to the project `AGENTS.md`, or an `AGENTS.md` link to `CLAUDE.md`, stays a link and the guidance goes into the file it points to; other links are refused | `.mcp.json` |
| Codex | `.agents/skills/<name>` | `AGENTS.md` | `.codex/config.toml` |
| Kiro | `.kiro/skills/<name>` | shared `AGENTS.md` | `.kiro/settings/mcp.json` |
| OpenCode | `.agents/skills/<name>` | `AGENTS.md` | `opencode.json` or existing `opencode.jsonc`, preserving unrelated comments/settings |
| Antigravity | `.agents/skills/<name>` | `AGENTS.md` | `.agents/mcp_config.json` |
| Official Grok CLI | `.grok/skills/<name>` | `AGENTS.md` | `.grok/config.toml` |

T3's selected model is separate from the underlying harness. Choose the actual harness that runs the session. Ollama is a local model endpoint for explicit proposals, not a skill-discovery format.

In CLI setup, explicit `--agents` takes precedence. Without that flag, an explicit `--preset` supplies its own Agent defaults; automatic Preset detection uses the application defaults. The web workbench preserves deliberate/recovered/reviewed Agent choices and offers a separate action to adopt Preset defaults. These are selection defaults, not evidence that a Harness is installed or has loaded the setup.

Definition-writing clients retain legacy explicit upserts. For a new record use CLI `save-preset`/`save-rule --create-only` or writable MCP `createOnly: true`. For a checked edit use CLI `--expect previous.json` or MCP `expected` with the previously read full definition. A stale check fails and leaves the newer record intact. Create-only and expected controls are mutually exclusive; neither grants Apply or automation permission.

An existing project skill folder installed from the same upstream revision is adopted even though Rigshelf normalizes its frontmatter name. A different unmanaged revision is kept for that harness and reported in the plan, naming the `skills-lock.json` source when the `skills` CLI installed it; explicit replacement retains the original bytes for rollback. When a project link makes two harnesses read one skills folder, that folder receives the most restrictive portable frontmatter. Recommendations list review-flagged entries without selecting them. Running the default setup again keeps the same focused kit.

A Claude-only setup in a repository with an authored `AGENTS.md` imports it from `CLAUDE.md`, because a `CLAUDE.md` stops Claude Code from reading `AGENTS.md` on its own. With Codex selected, the plan warns when `AGENTS.override.md` shadows `AGENTS.md` or when `AGENTS.md` exceeds Codex's default 32 KiB guidance limit. The managed block follows CRLF line endings of authored guidance.

Skill resources retain relative paths and executable intent. Unsupported Claude-specific hooks, model, context and tool-approval metadata are omitted with compatibility notes. Manual-only invocation is retained only where its semantics are documented; incompatible targets are refused rather than made automatically callable. Harness-specific prose still needs author review. Native Plugins are retained as saved recipes or typed native references with scoped installation/configuration/cache/catalog evidence. Rigshelf does not install native Plugin packages or convert their Hooks/permissions into portable Skills. Discovery and activation are separate; see [AI discovery](AI-DISCOVERY.md#native-plugin-references-in-library).

Native-only MCP execution/authentication fields are not silently converted. Codex local `env_vars` strings and `{name, source: "local"}` references are supported; remote environment references/executor selection, dynamic header helpers and first-party session authentication stay native with per-server inventory diagnostics. Other portable servers in that file remain discoverable. Custom OAuth/ADC configuration and unsupported transports such as native WebSocket remain native as well. Account OAuth tokens are not copied.

MCP definitions have canonical stdio/HTTP/SSE transport, arguments, environment references, headers, optional working directory and tool filters. Adapters use native support when documented. For gaps such as unsupported filters, SSE, composed environment values or working-directory semantics, a project-local canonical definition and `kitfold mcp-proxy` bridge preserve the supported behavior. The `kitfold` executable must be on `PATH` for a bridge. Missing required environment variables fail with the variable name, without exposing values.

The bridge forwards tool calls, resources and prompts supported by the upstream server, applies allow/deny filters to both listing and calls, and forwards declared environment references with a small runtime environment. It does not provide full fidelity for experimental MCP extensions, sampling or elicitation; it is not an execution sandbox. Reconnect after changing definitions. Native harness trust and MCP approval prompts still apply.

Relative bridge definitions are found in the working directory or its parents so harnesses can start inside a project subdirectory. An existing empty or invalid definition stops discovery with an error; it never falls through to an ancestor server. Absolute definition paths do not search parents.

Project-local aliases between the same skill location can share a canonical file. Links to global or external directories are protected; copy them into the project before a managed replacement. Distinct revisions with the same portable name cannot be selected together. Both OpenCode JSON and JSONC existing at once require choosing one active configuration.

Detection covers JavaScript/TypeScript, Expo/React Native, Swift/Objective-C Apple projects, Kotlin/Android/JVM, Go, Rust, Python and .NET signals, including bounded common workspace layouts. Requirements and manual classification resolve ambiguous layouts. Detection does not scaffold application code or install application dependencies.

macOS is the primary development/test platform. The CI workflow targets Linux. Native Windows paths and every live vendor CLI/version have not been manually certified. Generated formats and conversions are tested with local fixtures, and compatibility notes remain visible in each plan.

Directory fields offer typed paths and a local native chooser. See [directory selection](DIRECTORY-SELECTION.md) for adapters, platform validation limits and the distinction between choosing a folder and granting project authority.

Read-only inventory extends beyond generated setup paths: nested and gitignored AI locations, user-scoped Claude project memory, known global harness directories, explicit Claude/Codex config roots and known Aims profile locations are supported. Shared aliases retain their origin and are deduplicated. Account/session stores and dependency directories are excluded. [AI discovery](AI-DISCOVERY.md) records exact scope and bounds; it does not imply automatic context loading or support for arbitrary undocumented storage formats.

Settings also supports twenty explicit custom configuration roots with a selected native format. Wrapper tools can reuse those known file layouts, including project memory stored under a custom Claude profile. This does not add an undocumented T3/Omni database reader or collect conversations; the selected root must actually contain supported native configuration.

## Library backup transports

Backup is separate from Harness setup and AI generation. GitHub.com supports existing private repositories, initialized branches, one commit/PR per reviewed batch, explicit merge/status/closure and integrity-checked history/restore. It uses a selected fine-grained token environment reference, Git Trees/Commits/Refs and PR REST APIs. GitHub Enterprise, OAuth login and SSH are not supported. Native protection rules still apply; no force push or per-file commit is used.

S3/R2/MinIO use Bun native S3 signing, path-style addressing, explicit endpoint/bucket/region and selected environment references. HTTPS is required except loopback HTTP. Conditional object create/replace and ETags are mandatory and probed before publication. A service failing those checks is refused. Provider behavior is covered by isolated protocol fixtures; real-account acceptance must be done for the chosen service. No remote retention, encryption-key management or automatic pruning is provided. See [setup and limits](BACKUP-SYNC.md).
