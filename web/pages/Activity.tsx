import { AlertTriangle, ArrowRight, Check, FileCode2, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { PlanView } from '../../src/core/plan-view';
import { api, apiId, formatDate, shortPath } from '../api';
import { Badge, Button, Empty, Modal, Notice, PageHeader } from '../components';
import type { PageProps } from '../main';
import { PlanReview } from './Setup';

export function Activity({ state, refresh, notify }: PageProps): ReactNode {
  const [plan, setPlan] = useState<PlanView>();
  const [rollback, setRollback] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function inspect(id: string): Promise<void> {
    try {
      setPlan(await api(`plans/${apiId(id)}`));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  async function restore(): Promise<void> {
    if (!rollback) return;
    setBusy(true);
    try {
      await api(`plans/${apiId(rollback)}/rollback`, 'POST', {});
      await refresh();
      setRollback(undefined);
      notify('Setup rolled back. Later edits were protected by conflict checks.');
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CHANGES YOU CAN TRACE"
        title="Nothing behind the curtain."
        description="Setup plans, library changes, and a way back when you need one."
      />
      {state.recoveries?.map((recovery) => (
        <div className="recovery-notice" key={recovery.id}>
          <Notice tone="warning">
            Interrupted write · {recovery.id}. Recovery restores the state before the interruption
            and refuses later edits.
            <div className="button-row">
              <Button variant="secondary" onClick={() => void inspect(recovery.id)}>
                Inspect plan
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api(`plans/${apiId(recovery.id)}/recover`, 'POST', {})
                    .then(refresh)
                    .then(() => notify('Interrupted operation recovered.'))
                    .catch((error) => notify(error.message, true))
                    .finally(() => setBusy(false));
                }}
              >
                Recover interrupted write
              </Button>
            </div>
          </Notice>
        </div>
      ))}
      {state.plans.length > 0 && (
        <section className="activity-plans">
          <div className="section-caption">
            <span>PROJECT SETUP PLANS</span>
            <span>{state.plans.length} saved locally</span>
          </div>
          {[...state.plans]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, 12)
            .map((value) => (
              <div key={value.id}>
                <span className="entry-icon">
                  <FileCode2 size={18} />
                </span>
                <div>
                  <strong>{shortPath(value.projectPath)}</strong>
                  <span>
                    {value.fileCount} file changes · {formatDate(value.createdAt)}
                  </span>
                </div>
                <Badge tone={value.status === 'applied' ? 'green' : 'neutral'}>
                  {value.status}
                </Badge>
                <Button variant="ghost" onClick={() => void inspect(value.id)}>
                  Inspect <ArrowRight size={13} />
                </Button>
                {value.status === 'applied' && (
                  <Button variant="ghost" onClick={() => setRollback(value.id)}>
                    <RotateCcw size={13} />
                    Roll back
                  </Button>
                )}
              </div>
            ))}
        </section>
      )}
      <div className="section-caption activity-label">
        <span>RECENT ACTIVITY</span>
        <span>Last 100 events · this machine</span>
      </div>
      {state.events.length ? (
        <div className="timeline">
          {state.events.map((event) => (
            <div key={event.id}>
              <span className="timeline-marker">
                {/failed|unavailable/.test(event.action) ? (
                  <AlertTriangle size={12} />
                ) : (
                  <Check size={12} />
                )}
              </span>
              <div>
                <strong>{event.action.replaceAll('.', ' / ')}</strong>
                <p>{shortPath(event.detail)}</p>
              </div>
              <time>{formatDate(event.createdAt)}</time>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="A fresh start." text="Your first scan or project setup will appear here." />
      )}
      {plan && (
        <PlanReview
          plan={plan}
          onClose={() => setPlan(undefined)}
          onApplied={() => void refresh()}
          notify={notify}
        />
      )}
      {rollback && (
        <Modal
          title="Restore the previous setup?"
          subtitle="Files must still match the applied plan. Later edits will cause a conflict instead of being overwritten."
          onClose={() => setRollback(undefined)}
        >
          <Notice>
            Existing files are restored from the private plan preimages. Files created by this plan
            are removed. Empty directories may remain.
          </Notice>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRollback(undefined)}>
              Keep current setup
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void restore()}>
              Roll back setup <RotateCcw size={15} />
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
