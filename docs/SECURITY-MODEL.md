# Security model

Rigshelf is a local application for one OS user. This page describes what it protects and what it does not. To report a vulnerability, see the [security policy](../SECURITY.md).

## Boundaries

- **Local access.** The workbench listens on loopback only, checks the Host and Origin headers, and requires a private access capability in the URL. Nothing is exposed to the network; remote machines are reached through your own SSH.
- **Imported content is data.** Install recipes, Skill scripts and Plugin hooks are never executed to inspect or import them. Repository manifests do not grant ownership, trust or automation.
- **Reviewed writes.** Project files change only through a plan: preconditions checked before and during the write, an exclusive project lock, a journal for recovery, and rollback to the exact previous bytes.
- **Automation.** Automatic additions need the project's approval and the exact clean Snapshot's approval. Revoking either stops pending work.
- **Credentials.** MCP definitions use environment placeholders. Credential-like values in environment variables, arguments, headers and known URL query keys are masked before export, planning, AI prompts and machine sync. Account and trust files (`~/.claude.json`, `~/.codex/config.toml`) are never copied.
- **AI drafts.** Prompts receive masked, bounded input. Drafts never save or apply anything; adopting a draft is a separate step.

## Limits

- Credential detection is heuristic. Unknown formats can be missed; a clean scan, a reachable source or a matching digest does not prove content is safe.
- Rigshelf does not isolate you from other processes running as the same user, including filesystem races.
- Agent CLIs, model providers and remote storage behave according to their own policies; Rigshelf does not certify them.
- Some agents encode memory paths in ways that can alias distinct folders. Memory is read-only in the workbench, and promoting it to a reusable directive requires review.
