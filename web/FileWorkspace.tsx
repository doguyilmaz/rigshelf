import { ArrowLeft, FileText } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { Button } from './components';
import { t } from './i18n';

export type FilePane = 'files' | 'reader';

/** The list and reader keep separate scroll positions, including when hidden on mobile. */
export function FileWorkspace({
  sidebar,
  children,
  pane,
  onPaneChange,
  selectionKey,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  pane: FilePane;
  onPaneChange: (pane: FilePane) => void;
  selectionKey?: string | number;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (selectionKey === undefined) return;
    const scroll = workspace.current?.querySelector('.file-reader-scroll');
    if (scroll) scroll.scrollTop = 0;
  }, [selectionKey]);
  useLayoutEffect(() => {
    if (selectionKey === undefined || !matchMedia('(max-width: 800px)').matches) return;
    const target =
      pane === 'reader'
        ? workspace.current?.querySelector<HTMLElement>('.file-reader-heading')
        : workspace.current?.querySelector<HTMLElement>(
            '.file-workspace-sidebar [aria-pressed="true"]',
          ) || workspace.current?.querySelector<HTMLElement>('.file-workspace-sidebar input');
    if (pane === 'files' && target?.matches('[aria-pressed="true"]')) {
      const group = target.closest('details');
      if (group) group.open = true;
      const list = target.closest('.project-file-list, .file-list');
      if (list) {
        const itemBounds = target.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        if (itemBounds.top < listBounds.top || itemBounds.bottom > listBounds.bottom)
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    }
    target?.focus({ preventScroll: true });
  }, [pane, selectionKey]);
  return (
    <div className="file-workspace" data-pane={pane} ref={workspace}>
      <div className="file-workspace-mobile-nav">
        {pane === 'reader' ? (
          <Button variant="ghost" onClick={() => onPaneChange('files')}>
            <ArrowLeft size={15} />
            {t('Back to files')}
          </Button>
        ) : selectionKey !== undefined ? (
          <Button variant="ghost" onClick={() => onPaneChange('reader')}>
            <FileText size={15} />
            {t('Return to reading')}
          </Button>
        ) : (
          <span>{t('Choose a file to read')}</span>
        )}
      </div>
      <aside className="file-workspace-sidebar" aria-label={t('Files')}>
        {sidebar}
      </aside>
      <section className="file-workspace-reader" aria-label={t('File reader')}>
        {children}
      </section>
    </div>
  );
}

export function FileScrollArea({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className: string;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Named scroll regions need keyboard scrolling.
    <section className={className} tabIndex={0} aria-label={label}>
      {children}
    </section>
  );
}
