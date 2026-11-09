# Remote machines (proposal)

Status: available in the CLI: read-only inventory, compare and doctor; `machine sync`/`machine apply` for project kits, the Library they use and directives; and `rigshelf ui --on` with a remote badge. Memory, global guidance, Claude settings and global Skills are included by default, each as its own plan. Settings → Machines offers the same check, prepare and confirmed apply in the workbench.

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
- Same setup on both machines. Matched projects, memory, global guidance, settings and Skills sync by default; anything that runs commands (hooks, status line) or holds account state stays behind unless the user sends it.
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

Projects match by repository key: the normalized `origin` URL read from `.git/config` (no `git` process). Projects without an origin on either side are compared by folder name but never synced; a folder name or absolute path never decides a sync. Sync reads the server inventory first and sends only projects the server has a clone of; files from other projects never leave the machine. When one machine has several checkouts of a repository, only the first is sent and the others are reported. Not yet supported: kits applied in a subfolder of a repository (monorepo workspaces) and manual pairing of unmatched projects.

## What is compared

Three layers, each grouped by harness and kind, with drill-down to single items:

- **Library**: Skills, MCP definitions, Presets and directives by Snapshot digest. Moving the Library uses the existing export bundle or backup destination.
- **Global**: Skills (one row per Skill name across `~/.agents/skills` and the folders of agents installed on the server; folders of agents that are not installed there are named once and left out), guidance, MCP configuration and settings. `~/.claude/skills/synced` belongs to Claude Code's claude.ai sync and is skipped.
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

Rigshelf version on both sides; agent CLIs installed on the server (they decide which global Skill folders sync fills); for each project with a kit, the environment variable names its MCP servers need that are not set in the server's login shell, and whether Codex trusts the project when the kit uses Codex (reported, never granted remotely); less than 1 GiB free in the server's home; clocks more than five minutes apart. Values are never read or shown, only names. `machine doctor <alias>` lists these findings, and Settings → Machines shows them above the comparison.

## Transport security

| Option | Authentication | Exposure | Decision |
| --- | --- | --- | --- |
| System `ssh` (chosen) | The user's keys, agent, `~/.ssh/config` and host key verification | No new listener; only the fixed Rigshelf commands run remotely | One transport for sync and remote control |
| Tailscale SSH | Tailnet identity and ACLs | Tailnet only | Works unchanged when the host alias resolves through Tailscale; nothing Rigshelf-specific to add |
| Rigshelf agent with its own TLS port | New keys and certificates to issue, rotate and revoke | A new public or VPN listener | Rejected: a second authentication system to secure |
| Cloudflare Tunnel or ngrok to the workbench | Cloudflare Access policies / OAuth | Public hostname | Rejected for built-in use; see Remote control |

Hardening in the implementation: host aliases are validated before they reach `ssh` and `--` separates them from options; remote commands come from a fixed set (`machine inventory|doctor|prepare`, `apply <plan-id>`, `ui --port … --attached --public-port …`) with validated roots and UUID plan IDs; `BatchMode`, connect and keep-alive timeouts and `ForwardAgent=no` are always set, and `ClearAllForwardings` is set for every command except `ui --on` (it would also clear that command's own loopback forward, so forwards from your `~/.ssh/config` stay active there); output is size-limited and every remote answer is schema-validated before use; bundles carry no credentials: credential-like files (keys, tokens, database URLs with passwords, secret-named values, secret CLI flags) are withheld, and files that approve MCP servers or hold Codex trust are refused by both machines. Text from the server is stripped of control characters before it reaches the terminal. Writes happen only through plans on the receiving machine, with preconditions, journal and rollback.

## Remote control

Separate from sync, and later:

1. `rigshelf ui --on <alias> [--port L] [--remote-port R]` runs `rigshelf ui --port R --attached --public-port L` on the server and forwards `127.0.0.1:L` to it with `ssh -L`. The printed `http://rigshelf.localhost:L/#access=…` URL carries the server's own access key. The remote workbench accepts only loopback hosts for its two ports and stops when the SSH connection closes (Ctrl-C). Nothing new listens beyond loopback on either machine. The header shows `Remote: <host>` while the workbench is opened this way, on its own line on narrow screens.
2. Tailscale Serve (tailnet only, never Funnel) is documented for users who already run Tailscale.
3. Cloudflare Tunnel or ngrok are not built in. The workbench accepts only loopback hosts; supporting a public hostname would require enforced Cloudflare Access with origin-side JWT validation, which is a larger trust change than this product needs.

## Phases

1. Read-only `machine inventory`, `machine compare <alias>` and `machine doctor <alias>` in the CLI, and a Machines view in the workbench (done).
2. `rigshelf machine sync <alias>` sends each applied kit and prepares plans on the server; `--apply` or `rigshelf machine apply <alias> <plan-id>` applies them (done for kits, Library and directives).
3. `rigshelf ui --on <alias>` with the remote badge (done).
4. Per-project memory re-mapping (done: a separate plan rooted at the server's `~/.claude/projects`, credential-like files withheld, server-only files kept); syncing from the server back to this machine.

## Decisions (2026-11-08)

- **Scope:** making a server match copies each matched project's kit (Skills, MCP, guidance), the Library with directives, and the project's local agent files that Git does not track (`CLAUDE.local.md`, `.claude/rules|agents|commands|hooks|skills`, untracked Skill folders and MCP configuration). Private local settings (`settings.local.json`, `.env*`) and credential-like files are reported, never copied. Global guidance (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) is included by default because it carries the user's working style everywhere at no Skill context cost; `--skip-global-guidance` leaves it out. The rest of the global configuration stays opt-in, keeping servers project-scoped like the laptop: `--global-settings` (`~/.claude/settings.json`, credential-checked and path re-mapped) and `--global-skills` (each harness's global Skill folders, following linked Skill folders). Each harness folder gets its own plan and must already exist on the server. `--all` (or "Everything" in the Machines view) turns on every opt-in at once, including memory for each synced project. `~/.claude.json` and `~/.codex/config.toml` are refused even then: they hold account state and per-path project trust, and granting trust on a server stays the user's decision there.
- **Memory:** off by default. It is enabled per project, then re-mapped to the server's project path; it is never copied byte for byte.
- **Global guidance (2026-11-09):** included by default; settings, global Skills and memory stay opt-in.
- **Skills for every project (2026-11-09):** the Library's "Add to every project" pins a Snapshot in the base Preset, so each project kit carries its own pinned copy and machine sync moves it with the kit; copying global Skill folders stays opt-in. Scope signed off by the user on 2026-11-09.
- **Everything by default (2026-11-09, replaces the opt-in scope above):** `machine sync` sends local files, memory, global guidance, `~/.claude/settings.json` and global Skills. Flags only leave things out: `--skip-local-files`, `--skip-memory`, `--skip-global`. Global Skills go to `~/.agents/skills` (created when missing) and to the folders of agents that `machine doctor` finds installed on the server; each Skill is copied once per folder, so the server matches what each agent sees here. Settings travel without `hooks` and `statusLine` because they run commands; the server keeps its own unless `--with-hooks` sends them. A server folder linked to a folder inside its home (dotfiles) is written through; a link outside home is refused. A single linked file is skipped and named; the rest of that folder's plan still applies. Global guidance carries the Markdown files it imports with `@file` (such as `~/.claude/RTK.md`), and Claude's `~/.claude/rules`, `agents` and `commands` folders travel with it; `~/.claude/hooks` travels only with `--with-hooks`. Guidance and settings of agents that are not installed on the server are left out and named once. Prepare creates an empty `~/.agents` when it is missing; every file inside it is still written by a reviewed plan. Skill docs (`.md`, `.mdx`, `.txt`, `.rst`) are checked only for recognizable credential formats, because their `token: process.env.X` examples are not credentials; scripts and configuration files get the full check. Hidden Skill folders (`.system`, `.trash`) and language caches are skipped. In the comparison, settings are compared without hooks and the status line, and files sync never copies (account and trust files) are marked to set up by hand. Monorepo subfolder kits stay unsupported until needed.
- **Harnesses:** a server receives the same harness formats the project uses on the laptop (Claude Code, Codex, OpenCode, Kiro, Grok and the rest of the supported set), so the plan on the server mirrors the laptop's selection.
