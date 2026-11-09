import { exportLibrary } from './backup';
import { hash } from './safety';
import type { Store } from './store';

type LibraryBundle = ReturnType<typeof exportLibrary>;
interface ComparableBundle {
  entries: { entry: { id: string; name: string; kind: string }; files: unknown[] }[];
  sources: { id: string; name: string }[];
  presets: { id: string; name: string }[];
  rules: { id: string; name: string }[];
}
interface BackupRecord {
  id: string;
  kind: string;
  name: string;
  digest: string;
}
export interface BackupReview {
  fingerprint: string;
  compared: boolean;
  changes: { id: string; kind: string; name: string; action: 'added' | 'changed' | 'removed' }[];
  counts: { added: number; changed: number; removed: number; unchanged: number };
  excluded: LibraryBundle['excluded'];
}
export function canonicalBackup(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('Backup record nesting exceeds 32 levels.');
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalBackup(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalBackup(item, depth + 1)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function backupRecords(bundle: ComparableBundle): BackupRecord[] {
  const record = (
    kind: string,
    value: { id: string; name: string },
    content: unknown,
  ): BackupRecord => ({
    id: `${kind}:${value.id}`,
    kind,
    name: value.name,
    digest: hash(canonicalBackup(content)),
  });
  return [
    ...bundle.entries.map((value) => record(value.entry.kind, value.entry, value)),
    ...bundle.sources.map((value) => record('source', value, value)),
    ...bundle.presets.map((value) => record('preset', value, value)),
    ...bundle.rules.map((value) => record('directive', value, value)),
  ].sort((left, right) => left.id.localeCompare(right.id));
}
export function backupFingerprint(
  bundle: ComparableBundle & Pick<LibraryBundle, 'excluded'>,
): string {
  return hash(canonicalBackup({ records: backupRecords(bundle), excluded: bundle.excluded }));
}
export function compareBackup(bundle: LibraryBundle, baseline?: ComparableBundle): BackupReview {
  return compareBackupRecords(
    backupRecords(bundle),
    baseline ? backupRecords(baseline) : undefined,
    bundle.excluded,
  );
}
export function compareBackupRecords(
  current: BackupRecord[],
  baseline: BackupRecord[] | undefined,
  excluded: LibraryBundle['excluded'],
): BackupReview {
  const previous = new Map((baseline || []).map((record) => [record.id, record]));
  const changes: BackupReview['changes'] = [];
  const counts = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  for (const record of current) {
    const before = previous.get(record.id);
    const action = !before ? 'added' : before.digest === record.digest ? 'unchanged' : 'changed';
    counts[action]++;
    if (action !== 'unchanged')
      changes.push({ id: record.id, kind: record.kind, name: record.name, action });
    previous.delete(record.id);
  }
  for (const record of previous.values()) {
    counts.removed++;
    changes.push({ id: record.id, kind: record.kind, name: record.name, action: 'removed' });
  }
  return {
    fingerprint: hash(canonicalBackup({ records: current, excluded })),
    compared: !!baseline,
    changes,
    counts,
    excluded,
  };
}
export function reviewBackup(store: Store): BackupReview {
  return compareBackup(exportLibrary(store));
}
