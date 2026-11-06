import { useEffect, useState } from 'react';
import { api } from './api';
import { Button } from './components';
import { requestDiscard } from './drafts';
import { t } from './i18n';

interface Build {
  enabled: boolean;
  fingerprint?: string;
  assets?: string[];
}
export function BuildUpdate() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let initial: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const build = await api<Build>('dev-build', 'GET', undefined, controller.signal);
        if (!build.enabled) return;
        if (build.fingerprint) {
          initial ??= build.fingerprint;
          const loaded = [...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
            .map((value) => value.getAttribute(value.tagName === 'SCRIPT' ? 'src' : 'href') || '')
            .filter((value) => value.startsWith('/assets/'))
            .sort();
          if (
            initial !== build.fingerprint ||
            (build.assets && JSON.stringify(build.assets) !== JSON.stringify(loaded))
          )
            setAvailable(true);
        }
        if (!controller.signal.aborted) timer = setTimeout(() => void check(), 2000);
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => void check(), 4000);
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  if (!available) return null;
  return (
    <aside className="build-update" role="status">
      <span>{t('A new interface build is ready. Reload when your draft is saved.')}</span>
      <Button variant="secondary" onClick={() => requestDiscard(() => location.reload())}>
        {t('Reload interface')}
      </Button>
    </aside>
  );
}
