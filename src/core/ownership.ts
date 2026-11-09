import { stat } from 'node:fs/promises';
import type { Kit } from './kit';
import { readLocalBytes } from './local-files';
import type { Plan } from './model';
import { assertWritePath, hash } from './safety';
import type { Store } from './store';

export interface Ownership {
  id: string;
  projectPath: string;
  rootIdentity: string;
  manifestHash: string;
  kit: Kit;
}
interface ProjectApproval {
  id: string;
  enabled: boolean;
  rootIdentity?: string;
}
const MAX_KIT_MANIFEST_BYTES = 4 * 1024 * 1024;
export const projectKey = (path: string): string => `project-${hash(path).slice(0, 20)}`;

export async function rootIdentity(path: string): Promise<string | null> {
  try {
    const value = await stat(path);
    if (!value.isDirectory()) throw new Error('Project root must be a directory.');
    return `${value.dev}:${value.ino}:${value.birthtimeMs}`;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function ownedProject(store: Store, path: string): Promise<Ownership | undefined> {
  const value = store.get<Ownership>('ownership', projectKey(path));
  return value?.projectPath === path && value.rootIdentity === (await rootIdentity(path))
    ? value
    : undefined;
}

export async function approveProject(store: Store, path: string, enabled: boolean) {
  const id = projectKey(path);
  const owned = await ownedProject(store, path);
  if (enabled && !owned)
    throw new Error('Review and apply a project kit on this machine before enabling automation.');
  if (enabled && !(await matchesManifest(owned!)))
    throw new Error('The project kit changed. Review and apply a new setup plan first.');
  const value: ProjectApproval = { id, enabled, rootIdentity: owned?.rootIdentity };
  store.put('approval', value);
  return value;
}

export async function matchesManifest(owned: Ownership, nextHash?: string): Promise<boolean> {
  try {
    const path = await assertWritePath(owned.projectPath, '.rigshelf/kit.json');
    return [owned.manifestHash, nextHash].includes(
      hash(await readLocalBytes(path, MAX_KIT_MANIFEST_BYTES)),
    );
  } catch {
    return false;
  }
}

export async function assertAutomation(
  store: Store,
  owned: Ownership,
  nextHash?: string,
): Promise<void> {
  const approval = store.get<ProjectApproval>('approval', owned.id);
  const current = await ownedProject(store, owned.projectPath);
  if (
    !approval?.enabled ||
    approval.rootIdentity !== owned.rootIdentity ||
    current?.manifestHash !== owned.manifestHash ||
    !(await matchesManifest(owned, nextHash))
  )
    throw new Error('Automatic additions paused: project approval or the reviewed kit changed.');
}

export async function syncOwnership(
  store: Store,
  plan: Plan,
  direction: 'apply' | 'rollback',
): Promise<void> {
  if (plan.purpose !== 'setup') return;
  const id = projectKey(plan.projectPath);
  const identity = await rootIdentity(plan.projectPath);
  if (direction === 'rollback') {
    if (plan.ownershipBefore && plan.ownershipBefore.rootIdentity === identity)
      store.put('ownership', plan.ownershipBefore);
    else {
      store.remove('ownership', id);
      store.remove('approval', id);
    }
    return;
  }
  if (!identity || !plan.ownershipAfter || !plan.manifestHash)
    throw new Error('Setup plan has no reviewed ownership record. Create a new plan.');
  store.put('ownership', {
    id,
    projectPath: plan.projectPath,
    rootIdentity: identity,
    manifestHash: plan.manifestHash,
    kit: plan.ownershipAfter,
  } satisfies Ownership);
}
