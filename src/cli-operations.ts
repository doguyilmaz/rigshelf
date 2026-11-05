import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportArchive, importArchive } from './core/archive';
import { exportLibrary, importLibrary } from './core/backup';
import { readLocalBytes } from './core/local-files';
import type { Provider } from './core/model';
import { planView } from './core/plan-view';
import { createPlan, executePlan } from './core/planner';
import { route } from './core/service';
import type { Store } from './core/store';

export async function setupProject(
  store: Store,
  path: string,
  options: {
    providers: Provider[];
    entries?: string;
    presetId?: string;
    requirements?: string;
    reviewed?: boolean;
    replaceExisting?: boolean;
    apply?: boolean;
  },
) {
  const detected = (await route(store, 'POST', 'detect', {
    projectPath: path,
    requirements: options.requirements || '',
    presetId: options.presetId,
  })) as {
    presetId: string;
    recommendations: { entry: { id: string }; selected: boolean }[];
    missing: string[];
  };
  const plan = await createPlan(store, {
    projectPath: path,
    providers: options.providers,
    presetId: detected.presetId,
    requirements: options.requirements || '',
    entryIds:
      options.entries === undefined
        ? detected.recommendations.filter((value) => value.selected).map((value) => value.entry.id)
        : options.entries.split(',').filter(Boolean),
    includeRules: true,
    allowReviewed: options.reviewed,
    replaceExisting: options.replaceExisting,
  });
  return {
    ...planView(options.apply ? await executePlan(store, plan.id, 'apply') : plan),
    missing: detected.missing,
  };
}
export async function writeExport(store: Store, destination: string) {
  const path = resolve(destination);
  const bundle = exportLibrary(store);
  const bytes = path.endsWith('.gz')
    ? exportArchive(store).bytes
    : Buffer.from(JSON.stringify(bundle, null, 2));
  // Do not follow a linked output or overwrite a previous private backup.
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  return { exported: path, bytes: bytes.length, excluded: bundle.excluded };
}
export async function readImport(store: Store, source: string, apply = false) {
  const bytes = await readLocalBytes(source, (source.endsWith('.gz') ? 128 : 512) * 1024 * 1024);
  return source.endsWith('.gz')
    ? importArchive(store, bytes, apply)
    : importLibrary(store, JSON.parse(bytes.toString('utf8')), apply);
}
