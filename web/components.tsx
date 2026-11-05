import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  Package,
  Search,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { useModalPresence } from './ModalPresence';

const MODAL_EXIT_MS = 160;

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  title,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`button ${variant} ${className}`}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}): ReactNode {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const presence = useModalPresence();
  const requestClose = () => {
    if (!presence?.exiting) onClose();
  };
  useEffect(() => {
    if (!presence?.exiting) return;
    const finish = () => {
      dialog.current?.close();
      presence.finish();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const timer = setTimeout(finish, MODAL_EXIT_MS);
    return () => clearTimeout(timer);
  }, [presence]);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      data-exiting={presence?.exiting || undefined}
      inert={presence?.exiting || undefined}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          requestClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <div>
          <p className="eyebrow">{t('WORKBENCH')}</p>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={requestClose}
          aria-label={t('Close dialog')}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Package size={25} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = t('Search the library…'),
  label = t('Search'),
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}): ReactNode {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={t('Clear search')}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function CopyButton({
  text,
  label = t('Copy'),
}: {
  text: string;
  label?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setFailed(true));
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
      {failed ? t('Select and copy below') : copied ? t('Copied') : label}
    </Button>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
}): ReactNode {
  return (
    <div className={`notice ${tone}`}>
      {tone === 'warning' ? <AlertTriangle size={17} /> : <span className="notice-dot" />}
      <div>{children}</div>
    </div>
  );
}
export function Spinner({ text = t('Working…') }: { text?: string }): ReactNode {
  return (
    <span className="loading-inline">
      <Loader2 size={16} className="spin" />
      {text}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return /^https:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link">
      {children}
      <ArrowUpRight size={13} />
    </a>
  ) : (
    <span>{children}</span>
  );
}
