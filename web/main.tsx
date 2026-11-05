import {
  ArrowUpRight,
  BookOpen,
  Check,
  FolderOpen,
  HardDrive,
  History,
  Layers2,
  LibraryBig,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shapes,
  X,
} from 'lucide-react';
import React, { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppState, api } from './api';
import { Button, Modal, SearchBox, Spinner } from './components';
import { type DiscardRequest, requestDiscard } from './drafts';
import { GettingStarted, onboardingSeen, rememberOnboarding, Welcome } from './GettingStarted';
import { localeReady, t, useLocale } from './i18n';
import { ModalPresence } from './ModalPresence';
import { Activity } from './pages/Activity';
import { Directives } from './pages/Directives';

const Library = lazy(() =>
  import('./pages/Library').then((module) => ({ default: module.Library })),
);

import { Presets } from './pages/Presets';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import './styles.css';
import './neutral.css';

export type Page =
  | 'setup'
  | 'library'
  | 'projects'
  | 'presets'
  | 'directives'
  | 'activity'
  | 'settings';
export interface PageProps {
  state: AppState;
  refresh: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
  navigate: (page: Page, path?: string) => void;
}
const navigation = [
  { id: 'setup', name: 'Set up a project', icon: Plus },
  { id: 'library', name: 'Library', icon: LibraryBig },
  { id: 'projects', name: 'Projects', icon: FolderOpen },
  { id: 'presets', name: 'Presets', icon: Shapes },
  { id: 'directives', name: 'Directives', icon: ListFilter },
  { id: 'activity', name: 'Activity', icon: History },
] as const;

class Boundary extends React.Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error): { error: string } {
    return { error: error.message };
  }
  render(): ReactNode {
    return this.state.error ? (
      <div className="fatal">
        <h1>{t('Something needs attention.')}</h1>
        <p>{this.state.error}</p>
        <Button onClick={() => location.reload()}>{t('Reload workbench')}</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function initialPage(): Page {
  const page = location.hash.slice(1);
  return ['setup', 'library', 'projects', 'presets', 'directives', 'activity', 'settings'].includes(
    page,
  )
    ? (page as Page)
    : 'setup';
}

function App(): ReactNode {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Kitfold — ${t('Project workbench')}`;
  }, [locale]);
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>(initialPage);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [projectRequest, setProjectRequest] = useState(0);
  const [discard, setDiscard] = useState<DiscardRequest>();
  const [learned, setLearned] = useState(onboardingSeen);
  const [onboarding, setOnboarding] = useState<'guide' | 'example'>();
  const dismissWelcome = () => {
    rememberOnboarding();
    setLearned(true);
  };
  const closeOnboarding = () => {
    dismissWelcome();
    setOnboarding(undefined);
  };
  useEffect(() => {
    const handle = (event: Event) => setDiscard((event as CustomEvent<DiscardRequest>).detail);
    window.addEventListener('kitfold-discard', handle);
    return () => window.removeEventListener('kitfold-discard', handle);
  }, []);
  const refresh = useCallback(async () => {
    const data = await api<AppState>('state');
    setState(data);
    setError('');
  }, []);
  const notify = useCallback(
    (text: string, isError = false) => setToast({ text, error: isError }),
    [],
  );
  useEffect(() => {
    void refresh().catch((failure) => setError(String(failure.message)));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.error ? 12000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handle = () => {
      const next = initialPage();
      if (next === page) return;
      history.replaceState(null, '', `#${page}`);
      requestDiscard(() => {
        history.replaceState(null, '', `#${next}`);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        setPage(next);
      });
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [page]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => {
    if (state?.scan.state !== 'running') return;
    const timer = setInterval(
      () => void refresh().catch((failure) => notify(failure.message, true)),
      1500,
    );
    return () => clearInterval(timer);
  }, [state?.scan.state, refresh, notify]);
  const navigate = (next: Page, path?: string) => {
    if (next === page && path === undefined) {
      setPalette(false);
      return;
    }
    requestDiscard(() => {
      if (path !== undefined) {
        setProjectPath(path);
        setProjectRequest((value) => value + 1);
      }
      history.pushState(null, '', `#${next}`);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      setPage(next);
      setPalette(false);
    });
  };
  if (!state)
    return (
      <div className="boot">
        <Layers2 size={34} />
        <h1>{t('Kitfold')}</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => void refresh().catch((failure) => setError(failure.message))}>
              {t('Try again')}
            </Button>
          </>
        ) : (
          <Spinner text={t('Opening your workbench')} />
        )}
      </div>
    );
  const props: PageProps = { state, refresh, notify, navigate };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate('setup');
          }}
        >
          <span className="brand-mark">
            <Layers2 size={24} strokeWidth={1.6} />
          </span>
          <span>
            {t('kitfold')}
            <span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">
          <span className="live-dot" />
          {t(' YOUR WORKBENCH ')}
          <span className="local-tag">{t('LOCAL')}</span>
        </div>
        <nav aria-label={t('Main navigation')}>
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-label={t(item.name)}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{t(item.name)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            aria-label={t('Settings')}
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>{t('Settings')}</span>
          </button>
          <button
            type="button"
            className="quick-search"
            aria-label={t('Quick jump')}
            onClick={() => setPalette(true)}
          >
            <Search size={15} />
            <span>{t('Quick jump')}</span>
            <kbd>{t('⌘ K')}</kbd>
          </button>
          <div className="storage-label">
            <HardDrive size={12} />
            <span>{t('On this machine · v0.1.0')}</span>
            <span className="live-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div>
            <span>{t('Workbench')}</span>
            <span className="slash">/</span>
            <span>
              {page === 'setup'
                ? t('Project setup')
                : t(page.charAt(0).toUpperCase() + page.slice(1))}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button getting-started-trigger"
              aria-label={t('Getting started')}
              onClick={() => setOnboarding('guide')}
            >
              <BookOpen size={16} />
              <span>{t('Getting started')}</span>
            </button>
            {state.scan.state === 'running' ? (
              <Spinner text={state.scan.message} />
            ) : (
              <span className="private-indicator">
                <span className="live-dot" />
                {t(' Private by default')}
              </span>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                void refresh()
                  .then(() => notify('Workbench refreshed'))
                  .catch((failure) => notify(failure.message, true))
              }
              aria-label={t('Refresh workbench')}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
        <main>
          <div hidden={page !== 'setup'}>
            <Setup
              {...props}
              initialPath={projectPath}
              initialRequest={projectRequest}
              active={page === 'setup'}
            />
            {!learned && <Welcome onStart={setOnboarding} onDismiss={dismissWelcome} />}
          </div>
          <Suspense fallback={<Spinner text={t('Loading page…')} />}>
            {page === 'library' && <Library {...props} />}{' '}
            {page === 'projects' && <Projects {...props} />}{' '}
            {page === 'presets' && <Presets {...props} />}{' '}
            {page === 'directives' && <Directives {...props} />}{' '}
            {page === 'settings' && <Settings {...props} />}{' '}
            {page === 'activity' && <Activity {...props} />}
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>{t('Local project setup')}</span>
          <span>{t('Skills · MCP · Directives')}</span>
        </footer>
      </div>
      <ModalPresence>
        {onboarding && (
          <GettingStarted
            initialMode={onboarding}
            onClose={closeOnboarding}
            onNavigate={(next) => {
              closeOnboarding();
              navigate(next);
            }}
          />
        )}
      </ModalPresence>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <X size={17} /> : <Check size={17} />}
          <span>{t(toast.text)}</span>
          <button
            type="button"
            onClick={() => setToast(undefined)}
            aria-label={t('Dismiss notification')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <ModalPresence>
        {palette && (
          <Modal title={t('Where to?')} onClose={() => setPalette(false)}>
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder={t('Find a page or project…')}
            />
            <div className="command-results">
              {[...navigation, { id: 'settings' as const, name: t('Settings'), icon: Settings2 }]
                .filter((item) =>
                  t(item.name).toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)),
                )
                .map((item) => (
                  <button type="button" key={item.id} onClick={() => navigate(item.id)}>
                    <item.icon size={17} />
                    <span>{t(item.name)}</span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              {state.projects
                .filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8)
                .map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => navigate('setup', project.path)}
                  >
                    <FolderOpen size={17} />
                    <span>{project.name}</span>
                    <small>{t('Set up project')}</small>
                  </button>
                ))}
            </div>
          </Modal>
        )}
      </ModalPresence>
      <ModalPresence>
        {discard && (
          <Modal
            title={t('Keep your draft?')}
            subtitle={t('These changes have not been saved.')}
            onClose={() => setDiscard(undefined)}
          >
            <p>{discard.labels.join(', ')}</p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setDiscard(undefined)}>
                {t('Continue editing')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const pending = discard;
                  setDiscard(undefined);
                  pending.proceed();
                }}
              >
                {t('Discard changes')}
              </Button>
            </div>
          </Modal>
        )}
      </ModalPresence>
    </div>
  );
}
void localeReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Boundary>
        <App />
      </Boundary>
    </React.StrictMode>,
  );
});
