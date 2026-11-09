# Directory selection

Folder fields accept typed paths and offer a **Browse…** button. This applies to the setup project directory, local Skill import directory, Settings project roots, and the allowed project root in the MCP connection editor. Relative paths for newly authored supporting files remain text fields: they name files within a snapshot, not host directories. Archive import already uses the browser's file picker.

A selection fills the current draft. In project setup, a committed known-project or Browse choice also starts read-only project inspection and recommendations. It never runs the full library scan, imports a source, saves preferences, grants project approval, enables automation, or applies a setup plan. Those actions retain their separate controls. Canceling preserves the previous value. Unsupported desktop environments show a useful error and keep manual input available. Adding a root already present as the same path does not duplicate its line.

## Native desktop boundary

The authenticated local HTTP endpoint `POST /api/pick-directory` opens a chooser on the machine running Rigshelf. It requires the existing private access key, Host/Origin checks and a JSON body. It is intentionally not a catalog MCP tool: opening desktop UI is a local interface capability, not library or project authority. Browser directory-upload controls cannot supply the host's absolute project path and are not used as a substitute.

The request accepts only an optional starting path. The chooser starts from its nearest existing directory and returns one existing absolute directory or `null`. It does not enumerate directory contents. Paths are bounded and reject NUL/newline characters. Fixed native programs receive the path through an argument or environment value, never through interpolated script source or a shell command. The child receives a small environment allowlist; process output is bounded to 16 KiB, and selection has a three-minute limit. Raw process diagnostics are not returned to the browser or stored in events.

One chooser may be active per server. Duplicate requests are refused. Leaving the field's page aborts the browser request and its owned native process, including when Setup retains its draft offscreen; server shutdown aborts and drains pending selection. The normal HTTP idle timeout is disabled for this bounded interactive request. Choosing a directory does not establish that it is an approved project or that its contents are safe. The chooser endpoint itself still only returns a path: read-only inspection is a separate authenticated browser request.

## Platform adapters and validation

| Platform | Adapter | Validation boundary |
| --- | --- | --- |
| macOS | `/usr/bin/osascript` with a fixed `choose folder` script | Native invocation/cancellation exercised locally; automated browser flows inject a chooser driver. Selecting through the real OS window remains manual QA because the available native automation cannot target the osascript window. |
| Windows | PowerShell with the system WinForms `FolderBrowserDialog` | Command construction is tested; the Windows desktop interaction has not been manually certified. |
| Linux desktop | Installed `zenity`, falling back to installed `kdialog` | Command construction and unavailable-tool behavior are tested; the desktop interaction has not been manually certified. No packages are installed automatically. |

The adapters follow the platform documentation: [AppleScript commands](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_cmds.html), [WinForms FolderBrowserDialog](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.folderbrowserdialog), [KDialog directory selection](https://develop.kde.org/docs/administration/kdialog/) and the [GNOME Zenity source](https://github.com/GNOME/zenity).

Tests cover literal shell-sensitive/Unicode paths, nearest existing ancestors, preserved spaces, cancellation, invalid and non-directory results, duplicate requests, abort/drain behavior, HTTP authorization and unchanged project authority. The browser flow covers all four fields, selection versus explicit import/save, cancellation/error fallback, pending-request cancellation, and responsive/accessibility checks. Evidence stays in ignored `.local/qa/directory-picker`.

Verification passed: `bun run verify` (100 tests across 16 files and 719 matching English/Turkish messages), `bun run lint`, and all seven `bun run test:ui` suites. These are normal development checks, not a separately qualified security audit or certification of every native desktop adapter.
