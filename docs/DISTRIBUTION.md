# Running and packaging Rigshelf

Rigshelf is a local application: one engine provides a browser interface, CLI and stdio MCP server. The browser connects to the server on your own machine. There is no hosted Rigshelf account, public library service or required cloud deployment. Local and remote AI connections are configured independently in Settings.

## Choose a delivery

| Delivery | Requires | Use |
| --- | --- | --- |
| Source checkout | Bun 1.4.4+, installed development dependencies | Development and contributing. |
| Portable archive | Bun 1.4.4+ | Run the bundled application without a source checkout or `node_modules`. |
| Standalone archive | Matching operating system and CPU | Run the compiled executable; Bun and the web assets are included. |
| Container | Docker and explicit project/data mounts | CLI and stdio MCP. Use a host executable for the browser workbench. |

These are local build recipes. No public package name, signed release, registry image or download URL is claimed. A successful cross-build does not establish that a platform was tested. See [validation](VALIDATION.md) for observed results and remaining acceptance work.

## Source checkout

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open the private URL printed by the command. The default loopback port is `47471`; an occupied default advances to the next available port within the documented range. An explicit `--port` stays fixed. Ctrl-C drains owned operations and stops the server. There is no public bind option.

## Build local artifacts

```sh
# Choose one; the native command also prepares the portable archive.
bun run package
bun run package:native
```

The first command creates a portable archive. The second also creates a standalone archive for the build machine. Outputs are under ignored `.local/releases`, each with a `.sha256` sidecar. Existing artifacts are preserved unless `--replace` is explicitly supplied:

```sh
bun run package:native --replace
```

After building the interface, an explicit target can be selected directly:

```sh
bun scripts/package.ts --native --target bun-linux-x64
```

Bun may download its compiler runtime for another target. An already available matching executable can instead be supplied through `--executable-path /path/to/bun`. Build prerequisites do not belong in the resulting archive. No Rigshelf publisher signing or notarization is performed; public release remains a separate owner action. Experimental AOT compilation is not enabled.

The packager copies only named public documents, the integration Skill, production assets and generated launchers. It excludes design prototypes, source trees, dependencies, `.local`, catalogs, credentials and imported user content. It refuses linked/nonregular inputs and bounds input size. `manifest.json` records each payload file's size, mode and SHA-256. Checksums detect byte changes; they do not establish publisher identity or content safety.

Dependency metadata and license notices must also be regular files with one hard link, reached through real directories. For a dedicated release checkout, install with `bun install --frozen-lockfile --backend=copyfile` before packaging. This avoids a package-cache hard link being mistaken for an independently owned input. Do not rebuild dependencies in an active project just to prepare a release.

## Run an extracted archive

On macOS, verify and extract the portable archive like this (use `sha256sum -c` on Linux):

```sh
shasum -a 256 -c rigshelf-0.1.0-portable.tar.gz.sha256
mkdir rigshelf
tar -xzf rigshelf-0.1.0-portable.tar.gz -C rigshelf
./rigshelf/bin/rigshelf ui
```

Extract into an empty application directory and keep the entire portable directory together. From any working directory:

```sh
/path/to/rigshelf/bin/rigshelf --version
/path/to/rigshelf/bin/rigshelf ui
```

For a standalone archive:

```sh
/path/to/rigshelf/rigshelf --version
/path/to/rigshelf/rigshelf ui
```

Use that same executable with `mcp` for an Agent connection. Add the extracted `bin` directory (portable) or executable directory (standalone) to your own PATH when you want short commands. Keep its `kitfold` compatibility launcher alongside it: generated MCP forwarding bridges still use that command. On Windows the standalone executable is `rigshelf.exe`; native Harness acceptance and the compatibility launcher need Windows qualification before a Windows release.

Fresh data goes to `~/.local/share/rigshelf`; existing Kitfold data stays in place. Installing or replacing an application directory does not move the catalog. `RIGSHELF_DATA_DIR` selects another private data directory. Preserve a [reviewed library backup](BACKUP-SYNC.md) before changing machines; portable exports exclude machine-specific project authority and recovery state.

Standalone compilation disables automatic `.env`, `bunfig.toml`, `tsconfig.json` and `package.json` loading. Supply selected credential references through the process environment. The portable POSIX launcher disables automatic `.env` loading and dependency auto-installation and selects the packaged Bun configuration. Directly invoking the JavaScript with Bun uses the options you supply yourself.

## Containers

The optional Dockerfile runs the bundled CLI as an unprivileged user. Mount only the intended private data directory and selected project roots, with appropriate ownership. Do not mount your whole home directory, global credential stores or Docker socket. Stdio MCP needs `-i`, not a pseudo-TTY. Writable MCP still requires `--write` and explicit `--root` permissions.

Publishing a container port does not make the loopback-only workbench reachable. The container delivery is for CLI/MCP; the host portable or standalone application is the supported browser delivery. There is no automatic public listener or reverse-proxy configuration.

## Releases

A `vMAJOR.MINOR.PATCH` tag that matches `package.json` runs `.github/workflows/release.yml`. It verifies the tree, compiles `rigshelf` for darwin-arm64, darwin-x64, linux-arm64, linux-x64 and windows-x64 with the web interface embedded (`bun scripts/release.ts`), and opens a draft release with `checksums.txt` and provenance attestations. The [tapster](https://tapster.doguyilmaz.com) hub in `doguyilmaz/homebrew-tap` signs and notarizes the macOS binaries, publishes the release and writes the Homebrew, Scoop, apt and dnf entries. Connect the project once with `bunx @doguyilmaz/tapster add`, which adds the hub notification step.

Publishing the release runs `.github/workflows/npm.yml`, which assembles `@doguyilmaz/rigshelf` (`bun scripts/npm-package.ts`) and publishes it with npm trusted publishing, so `bunx @doguyilmaz/rigshelf` needs no install. The Claude Code and Codex plugin in `plugin/` is published by the repository itself through `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`; bump `plugin/plugin.json` with `package.json`.

## Before publishing

Run the normal verification, UI and package smoke suites. Review the archive inventory and checksums, qualify each advertised OS/CPU and native Harness, and establish the vulnerability-reporting contact. Supply real GitHub/S3 destinations only through the explicit connection and review flow. Packaging never publishes artifacts, creates remote services or uploads private data.
