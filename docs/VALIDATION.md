# Validation record

Updated 2026-11-07. Results cover exercised fixtures and source revisions; they do not establish that the application or third-party content is defect-free.

The checked remediation is recorded in `68d3072` and `70fe22e`; the delivery implementation is `3c8ae35`, and the separate website implementation is `6cf5e48`, with the redesigned landing page in `7fb8bbf`, initial scrolling/readability corrections in `210e6b9` and the Search, graphics and documentation layout corrections in `763b735`. The frozen audit below describes the earlier baseline separately.

## Current development checks

| Check | Observed result |
| --- | --- |
| `bun run format` | Pass; no remaining formatter errors. |
| `bun run verify` | Pass: strict TypeScript, locale validation, 252 unit/integration tests across 38 files, production build. |
| English/Turkish catalogs | 1,276 matching messages and interpolation names; technical vocabulary preserved. |
| `bun run lint` | Pass. |
| `bun audit --json` | No known advisories reported for the locked dependency tree on 2026-11-07. |
| `bun run test:ui` | Pass: all 23 Chromium suites completed in one final run. |
| Portable and standalone delivery | Final extraction/CLI/UI/API/MCP smoke passed on macOS arm64 and isolated Linux arm64, including the legacy MCP corrections. |
| Astro website | 21 canonical guides and the preserved comparison page; 52 responsive/accessibility cases and 150 internal link/fragment targets passed under production CSP. Seven homepage reading-size cases, 70 project/Harness variants and 56 documentation reading cases passed. Every guide retains 18px prose, 15px code and 16px tables at desktop and 320px; installation/data pages also pass seven widths. Rendered installation commands match their canonical source. Memory-only clipboard and denied-access fixtures verify exact copying and manual selection; keyboard scrolling remains inside code/tables. Search checks cover immediate input focus, featured guides without an index request, pointer exit/reopen races, late results, clear, arrow/Enter/IME behavior, dark/light themes, short/mobile viewports and scroll/focus retention. Section checks cover smooth pointer progress, header clearance, keyboard/reduced motion, mobile-menu navigation, Back restoration and wheel interruption. Software WebGL covered desktop/mobile framing at device scale 2, delayed initialization, interrupted transitions, stopped idle/offscreen/overlay frames, immediate keyboard changes and context-loss recovery. JavaScript-free navigation and readable commands passed; no page errors or external requests were observed. |
| Website motion units | Four tests passed: nearest equivalent rotation, repeated visibility notifications, pause/resume timing and one drag draw per frame with queued-draw cancellation. |

The browser rerun updated two fixture assumptions: MCP save assertions read the explicitly selected private Snapshot, and the disposable dev checkout includes its required data input. The complete suite then passed with all assertions intact. Layout checks cover nine viewport sizes in English/Turkish; modal, scroll/focus, independent file reading and populated Include/Exclude controls were also inspected in fixture screenshots.

Website destination checks also cover documentation-to-Harness navigation at 1280×800, 1920×1440, 1440×1600 and 390×844, including reload and Back/Forward. The section starts at the sticky header's bottom edge and fills the remaining viewport without adjacent light strips; the root matches its dark background. A separate JavaScript-disabled check exercises the tall-screen fragment destination.

Native page-transition checks observed real 180ms fade animations for light/dark navigation, guide links and Back/Forward in full Chromium. Keyboard links, reduced motion and reload remain immediate. Rapid Back interruption settles to usable content, and Search initializes correctly after navigation. The shared head declares opt-in before stylesheet loading and waits for the destination's main HTML before painting; no client router or persistent transition state is introduced.

New regressions exercise structured/deep credential masking, exact MCP references through runtime resolution, mixed-value sanitization, legacy argument/command/query read/export/activation boundaries, canonical export metadata, external-root aliases and retained indexes, late authored edits during replace/remove/rollback, multi-byte document limits, Codex regular-file output/cleanup, archive inventory and duplicate manifests, and linked dependency notices. Fixtures preserve original bytes and verify failed operations do not grant trust or modify projects.

## Security evidence

The completed frozen audit of `55ae4bf` has 133 coverage units, three independently confirmed findings (two medium, one low), two rejected candidates and no unresolved validation record. Both validators and fresh retained-record reviews passed. All 282 frozen source hashes still match. Qualified checks use dummy data, no external network, read-only inputs, scratch-only writes, resource limits and trusted post-exit artifact promotion. Full private evidence stays outside the repository; [security review](SECURITY-REVIEW.md) describes scope and corrections.

Current development checks use isolated temporary projects/data and a minimal environment. Existing development projects, account stores and global installations are not test fixtures. Browser screenshots and reports stay in ignored `.local/qa`; temporary fixtures are under ignored `.local/tests`. Historical private catalog backups are retained.

## Delivery and acceptance limits

Rigshelf is a local browser application with the same CLI and stdio MCP engine. Portable archives require Bun; standalone archives embed Bun and production assets. Package smoke verifies inventory/checksums, unrelated working directories, linked launchers, version/help without catalog creation, ambient Bun configuration exclusion, exact served asset bytes, API authorization, stdio MCP and the filtered bridge.

No public package, signed/notarized release or registry image is published. The Dockerfile built successfully; unprivileged CLI/doctor and real stdio MCP catalog checks passed with network disabled, a read-only root and ephemeral data. Windows and native Harness/platform combinations require their own acceptance. No real GitHub repository or S3/R2 bucket was supplied: protocol fixtures cover batching, revision conflicts, conditional publication, cancellation, lost acknowledgments, restore and authority exclusion, while live service acceptance remains separate. English/Turkish are implemented; four additional languages and language review are required before the requested six-language public release.

See [distribution](DISTRIBUTION.md), [compatibility](COMPATIBILITY.md), [backup](BACKUP-SYNC.md) and [localization](LOCALIZATION.md) for concrete usage and boundaries. Earlier validation history remains in Git rather than accumulating contradictory current-version claims here.

The separate [website](WEBSITE.md) is a static introduction and field guide, not a hosted workbench. The redesigned homepage loads approximately 18.5 kB of client scripts before compression (7.0 kB gzip) for its base interactions; reduced-motion visitors do not automatically request the optional renderer. All generated JavaScript, including the optional Three.js renderer and the earlier comparison page, totals approximately 569.4 kB before compression (144.5 kB gzip). Documentation search loads its static index on the first nonempty query. The website’s locked dependency audit reported no known advisories on 2026-11-07. Graphics checks used Chromium’s software WebGL implementation; native GPU/device behavior remains a separate acceptance check. The public hosting workflow is prepared, not deployed; an actual domain and hosting configuration remain owner decisions.
