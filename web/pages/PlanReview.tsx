import { ArrowRight, FileCode2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { FilePreview, PlanView } from '../../src/core/plan-view';
import { api, apiId, shortPath } from '../api';
import { Badge, Button, Modal, Notice, Spinner } from '../components';
import { useDraftGuard } from '../drafts';
import { t } from '../i18n';
import type { PageProps } from '../main';
import { SetupHandoff } from './SetupHandoff';

export function PlanReview({
  plan: initial,
  onClose,
  onApplied,
  notify,
  state,
  navigate,
}: {
  plan: PlanView;
  onClose: () => void;
  onApplied: () => void;
  notify: PageProps['notify'];
  state: PageProps['state'];
  navigate: PageProps['navigate'];
}): ReactNode {
  const [plan, setPlan] = useState(initial);
  const [file, setFile] = useState(0);
  const [busy, setBusy] = useState(false);
  useDraftGuard(busy, t('Applying project changes'));
  const [before, setBefore] = useState(false);
  const change = plan.changes[file];
  const [preview, setPreview] = useState<FilePreview>();
  useEffect(() => {
    let live = true;
    setPreview(undefined);
    if (change)
      void api<FilePreview>(`plans/${apiId(plan.id)}/changes/${change.index}`)
        .then((value) => {
          if (live) setPreview(value);
        })
        .catch((error) => {
          if (live) notify(error.message, true);
        });
    return () => {
      live = false;
    };
  }, [plan.id, change, notify]);
  const content = !change
    ? t('Your project already matches this kit.')
    : !preview
      ? t('Loading file preview…')
      : before
        ? preview.before
        : preview.after;
  async function apply(): Promise<void> {
    setBusy(true);
    try {
      setPlan(await api<PlanView>(`plans/${apiId(plan.id)}/apply`, 'POST', {}));
      onApplied();
      notify(t('Project kit applied. Start or reload your agent session.'));
    } catch (error) {
      notify(error instanceof Error ? error.message : t('Setup failed'), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        plan.purpose === 'document'
          ? plan.status === 'applied'
            ? t('Document updated.')
            : t('Review document changes')
          : plan.status === 'applied'
            ? t('Your project is ready.')
            : t('Review your setup')
      }
      subtitle={`${shortPath(plan.projectPath)} · ${plan.providers.join(', ')}`}
      onClose={onClose}
      closeDisabled={busy}
      wide
    >
      {plan.status === 'applied' && plan.purpose !== 'document' && (
        <SetupHandoff
          plan={plan}
          state={state}
          onHistory={() => {
            onClose();
            navigate('activity');
          }}
        />
      )}
      <details className="plan-file-review" open={plan.status !== 'applied'}>
        <summary>{t('Inspect file changes')}</summary>
        <div className="plan-layout">
          <div className="plan-files">
            <p className="eyebrow">
              {plan.changes.length}
              {t(' FILE CHANGES')}
            </p>
            {plan.changes.map((value, index) => (
              <button
                type="button"
                key={value.path}
                className={file === index ? 'active' : ''}
                onClick={() => setFile(index)}
              >
                <FileCode2 size={14} />
                <span>{value.path}</span>
                <Badge
                  tone={
                    value.operation === 'remove'
                      ? 'red'
                      : value.operation === 'modify'
                        ? 'amber'
                        : 'green'
                  }
                >
                  {value.operation === 'remove' ? '−' : value.operation === 'modify' ? 'M' : '+'}
                </Badge>
              </button>
            ))}
          </div>
          <div className="plan-content">
            <div className="code-toolbar">
              <span>{change?.reason || t('No file selected')}</span>
              <div className="segmented">
                <button
                  type="button"
                  className={before ? 'active' : ''}
                  onClick={() => setBefore(true)}
                >
                  {t('Before')}
                </button>
                <button
                  type="button"
                  className={!before ? 'active' : ''}
                  onClick={() => setBefore(false)}
                >
                  {t('After')}
                </button>
              </div>
            </div>
            {preview && (preview.redacted || preview.truncated) && (
              <Notice>
                {preview.redacted ? t('Sensitive-looking text is masked. ') : ''}
                {preview.truncated
                  ? t('Preview is truncated; full bytes remain in the private plan.')
                  : ''}
              </Notice>
            )}
            <pre>{content}</pre>
          </div>
        </div>
        <details className="warnings">
          <summary>
            {plan.warnings.length}
            {t(' compatibility notes')}
          </summary>
          {plan.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </details>
      </details>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {plan.status === 'applied' ? t('Done') : t('Back to kit')}
        </Button>
        {plan.status === 'planned' && (
          <Button
            onClick={() => void apply()}
            disabled={busy || (plan.changes.length === 0 && !plan.requiresAdoption)}
          >
            {busy ? (
              <Spinner text={t('Applying kit')} />
            ) : (
              <>
                {plan.changes.length
                  ? t('Apply {{count}} changes', { count: plan.changes.length })
                  : t('Confirm reviewed kit')}{' '}
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        )}
      </div>
    </Modal>
  );
}
