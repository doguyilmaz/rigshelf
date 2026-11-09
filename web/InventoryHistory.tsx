import { Download, History } from 'lucide-react';
import { useState } from 'react';
import { api, apiId, formatDate } from './api';
import { Button, Notice } from './components';
import { t } from './i18n';

interface Checkpoint {
  id: string;
  createdAt: string;
  projects: number;
  installations: number;
}
export function InventoryHistory({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>();
  const [busy, setBusy] = useState(false);
  async function load(): Promise<void> {
    setBusy(true);
    try {
      setCheckpoints(await api<Checkpoint[]>('scan-history'));
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function download(checkpoint: Checkpoint): Promise<void> {
    setBusy(true);
    try {
      const value = await api<unknown>(`scan-history/${apiId(checkpoint.id)}`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `rigshelf-inventory-${checkpoint.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <History size={22} />
      <h3>{t('Inventory history')}</h3>
      <p>
        {t(
          'Each scan first saves the previous project and installation index. These private checkpoints preserve relationships; source-file contents remain in their originals or library snapshots.',
        )}
      </p>
      <Button variant="secondary" disabled={busy} onClick={() => void load()}>
        {t('Show inventory checkpoints')}
      </Button>
      {checkpoints && (
        <>
          {!checkpoints.length && (
            <Notice>
              {t(
                'No inventory checkpoints yet. The first scan creates one before changing the index.',
              )}
            </Notice>
          )}
          <ul className="inventory-checkpoints">
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.id}>
                <span>
                  {formatDate(checkpoint.createdAt)}
                  <small>
                    {t('{{projects}} projects · {{locations}} installation locations', {
                      projects: checkpoint.projects,
                      locations: checkpoint.installations,
                    })}
                  </small>
                </span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void download(checkpoint)}
                  aria-label={t('Download inventory checkpoint {{date}}', {
                    date: formatDate(checkpoint.createdAt),
                  })}
                >
                  <Download size={15} />
                  {t('Download')}
                </Button>
              </li>
            ))}
          </ul>
          <small>
            {t(
              'Downloads include private paths. They are inventory receipts, not project-file backups or setup permissions. No automatic restore is performed.',
            )}
          </small>
        </>
      )}
    </section>
  );
}
