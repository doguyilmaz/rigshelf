import { FolderOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';

interface BrowseProps {
  label: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  text?: string;
  active?: boolean;
}

function useDirectoryPicker(
  initialPath: string,
  onSelect: (path: string) => void,
  active: boolean,
) {
  const pending = useRef<AbortController | undefined>(undefined);
  const available = useRef(active);
  available.current = active;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!active) {
      pending.current?.abort();
      setBusy(false);
    }
  }, [active]);
  async function choose(): Promise<void> {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const selection = await api<{ path: string | null }>(
        'pick-directory',
        'POST',
        { initialPath },
        controller.signal,
      );
      if (available.current && !controller.signal.aborted && selection.path !== null)
        onSelect(selection.path);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Could not open the folder picker. Enter the path manually.',
        );
    } finally {
      if (pending.current === controller) pending.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return { busy, error, choose };
}

export function BrowseDirectoryButton({
  label,
  initialPath = '',
  onSelect,
  text,
  active = true,
}: BrowseProps) {
  const { busy, error, choose } = useDirectoryPicker(initialPath, onSelect, active);
  return (
    <>
      <button
        type="button"
        className="browse-directory"
        aria-label={label}
        title={label}
        disabled={busy || !active}
        aria-busy={busy}
        onClick={() => void choose()}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
        ) : (
          <FolderOpen size={16} aria-hidden="true" />
        )}
        <span>{busy ? t('Choosing…') : text || t('Browse…')}</span>
      </button>
      {error && (
        <p className="directory-picker-error" role="alert">
          {t(error)}
        </p>
      )}
    </>
  );
}

export function DirectoryPathInput({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (path: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="directory-field">
      <input
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
      <BrowseDirectoryButton
        label={t('Browse {{label}}', { label })}
        initialPath={value}
        onSelect={onValueChange}
      />
    </div>
  );
}
