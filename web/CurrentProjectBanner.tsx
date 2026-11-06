import { ArrowRight, FolderOpen } from 'lucide-react';
import { Button } from './components';
import { t } from './i18n';
import type { PageProps } from './main';

export function CurrentProjectBanner({
  currentProject,
  navigate,
}: Pick<PageProps, 'currentProject' | 'navigate'>) {
  if (!currentProject) return null;
  return (
    <aside className="current-project-banner" aria-label={t('Current project kit')}>
      <FolderOpen size={18} />
      <div>
        <strong>{t('Choosing tools for {{project}}', { project: currentProject.name })}</strong>
        <small>
          {t('{{count}} selected for your next review', { count: currentProject.entryIds.length })}
        </small>
      </div>
      <Button variant="secondary" onClick={() => navigate('setup')}>
        {t('Return to project kit')}
        <ArrowRight size={13} />
      </Button>
    </aside>
  );
}
