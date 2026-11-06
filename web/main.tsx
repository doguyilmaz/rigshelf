import { ArrowUpRight, Check, FolderOpen, Settings2, X } from 'lucide-react';
import React, { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { brand } from '../src/core/brand';
import { AppNavigation, navigation } from './AppNavigation';
import { type AppState, api } from './api';
import { BrandMark } from './BrandMark';
import { BuildUpdate } from './BuildUpdate';
import { Button, Modal, SearchBox, Spinner } from './components';
import { type DiscardRequest, requestDiscard } from './drafts';
import { GettingStarted, rememberOnboarding } from './GettingStarted';
import { localeReady, t, useLocale } from './i18n';
import { ModalPresence } from './ModalPresence';
import type { CurrentProject, KitEntryRequest } from './project-context';

const Activity = lazy(() =>
  import('./pages/Activity').then((module) => ({ default: module.Activity })),
);
const Directives = lazy(() =>
  import('./pages/Directives').then((module) => ({ default: module.Directives })),
);

const Library = lazy(() =>
  import('./pages/Library').then((module) => ({ default: module.Library })),
);

const Presets = lazy(() =>
  import('./pages/Presets').then((module) => ({ default: module.Presets })),
);
const Projects = lazy(() =>
  import('./pages/Projects').then((module) => ({ default: module.Projects })),
);
const Settings = lazy(() =>
  import('./pages/Settings').then((module) => ({ default: module.Settings })),
);
const Backups = lazy(() =>
  import('./pages/Backups').then((module) => ({ default: module.Backups })),
);

import { Setup } from './pages/Setup';
import './styles.css';
import './neutral.css';
import './experience.css';

export type Page =
  | 'setup'
  | 'library'
  | 'projects'
  | 'presets'
  | 'directives'
  | 'activity'
  | 'settings'
  | 'backups';
export interface PageProps {
  state: AppState;
  refresh: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
  navigate: (page: Page, path?: string) => void;
  onLearn?: (mode: 'guide' | 'example') => void;
  currentProject?: CurrentProject;
  addToKit?: (entryId: string) => void;
}

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
  return [
    'setup',
    'library',
    'projects',
    'presets',
    'directives',
    'activity',
    'settings',
    'backups',
  ].includes(page)
    ? (page as Page)
    : 'setup';
}
function hasBlockingDialog(): boolean {
  return document.querySelector('dialog[open][data-block-navigation="true"]') !== null;
}

function App(): ReactNode {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${brand.name} — ${t('Project workbench')}`;
  }, [locale]);
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>(initialPage);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [projectRequest, setProjectRequest] = useState(0);
  const [currentProject, setCurrentProject] = useState<CurrentProject>();
  const [entryRequest, setEntryRequest] = useState<KitEntryRequest>();
  const [discard, setDiscard] = useState<DiscardRequest>();
  const [onboarding, setOnboarding] = useState<'guide' | 'example'>();
  const dismissWelcome = () => {
    rememberOnboarding();
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
      if (hasBlockingDialog()) {
        notify(t('Please wait for the current operation to finish.'));
        return;
      }
      requestDiscard(() => {
        history.replaceState(null, '', `#${next}`);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        setPage(next);
      });
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [page, notify]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        if (hasBlockingDialog()) return;
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
  const showPage = (next: Page) => {
    history.pushState(null, '', `#${next}`);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setPage(next);
    setPalette(false);
  };
  const navigate = (next: Page, path?: string) => {
    if (hasBlockingDialog()) {
      notify(t('Please wait for the current operation to finish.'));
      return;
    }
    if (next === page && path === undefined) {
      setPalette(false);
      return;
    }
    requestDiscard(() => {
      if (path !== undefined) {
        setProjectPath(path);
        setProjectRequest((value) => value + 1);
      }
      showPage(next);
    });
  };
  if (!state)
    return (
      <div className="boot">
        <BrandMark size={34} />
        <h1>{brand.name}</h1>
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
  const addToKit = (entryId: string) => {
    const entry = state.entries.find((item) => item.id === entryId);
    if (!currentProject || !entry || !['skill', 'mcp'].includes(entry.kind)) return;
    requestDiscard(() => {
      setEntryRequest((previous) => ({
        sequence: (previous?.sequence || 0) + 1,
        projectId: currentProject.id,
        entryId,
      }));
      showPage('setup');
    });
  };
  const props: PageProps = {
    state,
    refresh,
    notify,
    navigate,
    onLearn: setOnboarding,
    currentProject,
    addToKit,
  };
  return (
    <div className="app-shell experience-shell">
      <AppNavigation
        page={page}
        navigate={navigate}
        onSearch={() => setPalette(true)}
        onGuide={() => setOnboarding('guide')}
        onRefresh={() =>
          void refresh()
            .then(() => notify('Workbench refreshed'))
            .catch((failure) => notify(failure.message, true))
        }
      />
      <BuildUpdate />
      <div className="main-shell">
        {state.scan.state === 'running' && (
          <div className="experience-scan" role="status">
            <Spinner text={state.scan.message} />
          </div>
        )}
        <main>
          <div hidden={page !== 'setup'}>
            <Setup
              {...props}
              initialPath={projectPath}
              initialRequest={projectRequest}
              active={page === 'setup'}
              onCurrentProjectChange={setCurrentProject}
              entryRequest={entryRequest}
            />
          </div>
          <Suspense fallback={<Spinner text={t('Loading page…')} />}>
            {page === 'library' && <Library {...props} />}{' '}
            {page === 'projects' && <Projects {...props} />}{' '}
            {page === 'presets' && <Presets {...props} />}{' '}
            {page === 'directives' && <Directives {...props} />}{' '}
            {page === 'settings' && <Settings {...props} />}
            {page === 'backups' && <Backups {...props} />}{' '}
            {page === 'activity' && <Activity {...props} />}
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>
            {brand.name} · {t('On your machine')}
          </span>
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
