# AI-assisted authoring

Start with what you have: a link, an installation command, rough notes or a description. **Library → Add to library → Start with AI** prepares a source, custom Skill or canonical MCP definition. The preview shows readable fields. **Use draft** fills the editor; **Add to library** remains a separate save. Source research and snapshot import keep their existing explicit actions. Generation does not fetch a supplied URL or execute a supplied command, and never claims that it researched or verified a source.

The same assistance is available in Presets, Directives, Skill/MCP editing, editable project documents and project setup. Use **Create**, **Improve**, **Convert to format** or **Suggest**. A short request can fill several related fields. Current fields can be inspected alongside the proposal; structured JSON stays in an optional detail view. A changed editor makes an older proposal unusable until regenerated. Unsaved AI input participates in the existing draft guards.

Project assistance receives the supplied requirements/stack and up to 80 matching library names, tags and short descriptions. It does not receive Skill bodies, source memory files, conversations or the whole project. Suggested snapshot IDs must belong to that offered context. Using a project proposal updates requirements and refreshes the suggested kit; it does not create a setup plan or Apply it. Suggested additions preserve an already selected revision; they cannot replace it with another snapshot of the same capability. Existing manual choices remain under the setup selection rules.

## Provider modes

| Mode | Behavior and limits |
| --- | --- |
| Claude Code | Explicit generation launches the installed CLI with fixed arguments, safe/restricted modes, an empty tool set, strict empty MCP configuration and disabled session persistence. Requires a CLI version supporting those flags and a working native login. |
| Codex | Explicit generation launches `exec` with user configuration and execpolicy rules ignored, ephemeral execution, a read-only tool sandbox, disabled command/browser/plugin/hook integrations and bounded final output. Requires the documented flags/configuration and a standard native login. Custom providers requiring global configuration should use their connected Agent instead. |
| Ollama | Sends a bounded JSON generation request to the fixed loopback endpoint. Choose an installed model and start the local service. No model is downloaded automatically. |
| Current Agent · MCP | Creates a waiting request. In the connected session, use `kitfold_pending_drafts`, `kitfold_draft_request` and `kitfold_propose_draft`. The proposal appears in the same UI preview. This does not inject a message into an arbitrary running chat or launch another model. |

Generation runners and project Harness adapters are separate capabilities. Kiro, OpenCode, Antigravity and Grok can answer through an explicitly connected Rigshelf MCP session where their MCP integration is available. This release does not invent unattended CLI flags for them. Provider/model preferences are remembered in the browser; credentials stay with the owning CLI or local service. CLI quotas or billing can apply to an explicit generation request. A failed or unavailable Provider leaves editor fields unchanged.

Native invocation references: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference), [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive) and [Codex configuration](https://developers.openai.com/codex/config-reference). Installed CLI help is checked during development; supported arguments can change across versions. Windows native CLI/process acceptance remains a release check.

## Choose an Ollama model

The model control in AI panels and Settings can list installed model names. Opening the editor or choosing Ollama makes no model-service request. Open the model selector or choose **Refresh models** to request metadata from the fixed `http://127.0.0.1:11434/api/tags` endpoint; this neither pulls nor runs a model. Select an exact name, or use **Enter model name** for manual configuration. Empty/offline services show a recovery action and retain the chosen name. Only explicit **Generate** invokes generation.

The list is bounded to 1 MiB, 1,000 models and a 2.5-second request deadline. Requests are cancelable, do not follow redirects and send no prompt, catalog data or credentials. Metadata is not stored in the catalog or exported. `remote_host`/`remote_model` reports produce a visible remote-routing label without exposing the host; absence of those fields is not a guarantee of local computation. Model routing remains controlled by the Ollama service. Sources: [model-list API](https://docs.ollama.com/api/tags), [official response schema](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml).

Generation and the older document-review endpoint also refuse HTTP redirects. They send an explicit prompt to the fixed loopback service only; they do not follow a redirected URL with that prompt. This does not constrain the chosen model service's own remote routing.

The shared TypeScript operation is `getOllamaModels({ signal? }): Promise<OllamaModel[]>`. For example, a read-only caller can await the list; a panel owns an `AbortController` and aborts on closure. An unavailable service rejects with a fixed recovery message rather than converting failure into an empty successful list. `GET /api/ai/ollama-models` uses the same operation behind the existing private HTTP boundary; POST is refused.

## Data and authority

One request accepts up to 20,000 characters of notes and 50,000 characters of current fields. Matching uses a bounded set of terms and at most 80 catalog items. Nested JSON strings are decoded for credential masking while ordinary JSON formatting is preserved. Source formatting retains a supplied focused URL/command rather than replacing it with a guessed repository; an unoffered reference is rejected.

Requests use strict bounded schemas, known credential masking and a minimal per-runner environment. Prompts explicitly frame supplied text and recipes as data. These are controls, not proof that generated instructions are correct or safe. Typed output is validated before it can enter an editor. Unknown fields, a wrong output type, unknown snapshot IDs and credential-looking output are rejected. Content findings remain visible.

The private SQLite catalog retains at most 24 recent one-shot draft records for up to 24 hours. These are explicit authoring requests and proposals, not captured conversations or restored model context. Expired records are removed on subsequent authoring. Connected-Agent requests stop accepting answers after 15 minutes or cancellation. CLI/local generation has a two-minute deadline and at most two concurrent runs. Closing the workbench aborts and drains its owned runs; leaving an authoring panel cancels its unfinished request. Old interrupted run records become retryable failures rather than blocking the workbench indefinitely.

CLI work directories live under private app data, are removed after the run and are separate from inspected repositories. Rigshelf does not read account credential stores. The native CLI still owns its normal authentication and operational state. API status responses omit prompt/input/context bodies; MCP exposes a waiting prompt only by its request ID. Portable library exports omit transient AI jobs and restore no AI execution permission. The session proposal tools can only answer a pre-existing waiting request; they cannot start a model, save authored library content, enable automation or Apply project files, including on a default read/plan MCP connection.

AI adoption remains **proposal → Use draft → save/review → Apply where applicable**. Existing immutable Snapshot lineage, supporting resources, source checks, plan preconditions, journals and rollback stay authoritative.
