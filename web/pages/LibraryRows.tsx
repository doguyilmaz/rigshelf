import { FileText, Plug, ShieldAlert } from 'lucide-react';
import type { LibraryItem } from '../../src/core/library';
import { isClassificationTag, platforms, technologies } from '../../src/core/taxonomy';
import { Badge } from '../components';
import { countText } from '../format';
import { t } from '../i18n';

export const kindLabels = {
  skill: 'Skills',
  mcp: 'MCP servers',
  plugin: 'Plugins',
  resource: 'References',
  all: 'All types',
} as const;
const singularKinds = {
  skill: 'Skill',
  mcp: 'MCP server',
  plugin: 'Plugin',
  resource: 'Reference',
};
export function LibraryRows({
  items,
  onSelect,
  showKind,
}: {
  items: LibraryItem[];
  onSelect: (id: string) => void;
  showKind: boolean;
}) {
  return (
    <div className="entry-list library-result-list">
      <div className="entry-list-head">
        <span>{t('Item')}</span>
        <span>{t('Platform / technology')}</span>
        <span>{t('Source / use')}</span>
        <span>{t('Review')}</span>
      </div>
      {items.map((item) => {
        const { entry, source, locations, classification, versions } = item;
        const usedProjects = new Set(
          locations.map((location) => location.projectId).filter(Boolean),
        );
        const definitions = classification.technologies.length ? technologies : platforms;
        const ids = classification.technologies.length
          ? classification.technologies
          : classification.platforms;
        const labels = ids.map((id) =>
          t(definitions.find((definition) => definition.id === id)?.label || id),
        );
        const review = entry.findings.some((finding) => finding.level === 'block')
          ? 'Blocked content'
          : entry.findings.some((finding) => finding.level === 'review')
            ? 'Needs review'
            : item.approved
              ? 'Approved for automation'
              : 'No flags';
        return (
          <button
            type="button"
            className="entry-list-row"
            key={item.key}
            onClick={() => onSelect(entry.id)}
            aria-label={t('Open {{name}}', { name: entry.name })}
          >
            <div className="entry-title">
              <span className="entry-icon">
                {entry.kind === 'mcp' ? <Plug size={17} /> : <FileText size={17} />}
              </span>
              <div>
                <div className="library-item-name">
                  <strong>{entry.name}</strong>
                  {showKind && (
                    <span className="library-kind-label">{t(singularKinds[entry.kind])}</span>
                  )}
                </div>
                <p>{entry.description || t('No description yet')}</p>
                <div className="library-item-flags">
                  {entry.custom && <span>{t('Custom')}</span>}
                  {entry.archived && <span>{t('Archived')}</span>}
                  {versions.length > 1 && <span>{countText(versions.length, 'version')}</span>}
                </div>
              </div>
            </div>
            <div className="library-item-classification" title={labels.join(', ')}>
              {labels.length ? (
                labels.slice(0, 2).map((label) => <span key={label}>{label}</span>)
              ) : (
                <span className="muted">{t('Unclassified')}</span>
              )}
              {labels.length > 2 && <small>+{labels.length - 2}</small>}
              {entry.tags
                .filter((tag) => !isClassificationTag(tag) && !ids.includes(tag))
                .slice(0, 1)
                .map((tag) => (
                  <small key={tag}>{tag}</small>
                ))}
            </div>
            <div className="entry-source">
              <span>{source?.name || t('Unknown source')}</span>
              <small>
                {usedProjects.size
                  ? countText(usedProjects.size, 'project')
                  : locations.some((location) => location.scope === 'global')
                    ? t('Global installations')
                    : t('Library only')}
              </small>
            </div>
            <div className="library-item-review">
              {review === 'Blocked content' || review === 'Needs review' ? (
                <Badge tone={review === 'Blocked content' ? 'red' : 'amber'}>
                  <ShieldAlert size={12} />
                  {t(review)}
                </Badge>
              ) : (
                <span>{t(review)}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
