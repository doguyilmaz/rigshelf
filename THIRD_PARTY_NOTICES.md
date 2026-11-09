# Third-party notices

Rigshelf application source is MIT licensed. Bundled fonts retain their original SIL Open Font License 1.1 and notices. Fonts load from local files; no font service request is made.

| Asset | Authors and source | License | SHA-256 |
| --- | --- | --- | --- |
| `instrument-sans.ttf` (unmodified) | [The Instrument Sans Project Authors](https://github.com/google/fonts/tree/main/ofl/instrumentsans) | [OFL](web/public/fonts/instrumentsans-OFL.txt) | `b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1` |
| `newsreader.ttf` (unmodified) | [The Newsreader Project Authors](https://github.com/google/fonts/tree/main/ofl/newsreader) | [OFL](web/public/fonts/newsreader-OFL.txt) | `8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1` |

Source installs retain dependency notices in their packages. Portable and standalone archives also include `DEPENDENCY-LICENSES.txt`, generated from locally installed locked build inputs; it includes some build-only packages. Local font notices ship in `dist/fonts` in portable archives and are embedded with the interface in standalone executables. Standalone executables embed the [Bun](https://github.com/oven-sh/bun) runtime under its own licenses. No third-party brand artwork or vendor logos are bundled; the Rigshelf mark is original project artwork.

The separate static website uses [Astro](https://github.com/withastro/astro) and an optional [Three.js](https://github.com/mrdoob/three.js) renderer. Their MIT notices ship with the site: [Astro notice](site/public/licenses/astro.txt), [Three.js notice](site/public/licenses/three.txt). The interactive rig is original project geometry; it does not load a third-party model or external texture.
