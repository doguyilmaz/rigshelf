import { Download, FileText, RefreshCw, Search, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entry, Source } from '../../src/core/model';
import { api, apiId, formatDate } from '../api';
import {
  Badge,
  Button,
  CopyButton,
  ExternalLink,
  Modal,
  Notice,
  SearchBox,
  Spinner,
} from '../components';
import { useDraftGuard } from '../drafts';
import { t } from '../i18n';
import type { PageProps } from '../main';

export function SourceDetail({
  source: initial,
  refresh,
  notify,
  onClose,
  onImported,
}: PageProps & {
  source: Source;
  onClose: () => void;
  onImported?: (entry: Entry) => void;
}): ReactNode {
  const [source, setSource] = useState(initial);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [skills, setSkills] = useState<{ path: string; name: string }[]>();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const guard = useDraftGuard(
    editing &&
      ['name', 'url', 'recipe', 'notes'].some(
        (key) => draft[key as keyof Source] !== source[key as keyof Source],
      ),
    t('Source'),
  );
  useEffect(() => {
    if (initial.type !== 'github') return;
    let live = true;
    void api<{ skills: { path: string; name: string }[] } | null>(
      `sources/${apiId(initial.id)}/index`,
    )
      .then((index) => {
        if (live && index) setSkills(index.skills);
      })
      .catch((error) => notify(error.message, true));
    return () => {
      live = false;
    };
  }, [initial.id, initial.type, notify]);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await api<Source>(`sources/${apiId(source.id)}`, 'PATCH', draft);
      setSource(next);
      setDraft(next);
      setEditing(false);
      if (next.url !== source.url) setSkills(undefined);
      await refresh();
      notify(t('Source updated. Existing snapshot provenance receipts are retained.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function check(): Promise<void> {
    setBusy(true);
    try {
      setSource(await api<Source>(`sources/${apiId(source.id)}/check`, 'POST', {}));
      await refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function discover(): Promise<void> {
    setBusy(true);
    try {
      setSkills(await api(`sources/${apiId(source.id)}/skills`));
      await refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function ingest(path: string): Promise<void> {
    setBusy(true);
    try {
      const entry = await api<Entry>(`sources/${apiId(source.id)}/import`, 'POST', { path });
      await refresh();
      notify(t('{{name}} imported. It is available for project setup.', { name: entry.name }));
      if (mounted.current) onImported?.(entry);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={source.name}
      subtitle={
        source.type === 'github'
          ? t('A source can contain many skills. Import just the ones you want.')
          : t('Saved reference and installation method.')
      }
      onClose={() => guard(onClose)}
      wide
    >
      <div className="source-detail-top">
        <ExternalLink href={source.url}>{source.url || t('Local source')}</ExternalLink>
        <Badge tone={source.status === 'reachable' ? 'green' : 'neutral'}>{t(source.status)}</Badge>
        <span className="muted">{formatDate(source.checkedAt)}</span>
      </div>
      {source.repository && (
        <div className="repository-evidence">
          <p className="eyebrow">
            {t('GITHUB REPOSITORY METADATA · ')}
            {formatDate(source.repository.checkedAt)}
          </p>
          <p>
            {t('Owner')}{' '}
            <ExternalLink href={`https://github.com/${source.repository.owner}`}>
              {source.repository.owner}
            </ExternalLink>
            {source.repository.license
              ? t(' · License: {{license}}', { license: source.repository.license })
              : t(' · No declared license found')}
            {source.repository.archived ? t(' · Archived repository') : ''}
          </p>
          {source.repository.description && (
            <p className="muted">{source.repository.description}</p>
          )}
          <small>
            {t(
              'Repository ownership and a license declaration do not establish safety or endorsement.',
            )}
          </small>
        </div>
      )}
      {source.recipe && (
        <div className="recipe">
          <p className="eyebrow">{t('PREFERRED INSTALLATION RECIPE · NEVER AUTO-EXECUTED')}</p>
          <code>{source.recipe}</code>
          <CopyButton text={source.recipe} />
        </div>
      )}
      {editing ? (
        <div className="editor-form">
          <label>
            {t('Display name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            {t('Source URL')}
            <input
              type="url"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </label>
          <label>
            {t('Installation recipe')}
            <input
              value={draft.recipe}
              onChange={(event) => setDraft({ ...draft, recipe: event.target.value })}
            />
          </label>
          <label>
            {t('Research notes')}
            <textarea
              rows={5}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </label>
          <div className="button-row">
            <Button disabled={busy} onClick={() => void save()}>
              {t('Save source')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('Cancel editing')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="source-notes">{source.notes}</p>
      )}
      {source.latestRef && (
        <p className="muted">
          {t('Last checked revision ')}
          <code>{source.latestRef.slice(0, 12)}</code>
          {source.skillCount !== undefined &&
            t(' · {{count}} indexed skills', { count: source.skillCount })}
        </p>
      )}
      {source.focusSkill && (
        <Notice>
          {t('Originally saved for ')}
          <strong>{source.focusSkill}</strong>
          {t('. Other skills from the same source are available below.')}
        </Notice>
      )}
      <div className="button-row">
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(source);
            setEditing(!editing);
          }}
        >
          {t('Edit source')}
        </Button>
        {source.url && (
          <Button variant="secondary" onClick={() => void check()} disabled={busy}>
            <RefreshCw size={14} />
            {t('Check source')}
          </Button>
        )}
        {source.type === 'github' && (
          <Button onClick={() => void discover()} disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                <Search size={15} />
                {t('Find skills in source')}
              </>
            )}
          </Button>
        )}
      </div>
      {skills && (
        <div className="source-skill-results">
          <SearchBox
            value={query}
            onChange={(value) => {
              setQuery(value);
              setLimit(40);
            }}
            placeholder={t('Search {{count}} discovered skills…', { count: skills.length })}
          />
          {skills.length === 0 && (
            <Notice>
              {t(
                'No SKILL.md files found. This may be a CLI, docs repository, or plugin rather than a skill collection.',
              )}
            </Notice>
          )}
          {skills
            .filter((skill) =>
              `${skill.name} ${skill.path}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, limit)
            .map((skill) => (
              <div key={skill.path}>
                <FileText size={17} />
                <div>
                  <strong>{skill.name}</strong>
                  <code>{skill.path}</code>
                </div>
                <Button variant="secondary" disabled={busy} onClick={() => void ingest(skill.path)}>
                  <Download size={13} />
                  {t(onImported ? 'Import & add to kit' : 'Import snapshot')}
                </Button>
              </div>
            ))}
          {skills.filter((skill) =>
            `${skill.name} ${skill.path}`.toLowerCase().includes(query.toLowerCase()),
          ).length > limit && (
            <Button variant="secondary" onClick={() => setLimit((current) => current + 40)}>
              {t('Show more Skills')}
            </Button>
          )}
        </div>
      )}
      <div className="detail-danger">
        {removing ? (
          <>
            <span>{t('Remove this saved source?')}</span>
            <Button
              variant="danger"
              onClick={() => {
                void api(`sources/${apiId(source.id)}`, 'DELETE')
                  .then(refresh)
                  .then(onClose)
                  .catch((error) => notify(error.message, true));
              }}
            >
              {t('Remove')}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t('Cancel')}
            </Button>
          </>
        ) : (
          <button type="button" className="inline-button muted" onClick={() => setRemoving(true)}>
            <Trash2 size={13} />
            {t('Remove source')}
          </button>
        )}
      </div>
    </Modal>
  );
}
