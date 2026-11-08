# Security review

Reviewed 2026-11-08. This record separates the frozen security audit from subsequent remediation and product verification. It is not a safety certification for imported content or every supported provider.

## Audit result

The standard source audit reviewed commit `55ae4bfb6d24e1aa261f97f192ce48cc860dffc9`, captured before this remediation. It covered 133 mapped units across the maintained engine, HTTP/CLI/MCP interfaces, browser, discovery, AI, backup and release inputs. Two hunter waves were followed by immediate coverage reviews and a separate final-clean review. Five candidates received fresh independent validation; the three retained findings also received fresh final record review. The structured findings and coverage validators passed.

| Baseline finding | Priority | Current correction |
| --- | --- | --- |
| MCP project-map parent aliases could index and read guidance outside selected roots. | Medium | Canonical selected-root containment before traversal; lazy reads also recheck project-derived locations, including retained records labeled global. |
| Mixed literal/placeholder MCP environment values could survive masking and escape through parsed metadata beside a masked body. | Medium | Shared credential handling for environment values, arguments, commands, headers and known URL query keys; metadata projection, masked body views, and canonical-body validation for export, planning, Apply and new automation approval. |
| Structured credential values could survive AI prompt masking. | Low | Sensitive-key context follows nested JSON, objects, arrays and scalar values; deeply nested inputs are omitted without an unmasked fallback. Environment references remain references. |

The findings describe the old audited revision. Current source contains the corrections and meaningful regressions; see [validation](VALIDATION.md) for the checked revision and remaining acceptance work. Historical Snapshot bytes, digests and receipts are preserved. Unsafe legacy definitions need a reviewed replacement before new activation; they are not silently rewritten or deleted.

Two candidates were rejected as security findings. Native memory-key collisions reproduced an association ambiguity without a new read/write principal. A revocation injected after the final file guard observed completion bookkeeping after project writes, rather than an unapproved write. The rejected claims remain in the private audit evidence to prevent repeating unsupported conclusions.

## Execution and evidence

Decisive reproductions used dummy data in an OS-enforced Linux sandbox: no external network, isolated loopback, empty allowlisted environment, read-only frozen source/dependencies/toolchain, scratch-only writes and explicit memory/CPU/process/file/disk/time limits. A trusted parent promoted only bounded regular-file JSON after all descendants exited. The MCP masking check used the real stdio tool; the AI check captured the real compatible request through a fake transport. No imported MCP command, Skill script or Plugin Hook was executed.

The frozen source hashes remained unchanged. Private harnesses, raw evidence and reports are stored outside public source. Normal development/unit/browser/package checks are separate evidence, not qualified adversarial reproductions. Final remediation/delivery source review is also separate from the frozen audit.

## Additional reliability work

The final delta review identified legacy MCP argument/command/query channels that needed the same credential handling as new imports. Regressions cover these channels, quoted references, decoded query keys and unchanged public parameters. Exports derive optional parsed MCP metadata from the checked body, preserving the original stored Snapshot.

Codex final output is read through the bounded regular-file reader before temporary-directory cleanup. Planned replacements, removals and rollback recheck current bytes and root identity after awaited guards. Document edits use the same UTF-8 byte limit as lazy reads. Release inputs, including dependency notices, reject links and use bounded descriptor reads. Dedicated release installs use copied dependency files; CI actions are pinned and artifact preparation has no publication permission.

## Trust boundaries and limits

The 2026-11-08 workflow delta received source review and ordinary isolated development tests, not another qualified adversarial audit. Custom AI roots are private Settings with explicit bounded native formats; broad home/filesystem, private account, dependency and runtime roots are refused. Source preview parses bounded data without network/catalog/project effects. Neither operation grants project ownership, trust or automation. Tests exercise globally stored project memory without importing auth/session fixtures, and confirm that custom paths remain outside portable exports. AI model choices remain bounded data, native invocations keep their existing restrictions, connected draft setup offers no write tools, and changed proposals still require explicit adoption/save. No new security finding was retained in this scoped review. Live vendor auth/quotas and undocumented manager databases remain outside that fixture evidence.

Rigshelf is a same-OS-user local application. Catalog reads are intentionally shared; writable MCP roots bound project writes, not catalog tenancy. HTTP uses loopback, Host/Origin checks and a private access capability. Imported definitions and project manifests do not grant ownership, trust, automation or backup authority. Workbench-owned cancellation/shutdown drains its jobs; automatic writes recheck current project and exact Snapshot approval.

Credential/content heuristics can miss unknown formats and can require conservative references. A clean scan, reachable source, content digest or directory listing does not prove safety. Native full-path memory encodings can alias distinct paths; memory remains read-only and promotion requires explicit review. Adversarial same-user filesystem races, native CLI/provider behavior outside documented contracts, remote IAM/privacy/retention and runtime/dependency internals are not isolated or certified by this audit.

Real GitHub/S3/R2 acceptance, each advertised OS/CPU and native Harness, release signing/notarization, runtime-license obligations, reporting contact and the six-language release gate remain explicit publication checks. No real backup destination, public listener, registry upload or hosted service was created. See [security policy](../SECURITY.md), [delivery](DISTRIBUTION.md) and [backup setup](BACKUP-SYNC.md).
