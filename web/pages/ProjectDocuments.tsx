import { FileText } from 'lucide-react';
import { useState } from 'react';
import { type DocumentChoice, documentChoices } from '../../src/core/document-index';
import type { DocumentLocation, Project } from '../../src/core/model';
import { shortPath } from '../api';
import { Button, Notice, SearchBox } from '../components';
import { FileScrollArea } from '../FileWorkspace';
import { PAGE_SIZE } from '../format';
import { t } from '../i18n';
import { Select } from '../Select';

export type { DocumentChoice } from '../../src/core/document-index';
export function ProjectDocuments({
  project,
  onOpen,
  sharedFiles = [],
  sharedWarnings = [],
  selectedKey,
}: {
  project: Project;
  onOpen: (file: DocumentChoice) => void;
  sharedFiles?: DocumentLocation[];
  sharedWarnings?: string[];
  selectedKey?: string;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const files = documentChoices(project, sharedFiles);
  const warnings = [...new Set([...(project.inventoryWarnings || []), ...sharedWarnings])];
  const filtered = files.filter(
    (file) =>
      (kind === 'all' || file.kind === kind) &&
      `${file.path} ${file.sourcePath} ${file.provider} ${file.kind}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const groups = [
    { scope: 'project', title: 'Project files' },
    { scope: 'user-project', title: 'Project memory outside the repository' },
    { scope: 'global', title: 'Global AI files' },
  ] as const;
  return (
    <>
      <div className="file-sidebar-heading">
        <h3>{t('AI FILES')}</h3>
        <span>{files.length}</span>
      </div>
      {files.length > 0 && (
        <div className="ai-file-filters">
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setVisibleCounts({});
            }}
            label={t('AI file type')}
            options={[
              { value: 'all', label: t('All AI files'), count: files.length },
              ...(
                [
                  ['instruction', 'Instructions'],
                  ['memory', 'Memory'],
                  ['rule', 'Rules'],
                  ['agent', 'Agents'],
                  ['command', 'Commands'],
                  ['config', 'Config'],
                  ['plugin', 'Plugins'],
                  ['hook', 'Hooks'],
                ] as const
              ).map(([value, label]) => ({
                value,
                label: t(label),
                count: files.filter((file) => file.kind === value).length,
              })),
            ]}
          />
          <SearchBox
            label={t('Search AI files')}
            value={query}
            onChange={(value) => {
              setQuery(value);
              setVisibleCounts({});
            }}
            placeholder={t('Search AI files by name, path or provider…')}
          />
        </div>
      )}
      <FileScrollArea className="project-file-list" label={t('AI file list')}>
        {groups.map((group) => {
          const matches = filtered.filter((file) => file.scope === group.scope);
          const visible = matches.slice(0, visibleCounts[group.scope] || PAGE_SIZE);
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
                {visible.map((file) => (
                  <button
                    type="button"
                    key={file.id || file.path}
                    aria-label={file.path}
                    aria-pressed={selectedKey === (file.id || file.sourcePath)}
                    onClick={() => onOpen(file)}
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>
                      <strong>{file.path}</strong>
                      <small>
                        {file.scope === 'project'
                          ? `${file.provider} · ${file.kind}`
                          : shortPath(file.sourcePath)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              {matches.length > visible.length && (
                <div className="ai-files-more">
                  <small>
                    {t('Showing {{shown}} of {{total}} files', {
                      shown: visible.length,
                      total: matches.length,
                    })}
                  </small>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setVisibleCounts((current) => ({
                        ...current,
                        [group.scope]: visible.length + PAGE_SIZE,
                      }))
                    }
                  >
                    {t('Show more files')}
                  </Button>
                </div>
              )}
            </details>
          );
        })}
        {!files.length && (
          <Notice>
            {t(
              'No AI files found in the inspected locations. Scan again after adding files or changing roots.',
            )}
          </Notice>
        )}
        {files.length > 0 && !filtered.length && (
          <p className="field-help">{t('No files match this search.')}</p>
        )}
        {Boolean(warnings.length) && (
          <details className="project-inventory-notes">
            <summary>{t('Some AI locations could not be fully inspected')}</summary>
            {warnings.map((warning) => (
              <p key={warning}>{shortPath(warning)}</p>
            ))}
          </details>
        )}
      </FileScrollArea>
    </>
  );
}
