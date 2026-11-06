# Backup and synchronization

Backup is secondary to project setup. A backup destination never becomes an agent discovery root or an authority source. Importing a backup cannot restore project ownership, automation permissions or a running AI request.

## Available now

**Settings → Review backup** lists the portable records and excluded content. Select a previous Rigshelf `.json.gz` export to compare added, changed, removed and unchanged records. Comparison validates the complete archive with the import validator, but does not import it. Changes cover immutable resources and editable metadata, sources, Presets and directives. List order and export timestamps alone do not count as changes.

**Download reviewed archive** creates one complete compressed archive using the existing versioned portable format. Its fingerprint must still match the reviewed catalog. A catalog change refuses the download and asks for a fresh review. The original baseline remains a file chosen by the user; the app does not infer that a downloaded file reached durable storage.

Library exports omit Settings, AI connection profiles, credentials, local project inventories, access keys, approvals, AI jobs and rollback preimages. Custom content, source URLs/notes, provenance paths and record names can still be private. Review exclusions and keep the archive private. A portable library is not a full database/disaster-recovery backup; use a consistent SQLite backup for that separate purpose.

**GitHub and S3 remote connectors are planned, not implemented or enabled.** No background file watcher commits or uploads records. The current download is not a remote Sync receipt.

## GitHub contract

1. Select an existing private repository, backup prefix and base branch. Show the exact destination and privacy before a remote read or write. Authentication stays outside portable definitions.
2. Read the destination's current commit and backup manifest; compare it with the current portable library. Preview the batch, omitted records, object sizes and destination. Record the local fingerprint, remote commit and format version in the review.
3. **Sync** rechecks both local content and remote head. A mismatch requires renewed review. Identical content is a no-op. One pending operation per destination prevents duplicate clicks from creating duplicate PRs.
4. Write the full batch into one Git tree, preserve the base tree and unrelated paths, and create **one commit per reviewed batch** on a dedicated branch. Multiple blobs may belong to that commit; never commit once per file. Open one PR with a readable metadata/change summary and link it. Keep PR creation and merge separate, explicit actions.
5. Reconcile ambiguous network failures by operation ID and commit/content fingerprint before retrying. Never force-push or silently overwrite a changed destination. A failed or unmerged PR is not a completed backup.

GitHub's [Git trees API](https://docs.github.com/en/rest/git/trees) supports constructing a batch against an existing base tree. Omitting the base tree can delete unrelated files when committed, so preserving it is part of this contract. A canonical readable manifest accompanies the portable content; a binary archive diff alone is insufficient review evidence.

## S3-compatible contract

S3-compatible means the object-storage API, including AWS S3 and compatible services such as R2 or MinIO, subject to provider acceptance. It does not imply that every vendor implements every concurrency control.

Use an explicitly chosen private bucket and prefix. Upload a content-addressed, immutable full snapshot, then publish the small current manifest **last**, with an expected ETag or an initial-create precondition. Recheck the local review before upload and the destination before publication. If publication loses a race, retain the uploaded snapshot and ask for a new comparison; do not overwrite the winner or delete data as compensation. Unreferenced-object retention and pruning require a separate explicit policy.

AWS documents [`If-Match` and `If-None-Match` conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). A connector must verify its provider's actual conditional behavior; absence of support blocks mutable-manifest Sync. S3 has no native PR or merge: the app presents its own review, then publishes the batch after explicit Sync. Credentials are supplied through a selected external credential mechanism; none belongs in an archive, manifest, browser response or log.

## Acceptance before connecting a real destination

Require isolated adapter tests for changed-head conflicts, conditional-write failures, duplicate clicks, empty changes, interrupted uploads, ambiguous completion, expired credentials and size limits. Provide a restore preview with integrity validation and no implicit Apply. Add explicit destination capability documentation, bounded retries/cancellation, redacted diagnostics and provider-specific acceptance. Encryption/key recovery and retention remain separate design decisions, never silently selected or advertised as shipped.
