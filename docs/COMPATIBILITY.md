# Harness compatibility

Mappings are based on primary vendor documentation linked in [research](RESEARCH.md). They produce project files; the host agent controls when it discovers or approves those files.

| Harness | Skills | Guidance | MCP |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>` | managed block in `CLAUDE.md`; references shared `AGENTS.md` when applicable | `.mcp.json` |
| Codex | `.agents/skills/<name>` | `AGENTS.md` | `.codex/config.toml` |
| Kiro | `.kiro/skills/<name>` | shared `AGENTS.md` | `.kiro/settings/mcp.json` |
| OpenCode | `.agents/skills/<name>` | `AGENTS.md` | `opencode.json` or existing `opencode.jsonc`, preserving unrelated comments/settings |
| Antigravity | `.agents/skills/<name>` | `AGENTS.md` | `.agents/mcp_config.json` |
| Official Grok CLI | `.grok/skills/<name>` | `AGENTS.md` | `.grok/config.toml` |

T3's selected model is separate from the underlying harness. Choose the actual harness that runs the session. Ollama is a local model endpoint for explicit proposals, not a skill-discovery format.

Skill resources retain relative paths and executable intent. Unsupported Claude-specific hooks, model, context and tool-approval metadata are omitted with compatibility notes. Manual-only invocation is retained only where its semantics are documented; incompatible targets are refused rather than made automatically callable. Harness-specific prose still needs author review. A native plugin is retained as a native recipe; Kitfold does not pretend its hooks or permissions become a portable skill.

MCP definitions have canonical stdio/HTTP/SSE transport, arguments, environment references, headers, optional working directory and tool filters. Adapters use native support when documented. For gaps such as unsupported filters, SSE, composed environment values or working-directory semantics, a project-local canonical definition and `kitfold mcp-proxy` bridge preserve the supported behavior. The `kitfold` executable must be on `PATH` for a bridge. Missing required environment variables fail with the variable name, without exposing values.

The bridge forwards tool calls, resources and prompts supported by the upstream server, applies allow/deny filters to both listing and calls, and forwards declared environment references with a small runtime environment. It does not provide full fidelity for experimental MCP extensions, sampling or elicitation; it is not an execution sandbox. Reconnect after changing definitions. Native harness trust and MCP approval prompts still apply.

Relative bridge definitions are found in the working directory or its parents so harnesses can start inside a project subdirectory. An existing empty or invalid definition stops discovery with an error; it never falls through to an ancestor server. Absolute definition paths do not search parents.

Project-local aliases between the same skill location can share a canonical file. Links to global or external directories are protected; copy them into the project before a managed replacement. Distinct revisions with the same portable name cannot be selected together. Both OpenCode JSON and JSONC existing at once require choosing one active configuration.

Detection covers JavaScript/TypeScript, Expo/React Native, Swift/Objective-C Apple projects, Kotlin/Android/JVM, Go, Rust, Python and .NET signals, including bounded common workspace layouts. Requirements and manual classification resolve ambiguous layouts. Detection does not scaffold application code or install application dependencies.

macOS is the primary development/test platform. The CI workflow targets Linux. Native Windows paths and every live vendor CLI/version have not been manually certified. Generated formats and conversions are tested with local fixtures, and compatibility notes remain visible in each plan.

Directory fields offer typed paths and a local native chooser. See [directory selection](DIRECTORY-SELECTION.md) for adapters, platform validation limits and the distinction between choosing a folder and granting project authority.

Read-only inventory extends beyond generated setup paths: nested and gitignored AI locations, user-scoped Claude project memory, known global harness directories, explicit Claude/Codex config roots and known Aims profile locations are supported. Shared aliases retain their origin and are deduplicated. Account/session stores and dependency directories are excluded. [AI discovery](AI-DISCOVERY.md) records exact scope and bounds; it does not imply automatic context loading or support for arbitrary undocumented storage formats.
