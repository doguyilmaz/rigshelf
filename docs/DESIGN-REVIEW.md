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
| Canvas / Step by step | Guided steps with warm surfaces and a clear current task | Calm, approachable setup flow | Repeated setup takes more navigation. |
| Console / Files visible | Dense dark workspace with context and file-preview columns | Fast inspection for frequent multi-agent use | Higher information density. |

No direction is approved yet. The user requested alternatives before a visual redesign. The working name also remains provisional; see [naming](NAMING.md). Keep functional fixes independent of the eventual visual choice.

After `bun run build`, the running workbench also serves `/prototypes/project-setup.html?v=1` (single screen), `?v=2` (guided) and `?v=3` (file preview). The build extracts the prototype script into a local asset so these pages work with the application's existing Content Security Policy; no inline-script exception is added.
