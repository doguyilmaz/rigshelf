# Library browsing

The library has two views: **Items** are saved skill/MCP/plugin/reference snapshots; **Sources** are collections and references from which items can be imported. Sources are not an item type. Custom origin and archived status are independent filters, not sibling content types.

Start with an item type, then platform/area, technology or task. For example, Skills → Mobile → Expo → Authentication finds relevant items without a remembered filename. Options show matching family counts. Multiple choices within one facet mean **any** selected value; different facets must all match. Selected filters remain visible and can be removed individually. Status stays visible beside sorting so archived content is discoverable.

More filters cover source, project use, agent, installation location, custom/imported origin, content findings, exact automation approval and ordinary tags. Source and project are independent. Installation criteria must match the same installation: a global Codex copy and a project Claude copy do not make that family a project Codex installation.

Search matches all entered words across names, descriptions, tags, source names/URLs and recognized classification labels. Case and common diacritics are folded. It does not fetch bodies or call a model. Results are grouped by kind, source and name before filtering; revisions count once, and installation use includes historical pinned revisions. Lists render at most 40 families per page.

## Classification and manual corrections

Classification is a bounded heuristic over saved names and tags. It is not source verification, security review or a statement that a tool only works on one platform. Unclassified items are available as a facet option rather than being discarded. Languages alone do not automatically imply every target platform.

Open item details → Classification to adjust platform/area, technology or task. Save with **Save relationships**. Changing a classification updates metadata, not snapshot bytes, digests, supporting files, project files or automation approval. **Use detected classification** removes manual overrides. Overrides belong to the selected snapshot; review organization when importing a new upstream version.

Manual values use existing versioned tag storage: `platform:<id>`, `technology:<id>` and `topic:<id>`. Each axis can be overridden independently. The `unclassified` value explicitly clears that axis. iOS/Android include Mobile; macOS includes Desktop. Unknown namespace values remain original metadata and do not grant authority. Ordinary tags retain their spelling and stay editable separately. Older portable readers can preserve these strings as tags; no archive/schema migration is required.

## Browser views

Filters persist across navigation/reload in `agent-setup.library.v1`. Save up to 12 named views. Saving with an existing name updates it; deletion only removes that browser view. These are browser preferences, separate from project presets and portable library content. Invalid or oversized preference data falls back to bounded defaults. When browser storage fails, views are kept only for the current visit and the interface says so.

## Preview and verification

The independent `/prototypes/library.html` preview renders the real Library component with fictional metadata. Its build isolates preference/language keys and replaces all API access with local example reads or explicit refusal. It never forwards scan, import, edit or project-write requests. The inline version uses the same compiled component and example state.

Core tests cover token boundaries, manual overrides, AND/OR behavior, multiword/diacritic search, version deduplication, same-installation matching, facet counts, unknown classification, archival/origin/review independence and corrupt browser preferences. The 520-item browser scenario covers combined browsing, saved views, persisted filters, metadata editing without content changes, type separation and six viewport widths.
