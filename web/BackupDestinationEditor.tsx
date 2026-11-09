import { useRef, useState } from 'react';
import type { BackupDestination } from '../src/core/backup-destinations';
import { api } from './api';
import { Button, CopyButton, Modal, Notice, Spinner } from './components';
import { useDraftGuard } from './drafts';
import { t } from './i18n';
import { Select } from './Select';

export function BackupDestinationEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: BackupDestination;
  onClose: () => void;
  onSave: (destination: BackupDestination) => Promise<void>;
}) {
  const [kind, setKind] = useState(initial?.kind || 'github');
  const [name, setName] = useState(initial?.name || '');
  const [repository, setRepository] = useState(
    initial?.kind === 'github' ? `${initial.owner}/${initial.repository}` : '',
  );
  const [branch, setBranch] = useState(initial?.kind === 'github' ? initial.branch : 'main');
  const [endpoint, setEndpoint] = useState(initial?.kind === 's3' ? initial.endpoint : '');
  const [bucket, setBucket] = useState(initial?.kind === 's3' ? initial.bucket : '');
  const [service, setService] = useState(initial?.kind === 's3' ? initial.service : 'r2');
  const [region, setRegion] = useState(initial?.kind === 's3' ? initial.region : 'auto');
  const [prefix, setPrefix] = useState(initial?.prefix || 'rigshelf');
  const [tokenEnv, setTokenEnv] = useState(
    initial?.kind === 'github' ? initial.tokenEnv : 'RIGSHELF_BACKUP_GITHUB_TOKEN',
  );
  const [accessKeyEnv, setAccessKeyEnv] = useState(
    initial?.kind === 's3' ? initial.accessKeyEnv : 'RIGSHELF_BACKUP_S3_ACCESS_KEY_ID',
  );
  const [secretKeyEnv, setSecretKeyEnv] = useState(
    initial?.kind === 's3' ? initial.secretKeyEnv : 'RIGSHELF_BACKUP_S3_SECRET_ACCESS_KEY',
  );
  const [sessionTokenEnv, setSessionTokenEnv] = useState(
    initial?.kind === 's3' ? initial.sessionTokenEnv : '',
  );
  const [confirmed, setConfirmed] = useState(
    initial?.kind === 's3' && initial.privateBucketConfirmed,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signature = JSON.stringify({
    kind,
    name,
    repository,
    branch,
    endpoint,
    bucket,
    service,
    region,
    prefix,
    tokenEnv,
    accessKeyEnv,
    secretKeyEnv,
    sessionTokenEnv,
    confirmed,
  });
  const baseline = useRef(signature).current;
  const discard = useDraftGuard(signature !== baseline, t('Backup destination'));
  async function save() {
    setBusy(true);
    setError('');
    try {
      const parsed = repository
        .trim()
        .replace(/^https:\/\/github.com\//, '')
        .replace(/\/$/, '')
        .replace(/\.git$/, '')
        .split('/');
      if (kind === 'github' && (parsed.length !== 2 || !parsed.every(Boolean)))
        throw new Error(t('Use owner/repository or its GitHub URL.'));
      if (kind === 's3' && !confirmed)
        throw new Error(t('Confirm that this bucket is private before saving.'));
      const id = initial?.id || `backup-${crypto.randomUUID().slice(0, 8)}`;
      const value =
        kind === 'github'
          ? { id, name, kind, owner: parsed[0], repository: parsed[1], branch, prefix, tokenEnv }
          : {
              id,
              name,
              kind,
              service,
              endpoint,
              bucket,
              region,
              prefix,
              accessKeyEnv,
              secretKeyEnv,
              sessionTokenEnv,
              privateBucketConfirmed: confirmed,
            };
      const saved = await api<BackupDestination>('backup-destinations', 'POST', {
        value,
        expected: initial,
      });
      await onSave(saved);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const refs =
    kind === 'github'
      ? [tokenEnv]
      : [accessKeyEnv, secretKeyEnv, ...(sessionTokenEnv ? [sessionTokenEnv] : [])];
  return (
    <Modal
      title={t(initial ? 'Edit backup destination' : 'Add backup destination')}
      subtitle={t('Saving a connection sends no library data.')}
      onClose={() => discard(onClose)}
      closeDisabled={busy}
      wide
      className="backup-editor"
    >
      <form
        className="backup-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="backup-form-main">
          <label>
            {t('Connection name')}
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('My private library backup')}
            />
          </label>
          <label htmlFor="backup-destination-kind">
            {t('Backup destination')}
            <Select
              id="backup-destination-kind"
              label={t('Backup destination')}
              disabled={!!initial || busy}
              value={kind}
              onValueChange={(value) => setKind(value as 'github' | 's3')}
              options={[
                { value: 'github', label: 'GitHub' },
                { value: 's3', label: 'S3 / Cloudflare R2 / MinIO' },
              ]}
            />
          </label>
          {kind === 'github' ? (
            <>
              <label>
                {t('Private GitHub repository')}
                <input
                  required
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  placeholder="owner/private-library"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className="muted">
                {t(
                  'Use an existing private repository with an initialized branch. Sync creates one commit and PR; merge is separate.',
                )}
              </p>
            </>
          ) : (
            <>
              <label htmlFor="backup-storage-provider">
                {t('Storage Provider')}
                <Select
                  id="backup-storage-provider"
                  label={t('Storage Provider')}
                  value={service}
                  onValueChange={(value) => {
                    setService(value as typeof service);
                    setRegion(value === 'r2' ? 'auto' : 'us-east-1');
                  }}
                  options={[
                    { value: 'r2', label: 'Cloudflare R2' },
                    { value: 's3', label: 'Amazon S3' },
                    { value: 'minio', label: 'MinIO' },
                    { value: 'custom', label: t('Other S3-compatible service') },
                  ]}
                />
              </label>
              <label>
                {t('S3 endpoint')}
                <input
                  required
                  type="url"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={
                    service === 'r2'
                      ? 'https://ACCOUNT_ID.r2.cloudflarestorage.com'
                      : service === 'minio'
                        ? 'http://127.0.0.1:9000'
                        : 'https://s3.us-east-1.amazonaws.com'
                  }
                  spellCheck={false}
                />
              </label>
              <div className="form-two-columns">
                <label>
                  {t('Bucket')}
                  <input
                    required
                    value={bucket}
                    onChange={(event) => setBucket(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t('Region')}
                  <input
                    required
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {t('I confirmed this bucket is private and public access is disabled.')}
                </span>
              </label>
            </>
          )}
          <details>
            <summary>{t('Advanced connection settings')}</summary>
            <div className="backup-advanced">
              <label>
                {t('Backup prefix')}
                <input
                  required
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  spellCheck={false}
                />
              </label>
              {kind === 'github' ? (
                <>
                  <label>
                    {t('Target branch')}
                    <input
                      required
                      value={branch}
                      onChange={(event) => setBranch(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {t('Token environment variable')}
                    <input
                      required
                      value={tokenEnv}
                      onChange={(event) => setTokenEnv(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {t('Access key environment variable')}
                    <input
                      required
                      value={accessKeyEnv}
                      onChange={(event) => setAccessKeyEnv(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {t('Secret key environment variable')}
                    <input
                      required
                      value={secretKeyEnv}
                      onChange={(event) => setSecretKeyEnv(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {t('Session token environment variable (optional)')}
                    <input
                      value={sessionTokenEnv}
                      onChange={(event) => setSessionTokenEnv(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                </>
              )}
            </div>
          </details>
        </div>
        <aside className="backup-credential-help">
          <h3>{t('Connect from your terminal')}</h3>
          <p>
            {t(
              'Credentials stay in the server environment. They are never stored in this form or exported.',
            )}
          </p>
          <p>{t('Set these variables before starting Rigshelf, then restart the server:')}</p>
          {refs.map((reference) => (
            <code key={reference} translate="no">
              {reference}
            </code>
          ))}
          <CopyButton label={t('Copy variable names')} text={refs.join('\n')} />
          <p>
            {kind === 'github'
              ? t(
                  'Use a fine-grained GitHub token limited to this repository, with Contents and Pull requests read/write. Repository rules still apply.',
                )
              : t(
                  'Use a bucket-scoped key with object read/write/delete. Test connection checks conditional writes with a temporary object.',
                )}
          </p>
          <Notice>
            {t(
              'Archives contain your private library. Keep the repository or bucket private. Credentials and project permissions are excluded; exports are not encrypted by Rigshelf.',
            )}
          </Notice>
        </aside>
        {error && (
          <p role="alert" className="backup-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={() => discard(onClose)}>
            {t('Cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : t('Save connection')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
