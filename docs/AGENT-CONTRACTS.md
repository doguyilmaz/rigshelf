# Agent contracts

The vendor documentation each adapter follows. Formats change; recheck these pages when an agent releases a new configuration format (see [maintenance](MAINTENANCE.md)).

## Skills

- [Agent Skills specification](https://agentskills.io/specification): a Skill is a folder, not only its Markdown file. References, assets and scripts are preserved. Metadata is discovered before the body is loaded, so a Library outside discovery folders keeps unrelated Skills out of every session.
- [Claude Code skills](https://code.claude.com/docs/en/skills): project Skill folders and plugin Skills have separate provenance. Claude-specific features such as manual-only invocation are kept where documented; conversion refuses a manual-only Skill when the target cannot express the same policy.
- [OpenCode skills](https://opencode.ai/docs/skills/): its own folders and the shared `.agents/skills` folder.
- [Kiro skills](https://kiro.dev/docs/skills/) and [configuration scopes](https://kiro.dev/docs/configuration/): Skills and steering are separate capabilities.
- [Antigravity discovery](https://antigravity.google/docs/customization-discovery?tab=cli): CLI and IDE versions differ in workspace support.
- [Grok skills](https://docs.x.ai/build/features/skills-plugins-marketplaces): `.grok/skills`, `AGENTS.md` and project `.grok/config.toml`.
- [Skills CLI](https://github.com/vercel-labs/skills): Rigshelf records `bunx skills add` recipes for compatible repositories. Listing and installing are separate; installing needs network access and is always explicit.

## MCP

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) distinguishes `env_vars`, `env_http_headers` and `bearer_token_env_var`; a literal `${VAR}` string is not equivalent. Remote executor selection and helper commands stay native and are reported rather than dropped.
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/) uses local/remote records, command arrays and an `environment` field, with `{env:VAR}` [variables](https://opencode.ai/docs/config/). Claude MCP JSON cannot be copied as is.
- [Kiro MCP](https://kiro.dev/docs/mcp/configuration/) uses `mcpServers`; conversion never broadens permission grants.
- [Antigravity MCP](https://antigravity.google/docs/mcp) documents `cwd` and tool allow/deny lists in workspace `.agents/mcp_config.json`, but not `${VAR}` interpolation. Definitions that need it use the Rigshelf bridge instead of a guessed schema.
- [Grok MCP](https://docs.x.ai/build/features/mcp-servers).

The optional bridge forwards stdio, HTTP and SSE servers, resolves declared environment references and enforces tool allow/deny lists at discovery and call time. Native formats come first. Sampling, elicitation and experimental MCP features are outside the bridge; keep a native integration when you need them.

## Plugins and listings

- Marketplace install commands are provider-specific Plugin recipes. A Plugin is never reduced to a plain Skill, because that would lose its hooks, MCP servers and settings.
- A skills.sh listing means a directory entry exists. It is not publisher verification or a security review.
- Source evidence keeps reachability, publisher ownership, listing availability, static findings, content digest and review date as separate fields. Rigshelf never shows a generic "verified safe" badge.

## Packaging

- [Bun standalone executables](https://bun.com/docs/compiler/executables): embedded assets, explicit runtime paths, cross-target builds and disabled automatic configuration loading.
- [Bun install backends](https://bun.com/docs/pm/cli/install#platform-specific-backends): release installs use the `copyfile` backend because notice collection rejects linked files.
- Workflow actions are pinned to exact commits; checkout does not persist credentials.
