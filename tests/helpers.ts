import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCustomSkill } from '../src/core/ingest';
import { seed } from '../src/core/seeds';
import { Store } from '../src/core/store';

export async function fixture(): Promise<{
  root: string;
  project: string;
  home: string;
  store: Store;
  cleanup: () => Promise<void>;
}> {
  const parent = resolve('.local/tests');
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(join(parent, 'case-')));
  const project = join(root, 'project');
  const home = join(root, 'home');
  await mkdir(project);
  await mkdir(home);
  const store = new Store(join(root, 'data'));
  seed(store);
  // Tests opt into capabilities explicitly; retain only the reusable source/preset/rule defaults.
  for (const entry of store.entries(true)) store.deleteEntry(entry.id);
  return {
    root,
    project,
    home,
    store,
    cleanup: async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
export function sampleSkill(store: Store, name = 'project-guide') {
  return createCustomSkill(store, {
    name,
    description: `Use ${name} for a focused project workflow.`,
    body: 'Use clear inputs and return a useful result.',
    tags: ['typescript'],
  });
}
