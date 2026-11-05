# Interface review and open design choices

## First use and accurate project state

| Before | After | Why |
| --- | --- | --- |
| A selected but uninspected folder displayed “Choose a project” | A selected-project message points to Build my kit; inspection and current recommendations have their own states | Acknowledge the selection and explain the next action. |
| A slow response could populate a different project's kit | Cancellation/generation checks discard stale responses and changed drafts invalidate review | Tie the proposed kit to the current draft. |
| First use depended on knowing page names and action order | A dismissible welcome, persistent guide and labeled example simulation | Explain discovery, small kits, review, Apply and recovery before real changes. |
| Large native-file inventories rendered every row | Type filters, path/provider search and bounded rows with total counts and Show more | Keep large lists responsive and make undisplayed records discoverable. |
| Config and executable files looked like editable guidance | Read-only inspection; no wholesale Config/Hook/Plugin promotion | Preserve each file type's purpose and authority. |
| Prior index relationships were hard to inspect | Downloadable private inventory checkpoints in Settings | Keep prior scan data reviewable without granting restore/setup authority. |

The example performs no API requests. Its paths are illustrative; actual setup uses the reviewed planner. The guide trigger becomes an accessible icon on narrow screens. English/Turkish browser flows cover the guide and example.

The initial automated checks did not establish that the interface met the desired visual quality. The user's review identified layout shifts, poor native select behavior and insufficient collaboration on the visual direction and name. A passing test suite is not visual approval.

## Functional interface corrections

| Before | After | Why |
| --- | --- | --- |
| Browser-native selects with unrelated platform menus | Shared styled Base UI select/combobox controls | Consistent selection, focus, dismissal and keyboard behavior. |
| Large source/project/tag menus without filtering | Search inside the popup with explicit empty results | Find an item without scrolling a long menu. |
| Native project-directory datalist | Custom autocomplete that still accepts a new path | Consistent project discovery without restricting new project paths. |
| Rotated decorative cards overflowed a tablet screen | Hide the optional illustration on narrower screens | Keep the setup form inside the viewport. |
| Fixed sidebar content could extend below a short window | Responsive note visibility and independently scrollable navigation | Settings and navigation remain reachable. |
| Filter widths were squeezed into a single row | Explicit desktop/tablet/mobile arrangements and shrink-safe selected labels | Long names do not push the page sideways. |
| Escape handling assumed there were no nested popups | Popup dismissal is scoped; focus returns to its trigger | Closing a menu must preserve its containing editor and draft. |
| Page changes briefly faded text and shifted content | Immediate page rendering | Frequent navigation should remain clear and stable. |
| Mobile icon controls lost their text labels | Explicit accessible names for Settings and Quick jump | Icon-only controls remain understandable to assistive technology. |
| Dialogs recentered when data arrived or tabs changed | Stable upper anchor and a fixed, internally scrolling editor frame | Headers and close controls stay in place. |
| Conditional removal skipped exit motion | Retain the editor for a 160 ms exit, then close and restore focus | Opening and closing remain continuous; exiting controls are inert. |
| Replacing a dialog could stack two dark backdrops | One shared backdrop follows the active dialog stack | Editor changes do not flash a darker background. |
| English-only interface | Browser-persisted English/Turkish selection and a lazily loaded catalog | Language changes preserve drafts and original library content. |

New browser cases cover open popups, long/Unicode labels, empty filtering, selected values, modal containment, Escape/focus return, six viewport widths and short desktop windows. Evidence stays private under ignored QA output. Existing management flow assertions now exercise the custom controls rather than native select APIs.

## Visual exploration — awaiting user selection

The standalone [project setup prototype](../design/prototypes/project-setup.html) uses fictional data and never writes project files. It is separate from the application bundle. Presets, agents, capability choices, navigation and file review are interactive. An isolated browser check exercised these actions across all three variants, including directory-value preservation and library filtering; it reported no uncaught page errors.

| Direction | Main axis | Strength | Cost |
| --- | --- | --- | --- |
| Workbench / All together | Compact workspace with sidebar and adjacent kit summary | Familiar daily workflow; selections stay visible together | More controls share the screen. |
| Canvas / Step by step | Guided steps with neutral surfaces and a clear current task | Calm, approachable setup flow | Repeated setup takes more navigation. |
| Console / Files visible | Dense dark workspace with context and file-preview columns | Fast inspection for frequent multi-agent use | Higher information density. |

No direction is approved yet. The user requested alternatives before a visual redesign. The working name also remains provisional; see [naming](NAMING.md). Keep functional fixes independent of the eventual visual choice.

After `bun run build`, the running workbench also serves `/prototypes/project-setup.html?v=1` (single screen), `?v=2` (guided) and `?v=3` (file preview). The build extracts the prototype script into a local asset so these pages work with the application's existing Content Security Policy; no inline-script exception is added.

## Library clarity and neutral direction

The user's review rejected decorative green and purple visual treatments and asked for understandable navigation over a large inventory. This does not reject guided setup as a workflow; the earlier Canvas color treatment was the problem. The working application now uses neutral surfaces, concrete page titles and a functional library explorer. No replacement product name was selected.

| Before | After | Why |
| --- | --- | --- |
| Skills, MCP, Custom, Sources and Archived shared one tab row | Item types, source view, origin and status are separate dimensions | Each control answers one question. |
| A combined source/project selector and flat tags | Platform, technology and task facets, then independent refinements | Find content without remembering names. |
| Filters reset on navigation and were hard to inspect | Visible removable chips and named browser views | Keep and repeat a useful search. |
| Filtering happened before revision grouping | Families are grouped first; historical installations remain associated | Counts and project-use filters reflect actual saved items. |
| Archived-only empty results said the library was empty | Empty-filter results and a genuinely empty library have separate explanations | Content does not appear to disappear. |
| Forest surfaces, serif slogans and decorative setup artwork | White/gray chrome, local sans typography and direct labels | Keep attention on the task and data. |

The [library browsing contract](LIBRARY.md) describes classification limits and filter semantics. The new `/prototypes/library.html` preview uses the production component with isolated fictional state. It is a working design direction for feedback, not a claim of final visual approval.

## Completing the neutral theme migration

The first neutral pass only overrode part of the legacy theme. The live server was serving current assets, but many component rules and the shared modal overlay still used green literals. The earlier guided prototype retained its own green palette too.

| Before | After | Why |
| --- | --- | --- |
| Green base tokens hidden beneath neutral overrides | One neutral palette in `web/tokens.css` with descriptive accent/surface names | The base theme and later component styles share the same intent. |
| Green literals in setup cards, settings, editors, text and the shared modal backdrop | Neutral component colors and shadows throughout the source styles | Opening an editor or visiting another page must not restore the old tint. |
| Older layout comparison URLs retained green/purple/blue palettes | All three layout alternatives use grayscale palettes | Compare information layout without reintroducing a rejected visual treatment. |
| Layout and accessibility checks did not detect colored chrome | Computed-color checks across page, dialog, popup and prototype flows, including pseudo-elements | Detect inherited colors and overlays that source-token checks miss. |

Red and amber remain reserved for destructive actions, warnings and errors. These checks establish palette consistency, not user approval of the overall design.

Verification: `bun run verify` passed with 93 tests and matching 700-message English/Turkish catalogs; `bun run lint` and all six `bun run test:ui` suites passed. Rendered-color checks cover the setup/detection/review flow, all six other primary pages, management editors, source popups at six widths and the three earlier layout prototypes. Private screenshots and reports stay under ignored `.local/qa`.

## Select and form spacing refinement

The select menu had a reproducible layout defect: Base UI keeps its empty-result live region mounted, but our unconditional padding left a 30 px spacer even with matching options. The regression case measured 36 px between search and the first result before the correction. The region remains mounted and announced; only an actual empty message receives padding.

| Before | After | Why |
| --- | --- | --- |
| A padded empty-result region appeared above matching options | Empty regions occupy no space; a real empty result retains its message and live announcement | Remove the blank band without hiding feedback from assistive technology. |
| Narrow source menus wrapped long names across many lines | Searchable menus have a useful minimum width, bounded by the viewport; names use at most two visual lines with full accessible names and titles | Keep choices scannable and retain the full value. |
| Every facet count occupied a separate description line | Counts align on the option row; selection marks reserve a stable column | Show more relevant choices without shifting labels. |
| Popup list height ignored its hint and clear-action footer | A bounded flex column gives the list the remaining scrollable space | Preserve search and actions in short windows. |
| Setup's preset label and value sat on opposite sides of a wide row | Directory and preset fields have labels above them and align at desktop widths; narrower layouts stack | Make label/value relationships clear. |
| Custom selects in editor forms omitted the input label gap | Shared 40 px editor controls and matching label spacing | Adjacent fields align and use readable text. |
| Oversized slogan card and empty kit illustration stretched setup | Short factual setup note, a compact empty kit row and smaller section gaps | Give useful controls more of the screen. |

Browser checks now cover empty-to-populated search transitions, inline facet counts, label proximity and desktop alignment, two-line long source options, nested popup Escape/focus behavior and six viewport widths. Screenshots are reviewed privately; passing these checks does not establish final visual approval.

Verification: `bun run verify` passed (93 tests; 705 matching English/Turkish messages), `bun run lint` passed, and all six `bun run test:ui` suites passed after the final editor-alignment changes. The popup-spacing assertion was observed failing on the original 30 px spacer before the fix. One unrelated occupied test port exposed a fixture collision; the HTTP test fixture now retries that specific startup error and cleans up even if startup fails.

## Browse alongside typed directory paths

| Before | After | Why |
| --- | --- | --- |
| Setup and local import required knowing and typing an absolute directory path | A visible Browse button opens the native folder chooser while preserving text entry | Select an existing folder without copying its path. |
| Settings roots and the writable MCP connection root required manual paths | The same chooser appends a root draft or fills the connection field | Keep directory selection consistent across screens. |
| A chooser could imply immediate scanning or installation | Selection fills the draft; explicit save, import and setup actions remain separate | Choosing a location does not grant authority or perform work. |

The [directory-selection contract](DIRECTORY-SELECTION.md) records cancellation, errors, lifecycle and platform validation limits.

## Scoped project guidance and memory

| Before | After | Why |
| --- | --- | --- |
| A root-only document check could say no memory while a harness stored it outside the repository | Bounded local discovery and project-associated user memory are indexed separately | Reflect the actual storage locations without claiming a complete home-directory search. |
| One undifferentiated set of document buttons | Project files, external project memory and collapsed global guidance, each with counts and provenance | Show where a file belongs and keep shared guidance distinct. |
| Large file sets had no focused search | Search filename, path and provider within the project's guidance list | Find a topic without remembering its exact filename. |
| Every opened file appeared editable | Shared/external files have a read-only explanation; local edits retain reviewed plans | Avoid treating a project view as authority to change global or shared state. |
| Missing or bounded locations could resemble genuine absence | Explicit partial-inventory diagnostics and an inspected-locations empty state | Make discovery limits visible. |

Browser flows exercise external memory search, global guidance, read-only controls and the existing local edit/promotion path. The [discovery contract](AI-DISCOVERY.md) describes exclusions and content-loading boundaries.

## Daily project setup

The usability review found that Setup asked for optional requirements, a preset and six Agent choices before showing a useful kit. Its inline Library list stopped at 40 raw snapshots, and leaving the page discarded the draft. The primary flow now starts with the project and keeps optional decisions close to the suggested selection.

| Before | After | Why |
| --- | --- | --- |
| Project, preset, requirements, all Agent cards and an empty kit appeared together | A folder field, Browse and known projects start the page | Make the first action clear. |
| Every committed folder choice needed a separate inspection action | Known-project and Browse choices inspect read-only automatically; typed paths keep an explicit button | Remove a redundant action while keeping unfinished typing separate. |
| All recommendations appeared as peers | The selected kit leads; other suggestions and outside-library preset references are disclosed separately | Make the planned selection clear without implying every suggestion is required. |
| Preset selection silently replaced Agents | Agents, requirements and presets have independent optional controls | Preserve deliberate choices. |
| Raw inline snapshots stopped at 40 and supported only text search | A focused picker groups revisions, separates Skills/MCP, filters platform/technology and pages the full matching set | Find content without remembering a name or scrolling an unlimited list. |
| Navigating to Library discarded setup work | Setup remains in current-tab memory across pages; changing an edited project requires a discard decision | Let importing or checking a source be part of setup. |
| Rebuilding the kit replaced manual selections | Exact manual pins and family exclusions survive refreshed suggestions | Refining requirements must not undo the user's review. |
| Retaining a draft could leave native UI or stale review state alive | Inactive setup closes overlays/cancels its chooser; changed shared guidance requires inspection; removed selected snapshots block review visibly | Retain work without retaining stale authority. |

No new persistent session/context store is introduced. Draft retention ends at a reload or closed tab; browser unsaved-change protection remains. Existing reviewed plans, source preconditions, Apply and rollback still own all project writes. Neutral surfaces and restrained dialog motion remain; this is a focused interaction correction, not final naming or visual approval.

Private browser evidence covers the first screen, nested filtered picker, navigation and responsive drafts. The example remains a separate zero-request simulation. See [quickstart](QUICKSTART.md) for the revised daily flow.
