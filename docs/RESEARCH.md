# Research log

Agent contract links rechecked 2026-11-06. Links describe evidence, not permanent compatibility guarantees.

## Packaging contracts · 2026-11-07

- [Bun standalone executables](https://bun.com/docs/compiler/executables) documents embedded directory assets, explicit runtime paths, cross-target executable selection and disabling automatic configuration loading. Rigshelf uses the stable JIT-backed compiler; experimental AOT remains separate work.
- [Bun installation backends](https://bun.com/docs/pm/cli/install#platform-specific-backends) documents the Linux/Windows hard-link default and explicit `copyfile` backend. Dedicated release installs use copied inputs because packaged notice collection rejects linked files and directories.
- [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) documents the Linux/macOS runner families used by the manual artifact workflow. A prepared workflow is not evidence that it has run.
- [Upload Artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) is pinned to its exact commit. Only the named release archives and checksum sidecars are selected; no private catalog or general `.local` tree is uploaded.
- [Checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [Setup Bun v2.2.0](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0) are pinned to their published commits. Checkout credential persistence is disabled; the manual artifact workflow has read-only repository permission and no release publication step.

## Agent contracts

- [Agent Skills specification](https://agentskills.io/specification): a skill is a folder, not just its Markdown file. Preserve references, assets, and scripts. Metadata is discovered before the body is activated. A library outside provider discovery paths avoids listing every skill in every session.
- [Claude Code skills](https://code.claude.com/docs/en/skills): project skill folders and plugin skills have distinct provenance. Claude-specific execution features must not silently acquire equivalent semantics in another harness.
- [OpenCode skills](https://opencode.ai/docs/skills/): supports its own skill folders and shared `.agents/skills` folders. [MCP configuration](https://opencode.ai/docs/mcp-servers/) uses local/remote records, command arrays, and an `environment` field. Blindly copying Claude MCP JSON would be incorrect.
- [Kiro skills](https://kiro.dev/docs/skills/) and [scope rules](https://kiro.dev/docs/configuration/): project skills and steering are separate capabilities. [Kiro MCP](https://kiro.dev/docs/mcp/configuration/) uses `mcpServers`; permission grants must not be broadened by conversion.
- [Antigravity discovery](https://antigravity.google/docs/customization-discovery?tab=cli) and [MCP](https://antigravity.google/docs/mcp): distinguish CLI/IDE versions and workspace support. Do not assume the old global-only MCP path covers every surface.
- [Skills CLI](https://github.com/vercel-labs/skills): prefer recording `bunx skills add` recipes for compatible repositories. Listing and installation are different operations; installation may invoke network access and must be explicit.
- The user confirmed T3 and the native Grok CLI. [Official Grok skills](https://docs.x.ai/build/features/skills-plugins-marketplaces) and [MCP](https://docs.x.ai/build/features/mcp-servers) document `.grok/skills`, AGENTS.md, and project `.grok/config.toml`. The Grok adapter now targets that CLI. In T3, choose the underlying harness; a selected model name does not by itself establish discovery paths. Ollama remains a model endpoint, separate from harness conversion.

## Compatibility details established during implementation

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) distinguishes `env_vars`, `env_http_headers`, and `bearer_token_env_var`. Literal `${VAR}` strings are not equivalent to those options.
- [OpenCode variables](https://opencode.ai/docs/config/) use `{env:VAR}`. Adapters translate canonical placeholders rather than copying another harness's strings.
- [Antigravity MCP](https://antigravity.google/docs/mcp) documents cwd and tool allow/deny fields, but the checked page does not establish `${VAR}` interpolation. Authenticated definitions that need it use a Rigshelf bridge rather than a guessed schema.
- The optional MCP bridge preserves stdio/HTTP/SSE, resolves declared environment references, and enforces tool allow/deny lists. Native formats remain the first choice. Sampling, elicitation, and arbitrary experimental MCP capabilities are outside the bridge contract; preserve a native integration when those are needed.
- Claude manual-only skill invocation is preserved where documented. Conversion refuses a manual-only skill when the target's equivalent policy cannot be established; it does not silently make it automatically invocable.

## Integration maintenance check

The catalog MCP server, forwarding bridge, integration Skill and six adapters were compared with these contracts. Codex now documents remote executor environment selection, sourced `env_vars` objects and dynamic HTTP header helpers. Local variable references are portable; remote selection, remote references, helper execution and first-party session authentication remain native and are reported rather than silently dropped. Antigravity CLI uses workspace `.agents/mcp_config.json` and Streamable HTTP; legacy SSE uses the explicit bridge. Kiro's former CLI configuration URL redirects to its shared configuration-scope page.

Local help was inspected with Bun 1.4.4, Codex CLI 0.166.0 and Claude Code 2.1.318. The bounded runner isolation flags are present in those help outputs; no paid model invocation or native account login was performed. This does not certify every installed or future client version. See [MCP contracts](MCP.md) and [maintenance](MAINTENANCE.md).

## Existing local implementation

Inventory reads actual skill files and project manifests directly. No external catalog seeds the application, and discovery does not change existing agent configuration.

## Important classifications

- The supplied Flamerix gist is a Claude runtime preload workaround, not an Agent Skill. Its performance claims are author claims, not independently verified measurements. Keep as a manual resource with an execution-risk note; do not run it during import.
- A skills.sh listing means a directory entry exists; it is not publisher verification or a security approval.
- Marketplace install commands are provider-specific plugin recipes. Do not reinterpret a plugin as a plain skill and lose hooks/MCP/settings.
- Social links and missing `image.png` attachments are unresolved research references. The prompt did not include either image's contents; do not fabricate them.
- `scoly`, `allowBackup`, and the profiler notes are requirement/discovery keywords until a specific source or package is identified.

## Evidence labels

Use separate fields for source reachability, publisher ownership, listing availability, static scan findings, content digest, and reviewed date. A reachable GitHub repository can still contain unsafe code. A static scan can miss unsafe instructions. Never show a generic “verified safe” badge.

## Public collection research result

The development source research checked 38 supplied GitHub repositories successfully and indexed 705 SKILL.md paths at immutable commits. This is dated source availability evidence, not publisher certification. Raw references and ambiguous social/image notes remain in the seed file. No installer was executed.
