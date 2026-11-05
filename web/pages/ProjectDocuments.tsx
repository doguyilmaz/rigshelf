import { ArrowUpRight, FileText } from 'lucide-react';
import { useState } from 'react';
import { type DocumentChoice, documentChoices } from '../../src/core/document-index';
import type { Project } from '../../src/core/model';
import { shortPath } from '../api';
import { Notice, SearchBox } from '../components';
import { t } from '../i18n';

export type { DocumentChoice } from '../../src/core/document-index';
export function ProjectDocuments({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (file: DocumentChoice) => void;
}) {
  const [query, setQuery] = useState('');
  const files = documentChoices(project);
  const filtered = files.filter((file) =>
    `${file.path} ${file.sourcePath} ${file.provider}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const groups = [
    { scope: 'project', title: 'Project files' },
    { scope: 'user-project', title: 'Project memory outside the repository' },
    { scope: 'global', title: 'Global guidance' },
  ] as const;
  return (
    <>
      <p className="eyebrow">{t('INSTRUCTIONS & MEMORY FILES')}</p>
      {files.length > 8 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={t('Search instruction and memory files…')}
        />
      )}
      {groups.map((group) => {
        const matches = filtered.filter((file) => file.scope === group.scope);
        if (!matches.length) return null;
        return (
          <details
            key={group.scope}
            className="project-document-group"
            open={group.scope !== 'global' || Boolean(query)}
          >
            <summary>
              {t(group.title)} <span>{matches.length}</span>
            </summary>
            <div className="document-buttons">
              {matches.map((file) => (
                <button
                  type="button"
                  key={file.id || file.path}
                  aria-label={file.path}
                  onClick={() => onOpen(file)}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span>
                    <strong>{file.path}</strong>
                    <small>
                      {file.scope === 'project' ? file.provider : shortPath(file.sourcePath)}
                    </small>
                  </span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          </details>
        );
      })}
      {!files.length && (
        <Notice>
          {t(
            'No instruction or memory files found in the inspected AI locations. Scan again after adding files or changing roots.',
          )}
        </Notice>
      )}
      {files.length > 0 && !filtered.length && (
        <p className="field-help">{t('No files match this search.')}</p>
      )}
      {Boolean(project.inventoryWarnings?.length) && (
        <details className="project-inventory-notes">
          <summary>{t('Some AI locations could not be fully inspected')}</summary>
          {project.inventoryWarnings?.map((warning) => (
            <p key={warning}>{shortPath(warning)}</p>
          ))}
        </details>
      )}
    </>
  );
}
