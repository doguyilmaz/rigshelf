# Remote machines (proposal)

Status: available in the CLI: read-only inventory, compare and doctor; `machine sync`/`machine apply` for project kits, the Library they use and directives; and `rigshelf ui --on` with a remote badge. `machine sync --memory <project>` adds opted-in memory as a separate plan. Settings → Machines offers the same check, prepare and confirmed apply in the workbench.

## Problem

Working on a server over SSH, the agent setup that exists on the laptop is missing: global Skills and guidance, harness settings, and the gitignored project files that a clone never brings (installed project Skills, `CLAUDE.local.md`, `.claude/settings.local.json`, rules, hooks, memory).

A feasibility spike compared a laptop with a fresh server state (a `git clone` of each project and an empty home) using real projects:

- A mobile project was missing 592 project Skill files, 6 rules/agents/hooks, 3 MCP configuration files and 124 memory files.
- Another project was missing 312 Skill files although nothing in its repository mentions them.
- A third project, cloned under a different folder name, matched by repository and showed 548 files in sync and 5 missing.
- The global layer held about 3,750 Skill files across six harness folders and eight settings and guidance files.

The spike also showed that byte-for-byte copying is wrong for part of this: memory folders and several settings files are keyed by absolute paths, and some files are private account or local settings.

## Principles

- One transport: the system `ssh` with the user's `~/.ssh/config`, keys and agent. Rigshelf stores no passwords or keys and opens no port.
- Read first. Comparing is read-only on both machines; changing a machine always goes through a reviewed plan applied by Rigshelf on that machine, with the existing preconditions, journal and rollback.
- Reproduce, don't mirror. The goal is that the server can produce the same project setup, not a copy of every global file. Global Skills stay discouraged, as on the laptop.
- Secrets never travel. Private files are reported by name and status only; required environment variables are reported by name.

## Machines

A machine is an SSH host alias chosen from `~/.ssh/config`. Adding it runs one probe:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 <alias> -- '$SHELL -lc "rigshelf --version"'
```

The login shell finds Homebrew and Bun installs that a non-interactive shell misses. If Rigshelf is absent or a different version, the UI shows the install command (`brew install doguyilmaz/tap/rigshelf` or `bunx @doguyilmaz/rigshelf`). Host keys follow the user's `StrictHostKeyChecking`; an unknown or changed key stops with OpenSSH's own message. Connections reuse one `ControlMaster` socket in a user-only directory. Agent forwarding stays off.

Each request is one remote command that prints JSON:

| Command on the machine | Purpose |
| --- | --- |
| `rigshelf machine inventory --json [--root /dir]` | Read-only manifest: global and project items with path-independent keys and digests. No file bodies. Without a configured root that exists, it searches the home folder. |
| `rigshelf machine prepare --json [--replace-directives] [--root /dir]` | Reads a sync bundle on stdin: imports the sent Library entries additively, adds missing directives (replaces differing ones only with `--replace-directives`) and prepares one setup plan per clone matched by repository. No project file is written. |
| `rigshelf apply <plan-id>` | Applies one prepared plan with the usual preconditions, journal and rollback. |
| `rigshelf machine doctor --json` | Environment checks listed below. |

## Matching projects

Projects match by repository key: the normalized `origin` URL read from `.git/config` (no `git` process), plus the workspace path inside the repository. A folder name or absolute path never decides the match. Unmatched projects can be paired manually; the pairing and the path mapping are stored per machine.

## What is compared

Three layers, each grouped by harness and kind, with drill-down to single items:

- **Library**: Skills, MCP definitions, Presets and directives by Snapshot digest. Moving the Library uses the existing export bundle or backup destination.
- **Global**: per harness, Skills (compared per Skill folder digest), guidance, MCP configuration and settings.
- **Project**: the applied kit, gitignored agent files (local guidance, local settings, rules, agents, hooks) and memory.

Each item has one status and one suggested action:

| Status | Meaning | Action |
| --- | --- | --- |
| In sync | Same digest on both machines | None |
| Missing on server / missing here | Only one side has it | Copy through a reviewed plan |
| Different | Both have it with different digests | Show the diff; choose a side |
| Machine-specific | Contains absolute paths or is path-keyed (memory, trust, local MCP scope) | Re-map paths; never copy bytes |
| Private | Account state, local settings, `.env*`, credential-like content | Report only; set up by hand |
| Not portable | The harness is not installed on that machine | Doctor explains how to install it |

## Doctor

Rigshelf version on both sides; harness CLIs present on the server; Codex project trust and Claude Code project MCP approval (reported, never granted remotely); required environment variable names present; `PATH` for non-interactive shells; free disk space for a planned bundle; clock skew.

## Transport security

| Option | Authentication | Exposure | Decision |
| --- | --- | --- | --- |
| System `ssh` (chosen) | The user's keys, agent, `~/.ssh/config` and host key verification | No new listener; only the fixed Rigshelf commands run remotely | One transport for sync and remote control |
| Tailscale SSH | Tailnet identity and ACLs | Tailnet only | Works unchanged when the host alias resolves through Tailscale; nothing Rigshelf-specific to add |
| Rigshelf agent with its own TLS port | New keys and certificates to issue, rotate and revoke | A new public or VPN listener | Rejected: a second authentication system to secure |
| Cloudflare Tunnel or ngrok to the workbench | Cloudflare Access policies / OAuth | Public hostname | Rejected for built-in use; see Remote control |

Hardening in the implementation: host aliases are validated before they reach `ssh` and `--` separates them from options; remote commands come from a fixed set (`machine inventory|doctor|prepare`, `apply <plan-id>`, `ui --port … --attached --public-port …`) with validated roots and UUID plan IDs; `BatchMode`, connect and keep-alive timeouts, `ForwardAgent=no` and `ClearAllForwardings` (except the one loopback forward of `ui --on`) are always set; output is size-limited and every remote answer is schema-validated before use; bundles carry no credentials, and credential-like files are withheld. Writes happen only through plans on the receiving machine, with preconditions, journal and rollback.

## Remote control

Separate from sync, and later:

1. `rigshelf ui --on <alias> [--port L] [--remote-port R]` runs `rigshelf ui --port R --attached --public-port L` on the server and forwards `127.0.0.1:L` to it with `ssh -L`. The printed `http://rigshelf.localhost:L/#access=…` URL carries the server's own access key. The remote workbench accepts only loopback hosts for its two ports and stops when the SSH connection closes (Ctrl-C). Nothing new listens beyond loopback on either machine. The header shows `Remote: <host>` while the workbench is opened this way, on its own line on narrow screens.
2. Tailscale Serve (tailnet only, never Funnel) is documented for users who already run Tailscale.
3. Cloudflare Tunnel or ngrok are not built in. The workbench accepts only loopback hosts; supporting a public hostname would require enforced Cloudflare Access with origin-side JWT validation, which is a larger trust change than this product needs.

## Phases

1. Read-only `machine inventory`, `machine compare <alias>` and `machine doctor <alias>` in the CLI, and a Machines view in the workbench (done).
2. `rigshelf machine sync <alias>` sends each applied kit and prepares plans on the server; `--apply` or `rigshelf machine apply <alias> <plan-id>` applies them (done for kits, Library and directives).
3. `rigshelf ui --on <alias>` with the remote badge (done).
4. Per-project memory re-mapping (done: `--memory`, a separate plan rooted at the server's `~/.claude/projects`, credential-like files withheld, server-only files kept); syncing from the server back to this machine.

## Decisions (2026-11-08)

- **Scope:** making a server match copies each matched project's kit (Skills, MCP, guidance), the Library with directives, and the project's local agent files that Git does not track (`CLAUDE.local.md`, `.claude/rules|agents|commands|hooks|skills`, untracked Skill folders and MCP configuration). Private local settings (`settings.local.json`, `.env*`) and credential-like files are reported, never copied. Global configuration is off by default, keeping servers project-scoped like the laptop, and each part is an explicit opt-in: `--global-guidance` (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`), `--global-settings` (`~/.claude/settings.json`, credential-checked and path re-mapped) and `--global-skills` (each harness's global Skill folders, following linked Skill folders). Each harness folder gets its own plan and must already exist on the server. `~/.claude.json` and `~/.codex/config.toml` are refused: they hold account state and per-path project trust, and granting trust on a server stays the user's decision there.
- **Memory:** off by default. It is enabled per project, then re-mapped to the server's project path; it is never copied byte for byte.
- **Harnesses:** a server receives the same harness formats the project uses on the laptop (Claude Code, Codex, OpenCode, Kiro, Grok and the rest of the supported set), so the plan on the server mirrors the laptop's selection.
