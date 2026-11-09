import type { MachineGroup, MachineInventory, MachineItem } from './machine-inventory';
import { skillRoots, syncsGlobalItem } from './machine-scope';

export const syncStatuses = ['same', 'different', 'missing-remote', 'missing-local'] as const;
export type SyncStatus = (typeof syncStatuses)[number];
type SyncAction = 'none' | 'copy' | 'review' | 'remap' | 'set-up-manually';
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
  /** Agents with Skills here that are not installed there; their folders are not compared or synced. */
  otherAgents?: string[];
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

function counted(rows: SyncRow[], otherAgents?: string[]): SyncSection {
  const groups: GroupCounts = {};
  for (const row of rows) {
    groups[row.group] ??= { same: 0, different: 0, 'missing-remote': 0, 'missing-local': 0 };
    groups[row.group]![row.status]++;
  }
  return { rows, groups, ...(otherAgents?.length ? { otherAgents } : {}) };
}

function itemRows(local: MachineItem[], remote: MachineItem[]): SyncRow[] {
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
  return rows;
}

const skillName = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const skillRoot = (key: string) => key.slice(0, key.lastIndexOf('/skills/'));
const privacyRank = ['portable', 'machine-specific', 'private'];

/** One row per global Skill name across the folders that sync fills, the way the user thinks of a Skill. */
function skillRows(local: MachineItem[], remote: MachineItem[], installed?: string[]) {
  const roots = new Set<string>(skillRoots(installed));
  const relevant = (item: MachineItem) => roots.has(skillRoot(item.key));
  const otherAgents = [
    ...new Set(local.filter((item) => !relevant(item)).map((item) => item.harness)),
  ].sort();
  const remoteByKey = new Map(remote.filter(relevant).map((item) => [item.key, item]));
  const names = new Map<string, MachineItem[]>();
  for (const item of local.filter(relevant))
    names.set(skillName(item.key), [...(names.get(skillName(item.key)) ?? []), item]);
  const rows: SyncRow[] = [];
  for (const [name, items] of names) {
    const others = items.map((item) => remoteByKey.get(item.key));
    const status: SyncStatus = others.some(
      (other, index) => other && other.digest !== items[index]!.digest,
    )
      ? 'different'
      : others.every(Boolean)
        ? 'same'
        : 'missing-remote';
    const worst = items.reduce((left, right) =>
      privacyRank.indexOf(right.privacy) > privacyRank.indexOf(left.privacy) ? right : left,
    );
    rows.push({
      key: `skills/${name}`,
      group: 'skill',
      harness: items.map((item) => item.harness).join(', '),
      status,
      action: action(worst, status),
    });
  }
  const remoteOnly = new Map<string, MachineItem[]>();
  for (const item of remoteByKey.values())
    if (!names.has(skillName(item.key)))
      remoteOnly.set(skillName(item.key), [...(remoteOnly.get(skillName(item.key)) ?? []), item]);
  for (const [name, items] of remoteOnly)
    rows.push({
      key: `skills/${name}`,
      group: 'skill',
      harness: items.map((item) => item.harness).join(', '),
      status: 'missing-local',
      action: action(items[0]!, 'missing-local'),
    });
  return { rows, otherAgents };
}

function section(local: MachineItem[], remote: MachineItem[]): SyncSection {
  return counted(itemRows(local, remote));
}

const knownAgents = new Set(['claude', 'codex', 'kiro', 'gemini', 'opencode', 'grok']);

/** Files of agents not installed there are named once, and files sync does not copy are marked for setup by hand. */
function globalSection(local: MachineItem[], remote: MachineItem[], installed?: string[]) {
  const isSkill = (item: MachineItem) => item.group === 'skill';
  const absent = (item: MachineItem) =>
    Boolean(installed) && knownAgents.has(item.harness) && !installed!.includes(item.harness);
  const kept = (item: MachineItem) => !isSkill(item) && !absent(item);
  const skills = skillRows(local.filter(isSkill), remote.filter(isSkill), installed);
  const files = itemRows(local.filter(kept), remote.filter(kept)).map((row) =>
    row.status !== 'same' && !syncsGlobalItem(row.key, row.group)
      ? { ...row, action: 'set-up-manually' as const }
      : row,
  );
  const otherAgents = [
    ...new Set([
      ...skills.otherAgents,
      ...local.filter((item) => !isSkill(item) && absent(item)).map((item) => item.harness),
    ]),
  ].sort();
  return counted([...skills.rows, ...files], otherAgents);
}

/** Projects match by repository; only projects without a repository on both sides fall back to the folder name. */
export function compareInventories(
  local: MachineInventory,
  remote: MachineInventory,
  /** Agents installed on the remote machine; unknown compares every Skill folder that sync fills. */
  remoteAgents?: string[],
): SyncReport {
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
  return { global: globalSection(local.global, remote.global, remoteAgents), projects };
}
