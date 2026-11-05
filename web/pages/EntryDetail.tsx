import { Check, Copy, FileText, FolderOpen, RefreshCw, Save, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { Entry } from '../../src/core/model';
import { api, apiId, formatDate, shortPath } from '../api';
import {
  Badge,
  Button,
  CopyButton,
  Empty,
  ExternalLink,
  Modal,
  Notice,
  Spinner,
} from '../components';
import { useDraftGuard } from '../drafts';
import type { PageProps } from '../main';
import { Select } from '../Select';

interface Detail {
  entry: Entry;
  files: { path: string; bytes: number; executable: boolean }[];
}
interface FileContent {
  path: string;
  text: string;
  bytes: number;
  executable: boolean;
  binary: boolean;
  redacted: boolean;
  truncated: boolean;
}
type Props = PageProps & { id: string; onClose: () => void };

export function EntryDetail(props: Props): ReactNode {
  const [selected, setSelected] = useState(props.id);
  const [dirty, setDirty] = useState(false);
  const guard = useDraftGuard(dirty, 'Skill snapshot');
  const metadata = props.state.entries.find((entry) => entry.id === selected);
  if (!metadata) return null;
  const versions = props.state.entries
    .filter(
      (entry) =>
        entry.kind === metadata.kind &&
        entry.sourceId === metadata.sourceId &&
        entry.name === metadata.name,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return (
    <Modal
      title={metadata.name}
      subtitle="Immutable snapshots. Project changes always go through a plan."
      onClose={() => guard(props.onClose)}
      wide
    >
      {versions.length > 1 && (
        <label className="version-picker" htmlFor="snapshot-version">
          Snapshot version
          <Select
            label="Snapshot version"
            id="snapshot-version"
            value={selected}
            onValueChange={(value) => {
              guard(() => setSelected(value));
            }}
            options={versions.map((version) => ({
              value: version.id,
              label: `${version.digest.slice(0, 10)} · ${formatDate(version.updatedAt)}${version.archived ? ' · Archived' : ''}`,
            }))}
          />
        </label>
      )}
      <EntryInspector
        key={selected}
        {...props}
        id={selected}
        onRevision={setSelected}
        onDirtyChange={setDirty}
        guard={guard}
      />
    </Modal>
  );
}

function EntryInspector({
  state,
  refresh,
  notify,
  id,
  onClose,
  onRevision,
  onDirtyChange,
  guard,
}: Props & {
  onRevision: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  guard: (action: () => void) => void;
}): ReactNode {
  const entry = state.entries.find((value) => value.id === id)!;
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [tags, setTags] = useState(entry.tags.join(', '));
  const [source, setSource] = useState(entry.sourceId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(entry.custom ? entry.name : `${entry.name.slice(0, 56)}-custom`);
  const [description, setDescription] = useState(entry.description);
  const [fileDirty, setFileDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(
      editing || fileDirty || tags !== entry.tags.join(', ') || source !== entry.sourceId,
    );
    return () => onDirtyChange(false);
  }, [editing, fileDirty, tags, source, entry.tags, entry.sourceId, onDirtyChange]);
  const locations = state.installations.filter((location) => location.entryId === id);
  const trusted = state.trust?.some((value) => value.id === id && value.digest === entry.digest);
  useEffect(() => {
    let live = true;
    void api<Detail>(`entries/${apiId(id)}`)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((failure) => {
        if (live) setError(failure.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  async function act(work: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    try {
      await work();
      await refresh();
      notify(message);
    } catch (failure) {
      notify((failure as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function revision(): Promise<void> {
    await act(async () => {
      const next =
        entry.kind === 'mcp'
          ? await api<Entry>('mcp', 'POST', {
              name: entry.name,
              mcp: JSON.parse(draft),
              tags: entry.tags,
            })
          : await api<Entry>('fork', 'POST', {
              fromId: id,
              name,
              ...(editing ? { body: draft, description } : {}),
            });
      await refresh();
      onRevision(next.id);
    }, 'New snapshot saved. Supporting files and existing project pins are preserved.');
  }
  const tagValues = tags
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    <>
      <div className="detail-badges">
        <Badge>{entry.kind}</Badge>
        {entry.custom && <Badge tone="green">Custom</Badge>}
        {entry.archived && <Badge tone="amber">Archived</Badge>}
        <Badge>Snapshot {entry.digest.slice(0, 10)}</Badge>
        <span className="muted">Imported {formatDate(entry.updatedAt)}</span>
      </div>
      <div className="tabs compact">
        {['overview', 'content', 'files', 'locations'].map((value) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'active' : ''}
            onClick={() => (fileDirty ? guard(() => setTab(value)) : setTab(value))}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
            {value === 'files' && detail && ` (${detail.files.length})`}
            {value === 'locations' && ` (${locations.length})`}
          </button>
        ))}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      {tab === 'overview' && (
        <div className="detail-overview">
          <div className="editor-form">
            <label>
              Tags
              <input value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
            <label htmlFor="entry-source">
              Source relationship
              <Select
                label="Source relationship"
                id="entry-source"
                value={source}
                onValueChange={setSource}
                searchable
                options={state.sources.map((value) => ({ value: value.id, label: value.name }))}
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api(`entries/${apiId(id)}`, 'PATCH', { tags: tagValues, sourceId: source }),
                  'Relationships saved.',
                )
              }
            >
              Save relationships
            </Button>
            {entry.derivedFrom && (
              <p className="muted">
                Derived from snapshot <code>{entry.derivedFrom}</code>
              </p>
            )}
            {entry.origins?.length ? (
              <div>
                <p className="eyebrow">PROVENANCE RECEIPTS</p>
                {entry.origins.map((origin) => (
                  <div
                    className="provenance-receipt"
                    key={`${origin.sourceId}:${origin.url}:${origin.path}:${origin.ref}`}
                  >
                    <ExternalLink href={origin.url || ''}>
                      {origin.url || origin.sourceId}
                    </ExternalLink>
                    {origin.ref && <code>{origin.ref.slice(0, 12)}</code>}
                    {origin.path && <small>{shortPath(origin.path)}</small>}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <p className="eyebrow">CONTENT REVIEW</p>
            {entry.findings.length ? (
              entry.findings.map((finding) => (
                <div className={`finding ${finding.level}`} key={`${finding.code}:${finding.file}`}>
                  <Badge
                    tone={
                      finding.level === 'block'
                        ? 'red'
                        : finding.level === 'review'
                          ? 'amber'
                          : 'neutral'
                    }
                  >
                    {finding.level}
                  </Badge>
                  <p>{finding.message}</p>
                  <small>{finding.file}</small>
                </div>
              ))
            ) : (
              <Notice>No heuristic flags. This is not a security guarantee.</Notice>
            )}
            <div className="button-row detail-actions">
              <Button
                variant="secondary"
                disabled={
                  busy ||
                  !['skill', 'mcp'].includes(entry.kind) ||
                  (!trusted &&
                    (entry.archived || entry.findings.some((finding) => finding.level !== 'info')))
                }
                onClick={() =>
                  void act(
                    () => api(`trust/${apiId(id)}`, trusted ? 'DELETE' : 'POST', {}),
                    trusted
                      ? 'Snapshot approval revoked.'
                      : 'This exact snapshot is approved for trusted automation.',
                  )
                }
              >
                <Check size={14} />
                {trusted ? 'Revoke automation approval' : 'Approve snapshot for automation'}
              </Button>
              {entry.upstreamPath !== undefined && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const origin = entry.origins?.findLast(
                        (origin) =>
                          origin.ref === entry.upstreamRef &&
                          origin.path === entry.upstreamPath &&
                          origin.url?.startsWith('https://github.com/'),
                      );
                      let sourceId = entry.sourceId;
                      if (origin?.url) {
                        const known = state.sources.find((source) => source.url === origin.url);
                        sourceId =
                          known?.id ||
                          (
                            await api<{ id: string }>('sources', 'POST', {
                              url: origin.url,
                              research: false,
                            })
                          ).id;
                      }
                      const next = await api<Entry>(`sources/${apiId(sourceId)}/import`, 'POST', {
                        path: `${entry.upstreamPath ? `${entry.upstreamPath}/` : ''}SKILL.md`,
                      });
                      await refresh();
                      onRevision(next.id);
                    }, 'Latest snapshot fetched. Installed projects keep their pinned versions.')
                  }
                >
                  <RefreshCw size={14} />
                  Fetch latest snapshot
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {tab === 'content' &&
        (detail ? (
          <>
            <div className="code-toolbar">
              <span>
                {entry.kind === 'mcp'
                  ? 'Canonical definition · JSON'
                  : entry.kind === 'plugin'
                    ? 'Native plugin installation recipe'
                    : 'SKILL.md'}
              </span>
              <CopyButton text={detail.entry.body} />
            </div>
            {editing ? (
              <div className="editor-form">
                {entry.kind === 'skill' && (
                  <>
                    <label>
                      Skill name
                      <input
                        value={name}
                        maxLength={64}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        rows={3}
                        value={description}
                        maxLength={1024}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </label>
                  </>
                )}
                <label>
                  {entry.kind === 'mcp'
                    ? 'MCP definition'
                    : 'Instructions · frontmatter and resources are retained'}
                  <textarea
                    className="code-editor"
                    rows={18}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
            ) : (
              <pre className="content-preview">{detail.entry.body}</pre>
            )}
            {['skill', 'mcp'].includes(entry.kind) && (
              <div className="button-row">
                {editing ? (
                  <>
                    <Button disabled={busy || !draft.trim()} onClick={() => void revision()}>
                      <Save size={14} />
                      Save new snapshot
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(false);
                        setName(entry.custom ? entry.name : `${entry.name.slice(0, 56)}-custom`);
                        setDescription(entry.description);
                      }}
                    >
                      Cancel editing
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDraft(
                          entry.kind === 'mcp'
                            ? detail.entry.body
                            : detail.entry.body
                                .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
                                .replace(/^\s*\n/, ''),
                        );
                        setEditing(true);
                      }}
                    >
                      {entry.custom ? 'Edit content' : 'Edit a custom fork'}
                    </Button>
                    {!entry.custom && entry.kind === 'skill' && (
                      <Button variant="secondary" disabled={busy} onClick={() => void revision()}>
                        <Copy size={14} />
                        Fork with supporting files
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <Spinner text="Loading content" />
        ))}
      {tab === 'files' &&
        (detail ? (
          <SnapshotFiles
            {...{ detail, refresh, notify, onRevision, guard }}
            onDirtyChange={setFileDirty}
          />
        ) : (
          <Spinner text="Loading files" />
        ))}
      {tab === 'locations' && (
        <div className="location-list">
          {locations.length ? (
            locations.map((location) => (
              <div key={location.path + location.provider}>
                <FolderOpen size={17} />
                <div>
                  <code>{shortPath(location.path)}</code>
                  <span>
                    {location.provider} · {location.storage || location.scope} · observed{' '}
                    {formatDate(location.lastSeen)}
                  </span>
                </div>
                <Badge>{location.scope}</Badge>
              </div>
            ))
          ) : (
            <Empty
              title="Kept in your library"
              text="This snapshot has no observed project installation yet."
            />
          )}
        </div>
      )}
      <div className="detail-danger">
        {entry.archived ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api(`entries/${apiId(id)}`, 'PATCH', { tags: entry.tags, archived: false }),
                  'Snapshot restored to the library.',
                )
              }
            >
              Restore snapshot
            </Button>
            {confirm ? (
              <>
                <span>Permanently delete this snapshot? Referenced snapshots are protected.</span>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`entries/${apiId(id)}/purge`, 'DELETE');
                      onClose();
                    }, 'Unreferenced snapshot deleted.')
                  }
                >
                  Delete permanently
                </Button>
              </>
            ) : (
              <button
                type="button"
                className="inline-button muted"
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={13} />
                Delete permanently…
              </button>
            )}
          </>
        ) : confirm ? (
          <>
            <span>Archive this snapshot? Project pins and files stay available.</span>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(`entries/${apiId(id)}`, 'DELETE');
                  onClose();
                }, 'Snapshot archived.')
              }
            >
              Archive snapshot
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <button type="button" className="inline-button muted" onClick={() => setConfirm(true)}>
            <Trash2 size={13} />
            Archive snapshot
          </button>
        )}
      </div>
    </>
  );
}

function SnapshotFiles({
  detail,
  refresh,
  notify,
  onRevision,
  onDirtyChange,
  guard,
}: Pick<Props, 'refresh' | 'notify'> & {
  detail: Detail;
  onRevision: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  guard: (action: () => void) => void;
}): ReactNode {
  const [selected, setSelected] = useState<number>();
  const [file, setFile] = useState<FileContent>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('references/notes.md');
  const [newText, setNewText] = useState('');
  const [executable, setExecutable] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    onDirtyChange(adding || Boolean(file && draft !== file.text));
    return () => onDirtyChange(false);
  }, [adding, file, draft, onDirtyChange]);
  useEffect(() => {
    if (selected === undefined) return;
    let live = true;
    setFile(undefined);
    void api<FileContent>(`entries/${apiId(detail.entry.id)}/files/${selected}`)
      .then((value) => {
        if (live) {
          setFile(value);
          setDraft(value.text);
        }
      })
      .catch((error) => notify(error.message, true));
    return () => {
      live = false;
    };
  }, [selected, detail.entry.id, notify]);
  async function save(remove = false): Promise<void> {
    if (!adding && !file) return;
    setBusy(true);
    try {
      const entry = await api<Entry>(
        `entries/${apiId(detail.entry.id)}/files`,
        remove ? 'DELETE' : 'POST',
        {
          path: adding ? newPath : file!.path,
          text: adding ? newText : draft,
          executable: adding ? executable : file!.executable,
        },
      );
      await refresh();
      onRevision(entry.id);
      notify(
        remove
          ? 'Supporting file removed in a new snapshot.'
          : 'Supporting file saved as a new snapshot.',
      );
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!detail.files.length) return <Notice>No supporting files for this entry type.</Notice>;
  return (
    <>
      <div className="file-list">
        {detail.files.map((value, index) => (
          <button
            type="button"
            className={selected === index ? 'selected' : ''}
            key={value.path}
            onClick={() => guard(() => setSelected(index))}
          >
            <FileText size={15} />
            <code>{value.path}</code>
            <span>{(value.bytes / 1024).toFixed(1)} KB</span>
            {value.executable && <Badge tone="amber">Executable</Badge>}
          </button>
        ))}
      </div>
      {detail.entry.custom && (
        <div className="button-row">
          <Button
            variant="secondary"
            onClick={() =>
              guard(() => {
                setAdding(!adding);
                setRemoving(false);
              })
            }
          >
            {' '}
            {adding ? 'Cancel new file' : 'Add supporting file'}{' '}
          </Button>
        </div>
      )}
      {adding && (
        <div className="editor-form">
          <label>
            Relative file path
            <input value={newPath} onChange={(event) => setNewPath(event.target.value)} />
          </label>
          <label>
            New file content
            <textarea
              className="code-editor"
              rows={12}
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={executable}
              onChange={(event) => setExecutable(event.target.checked)}
            />
            Executable resource
          </label>
          <Button disabled={busy || !newPath.trim()} onClick={() => void save()}>
            Save new file
          </Button>
        </div>
      )}
      {selected !== undefined &&
        !adding &&
        (file ? (
          <div className="file-preview">
            <div className="code-toolbar">
              <code>{file.path}</code>
              <span>{file.bytes.toLocaleString()} bytes</span>
            </div>
            {file.binary ? (
              <Notice>Binary resource. Kept intact in its snapshot.</Notice>
            ) : (
              <>
                {(file.redacted || file.truncated) && (
                  <Notice tone="warning">
                    {file.redacted ? 'Sensitive-looking text is masked. ' : ''}
                    {file.truncated ? 'Preview is truncated. ' : ''}Editing is disabled to protect
                    the original bytes.
                  </Notice>
                )}
                {detail.entry.custom && !file.redacted && !file.truncated ? (
                  <>
                    <label className="editor-form">
                      File content
                      <textarea
                        className="code-editor"
                        rows={16}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        spellCheck={false}
                      />
                    </label>
                    <Button disabled={busy || draft === file.text} onClick={() => void save()}>
                      <Save size={14} />
                      Save file revision
                    </Button>
                    {file.path !== 'SKILL.md' && (
                      <div className="button-row">
                        {removing ? (
                          <>
                            <span>Remove this file in a new snapshot?</span>
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => void save(true)}
                            >
                              Remove file
                            </Button>
                            <Button variant="ghost" onClick={() => setRemoving(false)}>
                              Keep file
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" onClick={() => setRemoving(true)}>
                            Remove supporting file…
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <pre className="content-preview">{file.text}</pre>
                )}
              </>
            )}
          </div>
        ) : (
          <Spinner text="Loading file" />
        ))}
    </>
  );
}
