# First project walkthrough

Start with `bun run dev` from this checkout, or `kitfold ui` when the CLI is linked. Open the private access URL printed by that process. If the default port is already occupied, use the running workbench's current URL or stop that process before restarting. Keep the access URL private.

The first setup screen offers **Take a tour** and **Try an example**. **Getting started** in the top bar reopens them. The example is an explicit simulation: choosing agents, reviewing file paths, Apply and rollback make no API requests and change no real project, catalog or approval.

## Import your existing tools

1. In **Settings → Where to look**, review project roots and global discovery. Save changed preferences.
2. In **Library**, use **Scan this machine**. Physical AI locations are inspected even when gitignored or untracked. Supported Skills and sanitized MCP definitions enter your private library. This does not activate them in an agent or edit originals.
3. Review partial/unavailable-location diagnostics. In **Projects**, use AI file types to separate instructions, memory, rules, Agents, Commands, Config, Plugins and Hooks. Global files have their own group. Skill snapshots and installation relationships are browsed in Library.

## Set up a project

1. Choose **Set up a project** and select a folder using known projects, Browse or a typed path. The folder must already exist; an empty new-project folder is supported. Kitfold does not scaffold application code.
2. Use **Build my kit**. Choosing and inspecting a folder are separate steps. Before inspection, the screen acknowledges the selected project and explains this next action. Changed path, requirements or preset invalidates earlier recommendations.
3. Review the detected stack, preset and recommendations. Choose the actual harnesses running your sessions. For T3, the model name is separate from its underlying harness. Add or remove Skills and MCP servers from the small proposed kit.
4. Use **Review setup**. Read file changes, content findings and compatibility notes. Planning does not write project files. Resolve conflicts and review requested replacements.
5. Use **Apply** after reviewing that plan. Open or reload the relevant agent session and verify discovery. Vendor trust prompts and reload behavior remain under that harness's control.

## Continue and recover

**Activity** retains setup plans and rollback actions. Later edits are protected by preconditions; rollback cannot force-overwrite them. Dependency automation is optional and requires current project approval and exact snapshot approval.

**Settings → Inventory history** lists private checkpoints made before scans. Downloads retain the prior project/file index and installation relationships. They do not contain original memory bodies, complete source-file backups, credentials or setup permissions. Immutable imported Skill snapshots and reviewed setup preimages stay separately in the private catalog. Scanning never deletes source files or global installations.

**Export library** creates a portable library archive with an exclusion report. For a complete workbench backup, keep the SQLite catalog and its current WAL state consistent using SQLite's backup mechanism or a stopped workbench. Inventory receipts and library archives serve different purposes; neither implicitly restores project files or automation authority.
