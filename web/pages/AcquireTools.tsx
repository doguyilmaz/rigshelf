import { ArrowRight, FolderSearch, Link2, Plus, Search } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { Entry, Source } from '../../src/core/model';
import { classifyEntry, foldSearch } from '../../src/core/taxonomy';
import { api } from '../api';
import { Badge, Button, Modal, Notice, SearchBox, Spinner } from '../components';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { SourceDetail } from './SourceDetail';

const AddToLibrary = lazy(() =>
  import('./Library').then((module) => ({ default: module.AddToLibrary })),
);

export function AcquireTools({
  stacks,
  onAdd,
  onClose,
  ...props
}: PageProps & {
  stacks: string[];
  onAdd: (entry: Entry) => void;
  onClose: () => void;
}) {
  const { state, notify, refresh } = props;
  const [query, setQuery] = useState('');
  const [allSources, setAllSources] = useState(false);
  const [source, setSource] = useState<Source>();
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanRequested, setScanRequested] = useState(false);
  const [limit, setLimit] = useState(12);
  const sources = useMemo(() => {
    const stackSet = new Set(stacks);
    return state.sources
      .filter((item) => item.type === 'github')
      .map((item) => {
        const classification = classifyEntry({
          name: `${item.name} ${item.url} ${item.focusSkill || ''}`,
          tags: item.categories || [],
        });
        const matches = [...classification.technologies, ...classification.platforms].filter(
          (value) => stackSet.has(value),
        );
        return { source: item, matches };
      })
      .sort(
        (left, right) =>
          right.matches.length - left.matches.length ||
          left.source.name.localeCompare(right.source.name),
      );
  }, [state.sources, stacks]);
  const hasRelated = sources.some((item) => item.matches.length);
  const results = sources.filter(
    ({ source: item, matches }) =>
      (allSources || !hasRelated || query.trim() || matches.length) &&
      foldSearch(`${item.name} ${item.url} ${item.focusSkill || ''}`).includes(foldSearch(query)),
  );
  async function scan() {
    setScanning(true);
    try {
      await api('scan', 'POST', {});
      setScanRequested(true);
      await refresh();
      notify(t('Finding your projects and existing tools. Nothing is installed or changed.'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setScanning(false);
    }
  }
  if (source)
    return (
      <SourceDetail
        {...props}
        source={source}
        onClose={() => setSource(undefined)}
        onImported={(entry) => {
          onAdd(entry);
          onClose();
        }}
      />
    );
  if (adding)
    return (
      <Suspense fallback={<Spinner text={t('Loading page…')} />}>
        <AddToLibrary
          {...props}
          onClose={() => setAdding(false)}
          onSourceAdded={(item) => {
            setAdding(false);
            setSource(item);
          }}
          onEntryAdded={(entry) => {
            onAdd(entry);
            onClose();
          }}
        />
      </Suspense>
    );
  return (
    <Modal
      title={t('Find tools for this project')}
      subtitle={t('Collect a snapshot, choose it for your kit, then review before applying.')}
      onClose={onClose}
      wide
    >
      <div className="acquire-start">
        <button type="button" onClick={() => setAdding(true)}>
          <Plus size={19} />
          <span>
            <strong>{t('Paste a link or describe a tool')}</strong>
            <small>{t('Use AI, a repository, a local Skill or an MCP definition.')}</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          disabled={scanning || state.scan.state === 'running'}
          onClick={() => void scan()}
        >
          <FolderSearch size={19} />
          <span>
            <strong>{t('Find tools on this machine')}</strong>
            <small>{t('Read your configured project folders and agent settings.')}</small>
          </span>
          <ArrowRight size={15} />
        </button>
      </div>
      {(scanning || scanRequested || state.scan.state === 'running') && (
        <Notice>
          <p role="status">
            {scanning
              ? t('Starting inventory scan…')
              : state.scan.state === 'running'
                ? state.scan.message
                : state.scan.state === 'error'
                  ? state.scan.message
                  : t('Scan finished. Return to kit Library to choose tools.')}
          </p>
          <p>
            {t(
              'Scanning collects tools in Library. Use Back to kit Library when you are ready; your current view stays open.',
            )}
          </p>
        </Notice>
      )}
      <div className="workspace-section-title acquire-sources-heading">
        <div>
          <h2>{t('Browse saved sources')}</h2>
          <p>
            {t('Each repository may contain many Skills. Choose only what this project needs.')}
          </p>
        </div>
      </div>
      <SearchBox
        value={query}
        onChange={(value) => {
          setQuery(value);
          setLimit(12);
        }}
        placeholder={t('Search repositories or technologies…')}
        label={t('Search saved sources')}
      />
      {hasRelated && !query.trim() && (
        <div className="segmented acquire-source-filter">
          <button
            type="button"
            aria-pressed={!allSources}
            className={!allSources ? 'active' : ''}
            onClick={() => {
              setAllSources(false);
              setLimit(12);
            }}
          >
            {t('Related to this project')}
          </button>
          <button
            type="button"
            aria-pressed={allSources}
            className={allSources ? 'active' : ''}
            onClick={() => {
              setAllSources(true);
              setLimit(12);
            }}
          >
            {t('All saved sources')}
          </button>
        </div>
      )}
      <div className="acquire-source-list">
        {results.slice(0, limit).map(({ source: item, matches }) => (
          <button type="button" key={item.id} onClick={() => setSource(item)}>
            <Link2 size={17} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.url}</small>
            </span>
            <span className="acquire-source-tags">
              {matches.slice(0, 2).map((match) => (
                <Badge key={match}>{match}</Badge>
              ))}
            </span>
            <Search size={15} />
          </button>
        ))}
      </div>
      {!results.length && (
        <Notice>
          {t('No saved sources match. Paste a link or describe what you need above.')}
        </Notice>
      )}
      {results.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((value) => value + 12)}>
          {t('Show more sources')}
        </Button>
      )}
      <p className="field-help">
        {t(
          'Source matches describe relevance, not safety. Imports preserve supporting files and never run installation recipes.',
        )}
      </p>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          {t('Back to kit Library')}
        </Button>
      </div>
    </Modal>
  );
}
