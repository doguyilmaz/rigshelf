# Remote machines

Work on a server over SSH with the same agent setup you have here: Skills, guidance, settings, memory and the gitignored agent files a `git clone` never brings.

```sh
rigshelf machine compare my-server     # what differs, grouped and per item
rigshelf machine doctor my-server      # versions, installed agents, missing environment, disk, clock
rigshelf machine sync my-server        # prepare plans on the server; add --apply to apply them
rigshelf ui my-server                  # open the server's workbench here through an SSH tunnel
```

`my-server` is a `Host` alias from your `~/.ssh/config`. Rigshelf must be installed on the server; the same version on both machines is recommended. Settings → Machines offers the same check, prepare and apply in the workbench.

## Matching projects

Projects match by their Git `origin` URL, so a clone under a different folder name still matches. Sync sends only projects the server has a clone of; files of other projects never leave this machine. Projects without an origin are compared by folder name but never synced. When you have several checkouts of one repository, the first is sent and the others are reported. Kits applied in a monorepo subfolder are not matched.

## What sync sends

By default:

- **Per matched project:** its Rigshelf kit and the Library entries it uses, directives, agent files Git does not track (`CLAUDE.local.md`, `.claude/rules`, `agents`, `commands`, `hooks`, `skills`, untracked Skill folders and MCP configuration) and its Claude memory.
- **Global:** guidance (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) with the files it imports through `@file`, `~/.claude/settings.json`, Claude's `rules`, `agents` and `commands` folders, and Skills. Skills go to `~/.agents/skills` and to the folders of the agents installed on the server.

Leave parts out with `--skip-local-files`, `--skip-memory` or `--skip-global`.

Never sent: private local settings (`settings.local.json`, `.env*`), credential-like content, `~/.claude.json` (account and project trust) and `~/.codex/config.toml` (Codex project trust). Hooks and the status line in `settings.json` run commands, so they stay on each machine unless you add `--with-hooks`. Without it, the server keeps its own.

Absolute paths in copied text are re-mapped to the server's home and project folders. Memory folders are re-keyed to the server's project path.

## How changes are applied

`machine sync` never writes files directly. The server prepares one plan per project and one per global folder, and `--apply` (or `rigshelf machine apply my-server <plan-id>`) applies them with the usual preconditions, journal and rollback. Each plan can be rolled back on the server with `rigshelf rollback <plan-id>`.

- A server folder that links into its home (for example a dotfiles checkout) is written through; a link that leaves the home folder is refused.
- A single linked file is skipped and named; the rest of the plan still applies.
- An empty `~/.agents` is created when missing; every file inside it is written by a plan.

## Reading the comparison

Global Skills appear once per name across the folders sync fills. Agents that are not installed on the server are named once and left out. Each item has one status and a suggested action:

| Status | Action |
| --- | --- |
| In sync | Nothing to do. |
| Missing there / missing here | Sync copies it. |
| Different | Review the change. |
| Contains machine paths | Copied with paths re-mapped. |
| Private | Set up by hand on the server. |

Settings are compared without hooks and the status line.

## Doctor

`machine doctor my-server` reports the Rigshelf version on both sides and the agents installed on the server. For each project with a kit it also reports:

- the environment variable names its MCP servers need that are not set in the server's login shell;
- whether Codex trusts the project, when the kit uses Codex.

It also flags less than 1 GiB free and clocks more than five minutes apart. Only names are reported, never values.

## Opening the server's workbench

`rigshelf ui my-server [--port L] [--remote-port R]` starts the workbench on the server and forwards `127.0.0.1:L` to it with `ssh -L`. The printed `http://rigshelf.localhost:L/#access=…` link carries the server's own access key. Nothing listens beyond loopback on either machine, and Ctrl-C closes the tunnel and stops the remote workbench. Forwards from your `~/.ssh/config` that fail (for example a port another session holds) are ignored; only a failure on the tunnel's own port stops it. The header shows `Remote: <host>` while you work this way.

## Transport security

Rigshelf uses the system `ssh` with your config, keys, agent and host key checks. It stores no keys and opens no port. Host aliases are validated before they reach `ssh`, only a fixed set of Rigshelf commands runs on the server, agent forwarding is off, every answer is size-limited and schema-checked, and text from the server is stripped of control characters before it reaches your terminal.

If you already use [Tailscale](https://tailscale.com), an alias that resolves through it works unchanged. Public tunnels such as Cloudflare Tunnel or ngrok are not supported: the workbench can write agent configuration, so it stays on loopback.
