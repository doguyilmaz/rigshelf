import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { hash, now } from './safety';
import type { Store } from './store';

interface Baseline {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  projects: number;
  installations: number;
  digest: string;
  payload: string;
}
const MAX_BASELINE_BYTES = 128 * 1024 * 1024;
export function captureInventoryBaseline(store: Store): string {
  return store.db.transaction(() => {
    const projects = store.projects();
    const installations = store.installations();
    const content = Buffer.from(
      JSON.stringify({
        projects,
        installations,
        globalAiFiles: store.get('global-ai-inventory', 'main'),
      }),
    );
    if (content.length > MAX_BASELINE_BYTES)
      throw new Error('Inventory history limit reached; scan did not start.');
    const baseline: Baseline = {
      id: randomUUID(),
      schemaVersion: 1,
      createdAt: now(),
      projects: projects.length,
      installations: installations.length,
      digest: hash(content),
      payload: gzipSync(content).toString('base64'),
    };
    store.put('scan-baseline', baseline);
    return baseline.id;
  })();
}

export function inventoryHistory(store: Store) {
  return store.db
    .query(
      "SELECT id, json_extract(data,'$.createdAt') AS createdAt, json_extract(data,'$.projects') AS projects, json_extract(data,'$.installations') AS installations FROM records WHERE type='scan-baseline' ORDER BY json_extract(data,'$.createdAt') DESC LIMIT 50",
    )
    .all();
}

export function readInventoryBaseline(store: Store, id: string): unknown {
  const record = store.get<Baseline>('scan-baseline', id);
  if (record?.schemaVersion !== 1 || record.payload.length > MAX_BASELINE_BYTES)
    throw new Error('Inventory baseline not found or invalid.');
  const content = gunzipSync(Buffer.from(record.payload, 'base64'), {
    maxOutputLength: MAX_BASELINE_BYTES,
  });
  if (hash(content) !== record.digest)
    throw new Error('Inventory baseline integrity check failed.');
  return {
    id: record.id,
    schemaVersion: 1,
    createdAt: record.createdAt,
    inventory: JSON.parse(content.toString('utf8')) as unknown,
  };
}
