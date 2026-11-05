# First project walkthrough

Start with `bun run dev` from this checkout, or `kitfold ui` when the CLI is linked. Open the private access URL printed by that process. If the default port is already occupied, use the running workbench's current URL or stop that process before restarting. Keep the access URL private.

The first setup screen starts with a folder choice. **Try an example** below it offers practice; **Getting started** in the top bar opens the workflow guide and example. The example is an explicit simulation: choosing agents, reviewing file paths, Apply and rollback make no API requests and change no real project, catalog or approval.

## Import your existing tools

For new content, use **Library → Add to library → Start with AI**. Paste a link, command or rough notes, choose Provider/model and generate. Review the prepared fields, choose **Use draft**, then save. You can also create/improve/format Presets, directives, editable documents and Skill/MCP content with the same panel. **Describe the project to AI** prepares project requirements and library suggestions. [AI assistance](AI-ASSISTANCE.md) explains native CLI login and connected-Agent modes.

1. In **Settings → Where to look**, review project roots and global discovery. Save changed preferences.
2. In **Library**, use **Scan this machine**. Physical AI locations are inspected even when gitignored or untracked. Supported Skills and sanitized MCP definitions enter your private library. This does not activate them in an agent or edit originals.
3. Review partial/unavailable-location diagnostics. In **Projects**, use AI file types to separate instructions, memory, rules, Agents, Commands, Config, Plugins and Hooks. Global files have their own group. Skill snapshots and installation relationships are browsed in Library.

## Set up a project

1. Choose **Set up a project** and select a folder using known projects, Browse or a typed path. The folder must already exist; an empty new-project folder is supported. Kitfold does not scaffold application code.
2. A known-project choice or **Browse** inspects the folder automatically, without writing project files. For a manually typed path, use **Build my kit**. The suggested kit appears after inspection.
3. Review the selected Skills and MCP servers. **Add from library** opens search with separate type, platform and technology filters; **More suggestions** holds unselected recommendations. Open **Agents** to change the harnesses running your sessions. For T3, the model name is separate from its underlying harness. **Requirements & preset** is optional; after changes, use **Update kit**. Deliberate removals, manual snapshot pins and Agent choices survive that refresh.
4. Use **Review setup**. Read file changes, content findings and compatibility notes. Planning does not write project files. Resolve conflicts and review requested replacements.
5. Use **Apply** after reviewing that plan. Open or reload the relevant agent session and verify discovery. Vendor trust prompts and reload behavior remain under that harness's control.

You can visit Library, Settings or another page and return to the same setup draft. The draft stays in the current tab's memory, not browser storage; reloading or closing the tab can discard it and triggers the browser's unsaved-change protection when applicable. Replacing an edited project requires a discard decision. Changed shared directives or presets require renewed inspection. If selected content has been removed from Library, review pauses with a visible explanation.

## Continue and recover

**Activity** retains setup plans and rollback actions. Later edits are protected by preconditions; rollback cannot force-overwrite them. Dependency automation is optional and requires current project approval and exact snapshot approval.

**Settings → Inventory history** lists private checkpoints made before scans. Downloads retain the prior project/file index and installation relationships. They do not contain original memory bodies, complete source-file backups, credentials or setup permissions. Immutable imported Skill snapshots and reviewed setup preimages stay separately in the private catalog. Scanning never deletes source files or global installations.

**Export library** creates a portable library archive with an exclusion report. For a complete workbench backup, keep the SQLite catalog and its current WAL state consistent using SQLite's backup mechanism or a stopped workbench. Inventory receipts and library archives serve different purposes; neither implicitly restores project files or automation authority.
