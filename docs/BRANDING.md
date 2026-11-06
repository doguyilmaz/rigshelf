# Brand and compatibility audit

**Rigshelf is the confirmed product name. The user approved the name and existing visual identity on 2026-11-07.** Preserve the current branding in future development unless the user requests a change. Historical naming proposals are retained as history, not competing current recommendations.

Brand approval does not imply public-release approval, package/domain registration or trademark clearance. The repository's original directory name is not a public product name.

The rebrand review found three omissions: fresh installs still defaulted to the old data folder, newly rendered MCP connection snippets used the old command/server label, and historical naming/run documentation contained contradictory present-tense instructions. These are now corrected. Existing user data was not moved or renamed.

## Storage behavior

Fresh installations use `~/.local/share/rigshelf`. An existing `~/.local/share/kitfold` catalog is reused in place when it is the only default catalog; even a partial legacy folder is retained rather than silently starting elsewhere. Settings shows the actual path and an explicit English/Turkish explanation of the earlier name. It never displays a renamed path while opening a different catalog.

If both default catalog files exist, startup requires an explicit `RIGSHELF_DATA_DIR` choice. It does not guess which library is authoritative, merge databases, copy snapshots or discard recovery records. `RIGSHELF_DATA_DIR` takes precedence over the legacy `KITFOLD_DATA_DIR`; explicit constructor paths remain explicit. Directory resolution checks existence without opening or modifying catalog content. No automatic data migration is implemented.

Storage directory names are explicit compatibility keys, independent of the mutable display brand. A later rename must retain every supported storage location under an explicit migration/selection policy; changing the brand object alone cannot silently switch catalogs.

## Reviewed surfaces

| Surface | Current behavior | Compatibility decision |
| --- | --- | --- |
| Product name, web title, navigation, icon, CLI help, download filenames | Rigshelf / `rigshelf` | Confirmed name and approved visual identity. |
| Package metadata and primary executable | `rigshelf-workbench`, `rigshelf` | Private package; no external registration. |
| New catalog connection snippets and MCP handshake metadata | `rigshelf` | Existing named connections are not rewritten. |
| Default storage for a fresh installation | `.local/share/rigshelf` | Existing legacy storage is reused and explained. |
| Old executable and environment override | `kitfold`, `KITFOLD_DATA_DIR` | Keep existing invocations usable. |
| Existing library/archive format | `kitfold-library`, schema 1; native Plugin format key | Data identifiers remain stable, independent of display name. |
| Project kit, bridge files, guidance markers and write/recovery locks | `.kitfold/…`, `kitfold:begin/end`, `.kitfold-write.lock` | Renaming these without a versioned ownership/recovery transition could orphan authored files or pending work. |
| Managed MCP forwarding bridge executable | `kitfold mcp-proxy` | Existing generated plans/configuration retain their supported alias; `bun link` registers both commands. This is distinct from the new catalog connection snippet. |
| MCP tool names and integration Skill ID | `kitfold_*`, `skills/kitfold` | Keep existing agent requests and installed integrations valid without registering duplicate tools or adding context. |
| Browser access/preferences, internal draft events, private chooser variables and redaction placeholders | Existing `kitfold` keys | These are state/protocol identifiers, not product labels. No browser-state reset is required. |
| Historical prototypes, research receipts and naming comparisons | Dated historical context | Not current UI or fresh availability claims. |

Current run/storage documentation links to this policy. The unreferenced old product-label translation was removed; technical MCP tool names remain exact. A brand-wide string replacement is not a supported migration strategy.

## Verification and limits

Isolated fixtures cover fresh directory selection, existing snapshot/resource/recovery retention, partial legacy folders, both-catalog refusal, explicit override precedence and read-only directory resolution. MCP checks cover current handshake metadata while legacy tool names and environment overrides still work. New connection snippets use the native formats of all six Harnesses and preserve writable-root requirements.

Browser checks use a real isolated catalog in a folder named `kitfold`, verify the actual displayed path and compatibility explanation in English/Turkish, render a Rigshelf Codex connection and check three desktop/mobile widths for overflow and automated accessibility issues. No real user catalog, development project or global integration is rewritten by these checks. A full data-directory/identifier migration remains a separate versioned design and explicit user action.
