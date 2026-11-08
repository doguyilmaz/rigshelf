import type { MachineGroup, MachineInventory, MachineItem } from './machine-inventory';

export const syncStatuses = ['same', 'different', 'missing-remote', 'missing-local'] as const;
export type SyncStatus = (typeof syncStatuses)[number];
export type SyncAction = 'none' | 'copy' | 'review' | 'remap' | 'set-up-manually';
export interface SyncRow {
  key: string;
  group: MachineGroup;
  harness: string;
  status: SyncStatus;
  action: SyncAction;
}
export type GroupCounts = Partial<Record<MachineGroup, Record<SyncStatus, number>>>;
export interface SyncSection {
  rows: SyncRow[];
  groups: GroupCounts;
}
export interface ProjectSync extends SyncSection {
  repository: string | null;
  local: string | null;
  remote: string | null;
  matchedBy: 'repository' | 'name' | null;
}
export interface SyncReport {
  global: SyncSection;
  projects: ProjectSync[];
}

function action(item: MachineItem, status: SyncStatus): SyncAction {
  if (status === 'same') return 'none';
  if (item.privacy === 'private') return 'set-up-manually';
  if (item.privacy === 'machine-specific') return 'remap';
  return status === 'different' ? 'review' : 'copy';
}

function section(local: MachineItem[], remote: MachineItem[]): SyncSection {
  const remaining = new Map(remote.map((item) => [item.key, item]));
  const rows: SyncRow[] = [];
  const add = (item: MachineItem, status: SyncStatus) =>
    rows.push({
      key: item.key,
      group: item.group,
      harness: item.harness,
      status,
      action: action(item, status),
    });
  for (const item of local) {
    const other = remaining.get(item.key);
    remaining.delete(item.key);
    add(item, !other ? 'missing-remote' : other.digest === item.digest ? 'same' : 'different');
  }
  for (const item of remaining.values()) add(item, 'missing-local');
  const groups: GroupCounts = {};
  for (const row of rows) {
    groups[row.group] ??= { same: 0, different: 0, 'missing-remote': 0, 'missing-local': 0 };
    groups[row.group]![row.status]++;
  }
  return { rows, groups };
}

/** Projects match by repository; only projects without a repository on both sides fall back to the folder name. */
export function compareInventories(local: MachineInventory, remote: MachineInventory): SyncReport {
  const unmatched = new Set(remote.projects);
  const projects: ProjectSync[] = [];
  for (const project of local.projects) {
    const byRepository = project.repository
      ? remote.projects.find((other) => other.repository === project.repository)
      : undefined;
    const byName = project.repository
      ? undefined
      : remote.projects.find((other) => !other.repository && other.name === project.name);
    const match = byRepository || byName;
    if (match) unmatched.delete(match);
    projects.push({
      repository: project.repository,
      local: project.name,
      remote: match?.name ?? null,
      matchedBy: byRepository ? 'repository' : byName ? 'name' : null,
      ...section(project.items, match?.items ?? []),
    });
  }
  for (const project of unmatched)
    projects.push({
      repository: project.repository,
      local: null,
      remote: project.name,
      matchedBy: null,
      ...section([], project.items),
    });
  return { global: section(local.global, remote.global), projects };
}
