# First project walkthrough

Start with `bun run dev` from this checkout, or `rigshelf ui` when the CLI is linked. Open the private access URL printed by that process. If the default port is occupied, the terminal prints another available local port. An explicit `--port` stays fixed and reports a useful error rather than stopping a listener. Access keys survive ordinary restarts; stop all workbenches before using `ui --reset-access` to rotate future access. Keep the access URL private.

The first setup screen starts with a folder choice. **Try with a safe example** beside it offers practice; **Getting started** in the top bar opens the workflow guide and example. The example is an explicit simulation: choosing agents, reviewing file paths, Apply and rollback make no API requests and change no real project, catalog or approval.

## Import your existing tools

Library opens **By source**: expand a collection to browse its saved Skills and other items. Search and filters include closed groups and every child page. A filtered header shows matching items against the collection total. **All items** restores a flat list; the browser remembers that choice. Custom Skills keep their own source group. The project picker uses the same hierarchy and shows selected counts; expanding a group never selects or activates its contents.

For new content, use **Library → Add to library → Start with AI**. Paste a link, command or rough notes, choose Provider/model and generate. Review the prepared fields, choose **Use draft**, then save. You can also create/improve/format Presets, directives, editable documents and Skill/MCP content with the same panel. **Describe the project to AI** prepares project requirements and library suggestions. [AI assistance](AI-ASSISTANCE.md) explains native CLI login and connected-Agent modes.

1. In **Settings → Where to look**, review project roots and global discovery. Save changed preferences.
2. In **Library**, use **Scan this machine**. Physical AI locations are inspected even when gitignored or untracked. Supported Skills and sanitized MCP definitions enter your private library. This does not activate them in an agent or edit originals.
3. Review partial/unavailable-location diagnostics. In **Projects**, use AI file types to separate instructions, memory, rules, Agents, Commands, Config, Plugins and Hooks. Global files have their own group. Skill snapshots and installation relationships are browsed in Library.

**Find tools on this machine** inside project setup retains your current source/kit view. Read the scan status, then use **Back to kit Library** when ready. A late scan response does not close a different inspector. Ctrl-C reports shutdown and waits for active inventory/file operations before closing the private catalog.

## Set up a project

1. Choose **Set up a project** and select a folder using known projects, Browse or a typed path. The folder must already exist; an empty new-project folder is supported. Rigshelf does not scaffold application code.
2. A known-project choice or **Browse** inspects the folder automatically, without writing project files. For a manually typed path, use **Build my kit**. The suggested kit appears after inspection.
3. Review the selected Skills and MCP servers. **Add from library** opens search with separate type, platform and technology filters; **More suggestions** holds unselected recommendations. If the Library is empty, **Find more tools** opens source/AI/local intake in the same project. Source discovery is an explicit network action; importing keeps supporting files and never runs recipes. The Agent row changes the Harnesses running your sessions. For T3, the model name is separate from its underlying harness. The brief and **Starting preset** are optional; after changes, use **Update kit**. Deliberate removals, manual snapshot pins and Agent choices survive that refresh.
4. Use **Review setup**. Read file changes, content findings and compatibility notes. Planning does not write project files. Resolve conflicts and review requested replacements.
5. Use **Apply** after reviewing that plan. The handoff shows project discovery locations, a copyable starting prompt and history/recovery access. Open or reload the relevant agent session and verify discovery. Vendor trust prompts and reload behavior remain under that harness's control.

You can visit Library, Settings or another page and return to the same setup draft. Edits are bounded in current-tab `sessionStorage`: after reload, choose **Continue kit** or **Discard draft**. Continuing performs fresh inspection and restores no plan, review acknowledgment, replacement choice or permission. Closing the tab can discard this optional recovery. Browser unsaved-change protection remains enabled when applicable. Replacing an edited project requires a discard decision. Changed shared directives or presets require renewed inspection. If selected content has been removed from Library, review pauses with a visible explanation.

Library shows the kit you are choosing tools for. Open a Skill or MCP Snapshot and use **Add to project kit** to return with that exact revision; unsaved editor changes still require a discard decision. Already selected versions are marked. Plugins and references retain their own inspection flow and are not presented as portable Skill activation. **Return to project kit** preserves your brief and choices.

An explicitly chosen Preset supplies its default Agents on a fresh kit. Deliberate Agent choices, recovered drafts and previously reviewed project choices take precedence. If they differ, **Use Preset Agents** lets you switch explicitly. **Defaults → Presets** supports creating, editing and duplicating starting points; duplicate includes your current edited selectors, stack tags and pins. Same-name new definitions preserve older records. Explicit pins have search and **Show more**, including selections hidden by the current filter.

If another window changes or removes an open Preset/Directive, saving or removing from the older web editor stops. Your current fields remain open and **Copy draft** preserves them before you reopen the saved definition. Preset **Duplicate** can also save your draft as a separate starting point. This does not automatically merge two authors' instructions.

If clipboard access is unavailable, a read-only copy dialog provides **Select text** and manual keyboard copying. It retains the exact requested draft and returns to the original editor without saving anything.

## Revisit a project

Open **Projects** and inspect a folder. **Prepare this project** returns to its kit; project name/stack editing is optional under its own disclosure. **Check for tools** compares the current dependencies with Library and records suggestions only. It does not start automation, write files or add approvals. **Activity** collects those pending suggestions with a route back to the project kit. Its local search finds project/Agent/event history, and **Show older plans** exposes plans beyond the first page.

## Continue and recover

**Activity** retains setup plans and rollback actions. Later edits are protected by preconditions; rollback cannot force-overwrite them. Dependency automation is optional and requires current project approval and exact snapshot approval.

**Settings → Inventory history** lists private checkpoints made before scans. Downloads retain the prior project/file index and installation relationships. They do not contain original memory bodies, complete source-file backups, credentials or setup permissions. Immutable imported Skill snapshots and reviewed setup preimages stay separately in the private catalog. Scanning never deletes source files or global installations.

**Settings → Review backup** previews changes against a previous export and downloads a portable library archive with an exclusion report. For a complete workbench backup, keep the SQLite catalog and its current WAL state consistent using SQLite's backup mechanism or a stopped workbench. Inventory receipts and library archives serve different purposes; neither implicitly restores project files or automation authority.
