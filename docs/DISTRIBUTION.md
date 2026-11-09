# Installation

Rigshelf is a local application: one engine provides the browser workbench, the CLI and a stdio MCP server. There is no hosted account or required cloud service.

## Install

```sh
brew install doguyilmaz/tap/rigshelf
rigshelf ui
```

Without installing: `bunx @doguyilmaz/rigshelf ui` (requires [Bun](https://bun.sh) 1.4.4 or newer).

Prebuilt executables for macOS, Linux and Windows are attached to each [GitHub release](https://github.com/doguyilmaz/rigshelf/releases) with `checksums.txt`. The macOS binaries are signed and notarized.

To use your Library from Claude Code or Codex, add the plugin; it connects the catalog MCP server and adds the integration Skill:

```sh
claude plugin marketplace add doguyilmaz/rigshelf && claude plugin install rigshelf@rigshelf
codex plugin marketplace add doguyilmaz/rigshelf && codex plugin add rigshelf@rigshelf
```

## Run

`rigshelf ui` opens the workbench on loopback at port 47471, or the next free port; `--port` fixes it. Ctrl-C stops the server after finishing running operations. There is no option to listen beyond loopback. Use the same executable with `mcp` for an agent connection ([MCP](MCP.md)).

Data goes to `~/.local/share/rigshelf`; `RIGSHELF_DATA_DIR` selects another folder. Replacing the application does not move your data. Before changing machines, keep a [Library backup](BACKUP-SYNC.md) or use [machine sync](REMOTE.md).

## Build your own archive

From a source checkout ([contributing](../CONTRIBUTING.md)):

```sh
bun run package          # portable archive; needs Bun to run
bun run package:native   # also a standalone executable for this machine
```

Archives go to the ignored `.local/releases` folder, each with a `.sha256` file; existing archives are kept unless you add `--replace`. Pick another target with `bun scripts/package.ts --native --target bun-linux-x64`. For a release checkout, install with `bun install --frozen-lockfile --backend=copyfile` first, because the packager refuses linked dependency files.

An archive contains the public documents, the integration Skill, the production interface and launchers. `manifest.json` records each file's size, mode and SHA-256. Source, dependencies, catalogs and credentials are never included.

```sh
shasum -a 256 -c rigshelf-<version>-portable.tar.gz.sha256   # sha256sum -c on Linux
mkdir rigshelf && tar -xzf rigshelf-<version>-portable.tar.gz -C rigshelf
./rigshelf/bin/rigshelf ui
```

Keep the extracted folder together and add its `bin` folder (portable) or the executable's folder (standalone) to your `PATH`. Standalone executables don't load `.env`, `bunfig.toml`, `tsconfig.json` or `package.json` from the working directory; pass credential references through the process environment.

## Container

The Dockerfile runs the CLI and stdio MCP as an unprivileged user. Mount only the data folder and the project roots it should see; never your whole home, credential stores or the Docker socket. Stdio MCP needs `-i`, not a TTY, and writable MCP still needs `--write` with explicit `--root` folders. Use a host install for the browser workbench: publishing a container port does not expose the loopback-only workbench.

## Releasing

Pushing a `vMAJOR.MINOR.PATCH` tag that matches `package.json` runs `.github/workflows/release.yml`: it verifies the tree, compiles `rigshelf` for darwin-arm64, darwin-x64, linux-arm64, linux-x64 and windows-x64 with the interface embedded, and opens a draft release with checksums and provenance attestations. The [tapster](https://tapster.doguyilmaz.com) hub signs and notarizes the macOS binaries, publishes the release and updates the Homebrew, Scoop, apt and dnf entries. Publishing the release runs `.github/workflows/npm.yml`, which publishes `@doguyilmaz/rigshelf` with npm trusted publishing. Bump `plugin/plugin.json` together with `package.json`.
