# Product

Rigshelf is a local workbench for setting up coding agents per project. Choose a project, review a small kit, choose the agents you use, inspect the file changes, apply.

## Promise

- The Library can be large; a project's kit stays small. Keeping something in the Library never loads it into every agent session.
- No hosted registry, accounts, telemetry or required cloud service. Application code and your private data live in separate places.
- Existing projects and agent configuration survive setup and updates. Every write goes through a reviewed plan that can be rolled back.

## Concepts

- **Source:** where Skills, MCP definitions or Plugins come from (a repository, a listing, a local folder).
- **Skill, MCP, Plugin:** capabilities, stored as immutable Snapshots with their supporting files.
- **Preset:** a reusable starting kit for a stack, with inheritance (for example Essentials → Mobile → Expo).
- **Directive:** reusable guidance that becomes part of a project's agent instructions.
- **Kit:** the small selection activated for one project.
- **Harness:** an agent such as Claude Code, Codex, Kiro, OpenCode, Antigravity or Grok. A model Provider such as Ollama is separate from the Harness that uses it.

## Interaction

The main navigation is Prepare, Projects and Library; Presets and Directives sit under Defaults. Setting up a project is the primary action. A workspace holds the daily choices; a separate dialog reviews the file plan before anything is written. Trust labels describe evidence, not quality. Backup is available but never leads the experience.

## Architecture boundaries

- One domain engine serves the CLI, the web API and MCP.
- The private catalog lives in the OS data directory, outside every agent's discovery folders.
- Canonical records are independent of provider paths; adapters own output formats and report what they cannot express.
- Skills are installed as files for the agent's own progressive discovery, not appended to directives.
- Detection and recommendations are deterministic. AI helps prepare drafts through a runner you choose; it never saves or applies on its own.
- Install recipes are data. Importing an item never runs its recipe.
- Backup and machine sync are user-controlled. Hosted collaboration and a public marketplace are out of scope.

## Limits

Provider formats and upstream install commands change, so only documented mappings ship as supported. Agents may need a new session before they pick up newly written files.
