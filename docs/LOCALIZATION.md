# Interface languages

English is the default interface language. Turkish is available in Settings → Language and is remembered in the current browser. Switching language preserves the current editor and unsaved values. Open tabs observe preference changes. This preference is separate from portable project definitions and does not grant project-write permission.

The Turkish catalog loads only when requested; English messages remain their source strings. There is no translation service, remote request or new runtime dependency. Failed loading preserves the current interface and offers an error rather than changing to an incomplete language. Unknown third-party diagnostics fall back to their original text.

Project/source/skill names, imported descriptions, commands, file paths, document bodies and authored guidance retain their original language. Interface localization must never rewrite snapshots or generated project instructions. Dates and counts use the selected locale; Turkish count labels use an uninflected noun after a number.

## Catalog maintenance

`web/locales/en.json` is the canonical message inventory. Its values equal the English source keys. `web/locales/tr.json` contains matching translations. New UI copy uses `t('English source', { name: value })` with named `{{name}}` interpolation. Keep a complete sentence together when word order matters. Render results as React text, never HTML.

`bun run check:locales` checks both inventories and literal UI translation calls. Unit tests verify nonempty translations, matching placeholders, fallback behavior, inherited-property handling, preserved inserted names and localized count grammar. `bun run test:ui` includes language switching, persisted choice, multiple tabs, preserved drafts, unchanged authored names, seven translated pages and desktop/mobile accessibility checks.

When adding a locale, register its native display name, loader and supported identifier in `web/i18n.ts`; add a complete catalog and locale-specific number/plural behavior, then extend browser checks. Do not expose a language with a partially populated catalog as supported.

## First public release gate

The requested release target is **six languages**: English, Turkish, German, Spanish, French and Brazilian Portuguese. English and Turkish are implemented. The other four are planned translation work and must pass the same coverage, interpolation, layout and workflow checks before a public release. They are not currently advertised in the selector.

All six require a language review for terminology and natural phrasing. The current Turkish translation has automated structural and browser verification; it is not independent linguistic certification. Expand complete-sentence messages where existing fragmented English copy prevents natural word order. Vendor diagnostics and user-authored library content remain identifiable as original content.
