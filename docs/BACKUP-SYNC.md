# Back up your private library

Open **Settings → Manage backups**. Connect an existing private GitHub repository or S3-compatible bucket. Saving the connection sends no library data. There is no upload watcher or automatic commit loop.

1. **Add destination.** Paste a GitHub repository URL, or choose R2/S3/MinIO and enter its endpoint, bucket and region. Advanced settings contain branch/prefix and credential variable names.
2. **Configure credentials in the server environment.** Restart Rigshelf after defining them. Missing variable names appear beside the connection. Secret values never go through the browser, portable definitions or operation receipts.
3. **Test connection.** GitHub tests private repository/branch reads; write permission is exercised during Sync. S3 tests conditional creation/replacement with one temporary object and deletes it. Cleanup failure blocks Sync and reports the temporary key. Neither test sends a library archive.
4. **Review changes before Sync.** Search changes, inspect bounded before/after content and review exclusions. The review binds the library, exact destination and remote version for 30 minutes.
5. **Sync reviewed Snapshot.** GitHub creates one commit and PR. Review merge separately, or merge on GitHub and Check remote status. S3 uploads immutable objects, then conditionally publishes the current pointer. A verified identical remote library is a no-op.

**Backup verified** means Rigshelf read and validated the complete published archive. **Waiting for PR merge** is unfinished. **Outcome needs confirmation** means a request may have completed despite a lost response; check status before retrying. Retry requires acknowledgment of the original frozen Snapshot, which can be older than your current library. Leaving this page does not cancel Sync. Server shutdown cancels and drains owned work.

## Credentials and destinations

Use your secret manager or shell environment to set the selected variables before starting Rigshelf. Never commit values. A separately launched MCP process needs its own selected environment.

| Destination | Default variables | Required access |
| --- | --- | --- |
| GitHub.com | `RIGSHELF_BACKUP_GITHUB_TOKEN` | Fine-grained token limited to the existing private repository; Contents and Pull requests read/write, metadata read. |
| S3 / R2 / MinIO | `RIGSHELF_BACKUP_S3_ACCESS_KEY_ID`, `RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY` | Object read/write/delete within the chosen bucket/prefix. Delete is only for the temporary probe. |
| Temporary S3 credentials | Explicit optional `RIGSHELF_BACKUP_*` session-token reference | Same object scope. Ambient AWS credentials/session tokens are not forwarded. |

GitHub needs an initialized target branch. Public or redirected repositories are refused. Archived private repositories remain readable for restore; Sync needs an active repository. GitHub Enterprise, OAuth browser login and SSH authentication are not implemented.

R2 typically uses `https://ACCOUNT_ID.r2.cloudflarestorage.com` and region `auto`. S3 needs the bucket's regional endpoint/region, for example `https://s3.us-east-1.amazonaws.com` / `us-east-1`. Local MinIO can use `http://127.0.0.1:9000`. Other endpoints require HTTPS. Endpoints are origins without credentials, paths, queries or fragments. Requests use path-style bucket addressing and refuse redirects; choose the correct region/endpoint directly.

Confirm private bucket/public-access settings in your storage console. This is an owner assertion, not an automated privacy proof. Rigshelf does not encrypt archives or manage encryption-key recovery. GitHub rules, required checks and merge conflicts still apply; Rigshelf never force-pushes or bypasses them.

## Content and publication

One gzip [portable library](DATA.md#portable-library) contains Skills/supporting resources, canonical MCP definitions, native Plugin references, sources, Presets and directives. An exclusion report identifies omitted sensitive-looking content. Heuristics do not prove that remaining content is public or secret-free.

Project source files, inventories, conversations, Settings, connections, access keys, credentials, automation approvals and rollback preimages are excluded. Custom content, notes, names and provenance can still be private. This is a library backup, not a complete database/device backup. **Settings → Review backup** still offers an independent local export.

Under the selected prefix, `current.json` points to `manifests/<sha256>.json` and `snapshots/<sha256>.json.gz`. The readable manifest indexes records/digests and exclusions, and links its previous manifest. Archives/manifests are immutable and independently verified. History follows the linked chain in bounded pages. Export timestamps and list order alone do not count as changes.

GitHub builds one tree against the reviewed `base_tree`, preserving unrelated paths, then one commit on `rigshelf-backup/<operation-uuid>` and one PR. A changed base requires renewed review. Merge checks the unchanged PR head/base and sends GitHub's expected head SHA. The current pointer is canonical single-line JSON, allowing competing pointer updates to participate in native merge-conflict handling. GitHub's merge API has no atomic expected-base parameter; review native conflicts/protections accordingly. Externally edited PRs cannot be merged/closed by Rigshelf.

S3 first checks conditional behavior, uploads archive/manifest using `If-None-Match: *`, then publishes `current.json` using the reviewed `If-Match` ETag or initial-create precondition. A changed pointer refuses publication and retains immutable uploads. Unknown acknowledgments never justify overwriting a winner. Services failing the capability probe are blocked.

## Restore and interruption

Choose **Backup history → Review restore**. Default restore adds missing library records and keeps existing and local-only records. An explicit option previews replacing existing Presets/directives. Conflicting immutable Snapshot IDs remain blockers. The archive and current library are rechecked before one transactional import. No project files or permissions are restored; nothing is activated.

Interrupted Sync retains a private staged archive and receipt. Check status or retry the same operation; duplicate clicks do not create another operation/PR. Close an unchanged pending PR explicitly to abandon it without merging. Removing a connection removes only the local profile; remote archives, branches and receipts remain. Configuration changes/removal refuse while unfinished work could publish. Rotate credentials through the same selected environment references, restart and reconcile. There is no automatic remote pruning or retention policy.

Limits: 128 MiB compressed archive, 512 MiB decompressed JSON, 256 MiB imported resources, 8 MiB manifest, 8 KiB pointer. GitHub archives are limited to 32 MiB. Keep at most twelve destination profiles. Sync has a three-minute deadline and at most two active jobs per process; destination exclusion persists across aliases/processes. See [data and lifecycle](DATA.md#remote-backup-records-and-authority).

## CLI and MCP

```sh
rigshelf backup list
rigshelf backup save destination.json
rigshelf backup test <destination-id>
rigshelf backup review <destination-id>
rigshelf backup sync <review-id>
rigshelf backup status <operation-id>
rigshelf backup history <destination-id>
rigshelf backup restore-review <destination-id> <manifest-digest>
rigshelf backup restore <restore-review-id>
```

`rigshelf --help` includes checked edits, frozen retry, merge review/merge, PR closure and history continuation. Sync waits for its owned job; an unmerged PR returns pending. CLI output is JSON. Destination JSON contains configuration and variable names only; use the UI or `BackupDestinationSchema` in `src/core/backup-destinations.ts`. Existing edits require `--expect previous.json`.

The [MCP guide](MCP.md) covers read/plan reviews and explicitly writable execution. MCP cannot create or reroute destinations. Imported content never grants backup authority.
