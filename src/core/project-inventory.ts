import type { Project } from './model';
import type { Store } from './store';

/** Fast manifest detection is not a full AI scan and cannot replace its richer private index. */
export function preserveProjectInventory(store: Store, detected: Project): Project {
  const previous = store.get<Project>('project', detected.id);
  if (!previous || previous.path !== detected.path) return detected;
  return {
    ...previous,
    ...detected,
    documents: [...new Set([...previous.documents, ...detected.documents])],
    documentLocations: detected.documentLocations ?? previous.documentLocations,
    aiFileLocations: detected.aiFileLocations ?? previous.aiFileLocations,
    inventoryWarnings: detected.inventoryWarnings ?? previous.inventoryWarnings,
  };
}
