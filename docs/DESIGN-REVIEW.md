# Interface review and open design choices

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
