import {
  ArrowUpRight,
  BookOpen,
  FolderOpen,
  History,
  LibraryBig,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shapes,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { brand } from '../src/core/brand';
import { BrandMark } from './BrandMark';
import { t } from './i18n';
import type { Page } from './main';

export const navigation = [
  { id: 'setup', name: 'Set up a project', icon: Plus },
  { id: 'projects', name: 'Projects', icon: FolderOpen },
  { id: 'library', name: 'Library', icon: LibraryBig },
  { id: 'presets', name: 'Presets', icon: Shapes },
  { id: 'directives', name: 'Directives', icon: ListFilter },
  { id: 'activity', name: 'Activity', icon: History },
] as const;
export function AppNavigation({
  page,
  navigate,
  onSearch,
  onGuide,
  onRefresh,
  remote,
}: {
  page: Page;
  navigate: (page: Page) => void;
  onSearch: () => void;
  onGuide: () => void;
  onRefresh: () => void;
  remote?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page && menu.current) menu.current.open = false;
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);
  return (
    <header className="experience-header">
      <button
        type="button"
        className="experience-brand"
        onClick={() => navigate('setup')}
        aria-label={t('Rigshelf home')}
      >
        <BrandMark size={26} />
        <span>{brand.name}</span>
        {remote ? (
          <small className="experience-remote" title={remote}>
            {t('Remote: {{name}}', { name: remote })}
          </small>
        ) : (
          <small>{t('Local workspace')}</small>
        )}
      </button>
      <nav className="experience-nav" aria-label={t('Main navigation')}>
        {navigation.slice(0, 3).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={t(item.name)}
            aria-current={page === item.id ? 'page' : undefined}
            className={page === item.id ? 'active' : ''}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={16} strokeWidth={1.7} />
            <span>{t(item.id === 'setup' ? 'Prepare' : item.name)}</span>
          </button>
        ))}
        <details className="experience-more" ref={menu}>
          <summary className={['presets', 'directives'].includes(page) ? 'active' : ''}>
            {t('Defaults')}
            <ArrowUpRight size={13} />
          </summary>
          <div className="experience-more-menu">
            <p>{t('Reuse what works for you')}</p>
            {navigation.slice(3, 5).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={t(item.name)}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  navigate(item.id);
                }}
              >
                <item.icon size={16} />
                <span>
                  <strong>{t(item.name)}</strong>
                  <small>
                    {t(
                      item.id === 'presets'
                        ? 'Starting kits for the stacks you use'
                        : 'How your agents should work',
                    )}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </details>
      </nav>
      <div className="experience-tools">
        <button
          type="button"
          className={`icon-button ${page === 'activity' ? 'active' : ''}`}
          aria-label={t('Activity')}
          title={t('Activity')}
          onClick={() => navigate('activity')}
        >
          <History size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Refresh workbench')}
          title={t('Refresh workbench')}
          onClick={onRefresh}
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Quick jump')}
          title={t('Quick jump')}
          onClick={onSearch}
        >
          <Search size={17} />
          <kbd>⌘ K</kbd>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Getting started')}
          title={t('Getting started')}
          onClick={onGuide}
        >
          <BookOpen size={17} />
        </button>
        <button
          type="button"
          className={`icon-button ${page === 'settings' ? 'active' : ''}`}
          aria-label={t('Settings')}
          title={t('Settings')}
          onClick={() => navigate('settings')}
        >
          <Settings2 size={17} />
        </button>
      </div>
      {remote && (
        <p className="experience-remote-line" title={remote}>
          {t('Remote: {{name}}', { name: remote })}
        </p>
      )}
    </header>
  );
}
