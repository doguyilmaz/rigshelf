import { Plus, Search } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { Discovery } from '../../src/core/discovery';
import type { Source } from '../../src/core/model';
import { api, formatDate } from '../api';
import { Badge, Button, ExternalLink, Modal, Notice, SearchBox, Spinner } from '../components';
import type { PageProps } from '../main';

export function Discover({
  state,
  refresh,
  notify,
  onClose,
  onSource,
}: PageProps & { onClose: () => void; onSource: (source: Source) => void }): ReactNode {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Discovery>();
  const [busy, setBusy] = useState(false);
  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      setResult(await api<Discovery>('discover', 'POST', { query }));
      await refresh();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function add(input: string): Promise<void> {
    setBusy(true);
    try {
      const source = await api<Source>('sources', 'POST', { input });
      await refresh();
      onSource(source);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Find the next useful skill"
      subtitle="Search the public directory. Research a source before importing a snapshot."
      onClose={onClose}
      wide
    >
      <form className="discovery-search" onSubmit={(event) => void search(event)}>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Expo gestures, Go APIs, SwiftUI…"
          label="Public discovery query"
        />
        <Button type="submit" disabled={busy || query.trim().length < 2}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              <Search size={15} />
              Search directory
            </>
          )}
        </Button>
      </form>
      <p className="field-help">
        Only this search phrase is sent to skills.sh. Use public technology names, without private
        project details.
      </p>
      {!result && state.discoveries?.length ? (
        <div className="discovery-history">
          <p className="eyebrow">SAVED SUGGESTIONS</p>
          {state.discoveries.map((value) => (
            <button
              type="button"
              key={value.id}
              onClick={() => {
                setResult(value);
                setQuery(value.query);
              }}
            >
              {value.query}
              <span>
                {value.skills.length} results · {formatDate(value.checkedAt)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {result && (
        <>
          <p className="eyebrow">
            {result.skills.length} RESULTS · {formatDate(result.checkedAt)}
          </p>
          <Notice>
            Directory presence and install counts are popularity signals. They do not establish
            publisher identity or security.
          </Notice>
          <div className="source-skill-results">
            {result.skills.map((skill) => (
              <div key={skill.slug}>
                <div>
                  <strong>{skill.name}</strong>
                  <ExternalLink href={skill.url}>{skill.source}</ExternalLink>
                </div>
                <Badge>{skill.installs.toLocaleString()} installs</Badge>
                <Button variant="secondary" disabled={busy} onClick={() => void add(skill.url)}>
                  <Plus size={14} />
                  Research source
                </Button>
              </div>
            ))}
            {!result.skills.length && (
              <p>
                No matching directory results. Try a more specific technology or add a known source
                URL.
              </p>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
