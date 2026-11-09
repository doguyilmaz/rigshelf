import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../api';
import { Badge, Button } from '../components';
import { t } from '../i18n';
import type { PageProps } from '../main';

export function ProjectSuggestions({
  state,
  navigate,
  query,
}: Pick<PageProps, 'state' | 'navigate'> & { query: string }) {
  const [limit, setLimit] = useState(6);
  const pending = (state.suggestions || [])
    .flatMap((suggestion) => {
      const project = state.projects.find((item) => item.id === suggestion.id);
      if (
        !project ||
        !`${project.name} ${project.path}`.toLowerCase().includes(query.toLowerCase())
      )
        return [];
      const installed = new Set(
        state.installations
          .filter((item) => item.projectId === project.id)
          .map((item) => item.entryId),
      );
      const additions = suggestion.additions.filter((item) => !installed.has(item.entry.id));
      return additions.length ? [{ project, suggestion, additions }] : [];
    })
    .sort((left, right) => right.suggestion.createdAt.localeCompare(left.suggestion.createdAt));
  if (!pending.length) return null;
  return (
    <section className="project-pending" aria-label={t('Project suggestions')}>
      <div className="workspace-section-title">
        <div>
          <h2>{t('Tools to consider for your projects')}</h2>
          <p>
            {t(
              'Dependency checks found these Library matches. Review the kit before adding anything.',
            )}
          </p>
        </div>
      </div>
      {pending.slice(0, limit).map(({ project, suggestion, additions }) => (
        <article key={project.id}>
          <div>
            <strong>{project.name}</strong>
            <small>{formatDate(suggestion.createdAt)}</small>
            <div className="project-suggestion-names">
              {additions.slice(0, 4).map((item) => (
                <Badge key={item.entry.id}>{item.entry.name}</Badge>
              ))}
              {additions.length > 4 && (
                <small>{t('and {{count}} more', { count: additions.length - 4 })}</small>
              )}
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate('setup', project.path)}>
            {t('Review project kit')}
            <ArrowRight size={14} />
          </Button>
        </article>
      ))}
      {pending.length > limit && (
        <Button variant="ghost" onClick={() => setLimit((current) => current + 6)}>
          {t('Show more projects')}
        </Button>
      )}
    </section>
  );
}
