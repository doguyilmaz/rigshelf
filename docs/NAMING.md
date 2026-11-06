# Naming exploration

The current working identity is **Rigshelf**. It remains unregistered and subject to final naming approval. Current brand/storage behavior is recorded in [the compatibility audit](BRANDING.md); [the experience brief](EXPERIENCE.md) records the product direction. Baseline `main` remains unchanged. The candidate research below is historical, dated 2026-11-05, and is not a current availability check.

**Kitfold was an earlier temporary working name and was rejected for publication.** The dated research found a collision with an existing [macOS skills and agent-profile manager](https://github.com/kadaliao/kitfold). Do not publish under this name. The primary command is now `rigshelf`. Existing data and protocol identifiers are retained under the explicit compatibility policy; fresh storage uses the current name.

The name should describe preparing a focused project kit across agents. It must cover skills, MCP connections and guidance, rather than imply a backup service or a public marketplace.

## New candidates compared with the working name

Checked 2026-11-05. These are proposals, not selected or reserved names.

| Candidate | Association | Strength | Tradeoff | Screening result |
| --- | --- | --- | --- | --- |
| Kitfold | Fold a kit into a project | Short and relevant | Existing product in the same category | Reject for publication |
| Kitferry | Carry the right kit from a private library to each project | Easy to say; agent-independent; describes delivery | Does not immediately communicate project scope | No overlapping software product found in this search; repository search 0, npm 404, `.dev` RDAP 404 |
| Kitlatch | Attach a stable, pinned kit to a project | Short; suggests deliberate binding and reliability | Harder pronunciation; mechanical latch-part search noise | No overlapping software product found in this search; repository search 0, npm 404, `.dev` RDAP 404 |
| Scopeparcel | A portable bundle with an explicit project scope | Distinctive; covers all capability types | Longer CLI name and less immediately familiar | No exact product found in this search; repository search 0, npm 404, `.dev` RDAP 404 |

Kitferry was the leading proposal at this earlier exploration stage. It is not the current product identity or a new naming decision.

## Earlier candidates retained for comparison

| Candidate | Product association | GitHub repository-name results | npm package lookup | `.dev` registry RDAP |
| --- | --- | --- | --- | --- |
| Kitsplice | Combine capabilities into one project kit | 0 | 404 | 404 |
| Kitweft | Weave capabilities into a project setup | 0 | 404 | 404 |
| Kitstride | Give each project a prepared start | 0 | 404 | 404 |

## Evidence and limits

Primary checks used [GitHub repository search](https://docs.github.com/en/rest/search/search#search-repositories) with `<name> in:name`, the npm registry and Google's `.dev` RDAP service. Exact-name web searches supplemented those checks. The same RDAP endpoint returned 200 for registered `web.dev`.

- Kitferry: [npm](https://registry.npmjs.org/kitferry), [domain record](https://pubapi.registry.google/rdap/domain/kitferry.dev).
- Kitlatch: [npm](https://registry.npmjs.org/kitlatch), [domain record](https://pubapi.registry.google/rdap/domain/kitlatch.dev).
- Scopeparcel: [npm](https://registry.npmjs.org/scopeparcel), [domain record](https://pubapi.registry.google/rdap/domain/scopeparcel.dev).

A 404 is a dated absence of a registry record, not a reservation or trademark clearance. GitHub repository names are not globally exclusive. The Kitfold collision demonstrates why a free npm package or domain record alone is insufficient. No package, domain, repository or external account was registered.

Other rejected candidates include Strata, Kitlane, Kitloom, Kitscope, Kitted, Kitrail, HarnessKit, Agentstow, KitRelay, Presetry, Scopeweave, Scopeferry, Stackferry and Setweave because searches found existing software, products or ambiguous exact-name software references. Skillsetup is too narrow.

Branding does not define the portable schema contract. Its numeric version remains independent of the final product name.
