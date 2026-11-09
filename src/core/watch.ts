import { type FSWatcher, watch } from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './detect';
import { kitDrift, readKit } from './kit';
import { assertAutomation, ownedProject } from './ownership';
import { createPlan, executePlan } from './planner';
import { preserveProjectInventory } from './project-inventory';
import { type Recommendation, recommend } from './recommend';
import { checkedProject, hash, now, slug } from './safety';
import type { Store } from './store';

const manifests = new Set([
  'package.json',
  'bun.lock',
  'bun.lockb',
  'go.mod',
  'Package.swift',
  'build.gradle',
  'build.gradle.kts',
]);
export interface ProjectSuggestion {
  id: string;
  signature: string;
  project: string;
  createdAt: string;
  additions: Recommendation[];
  autoApplied: boolean;
}
export type ProjectCheckResult = ProjectSuggestion | { unchanged: true; project: string };

export async function checkProject(
  store: Store,
  projectPath: string,
  auto = false,
  signal?: AbortSignal,
): Promise<ProjectCheckResult> {
  signal?.throwIfAborted();
  const path = await checkedProject(projectPath);
  const owned = await ownedProject(store, path);
  if (auto) {
    if (!owned)
      throw new Error('Automatic additions paused: apply a reviewed kit on this machine first.');
    await assertAutomation(store, owned);
  }
  const kit = auto ? owned?.kit : await readKit(path);
  const detected = await detectProject(path, kit?.requirements || '');
  const project = {
    ...preserveProjectInventory(store, detected),
    ...store.get<object>('project-override', detected.id),
  };
  const recommendations = recommend(store, project, kit?.presetId);
  const existingIds = new Set(kit?.entries.map((entry) => entry.id) || []);
  const existingNames = new Set(
    kit?.entries.map((entry) => slug(entry.name || store.entry(entry.id)?.name || '')) || [],
  );
  const additions = recommendations.recommendations.filter(
    (value) =>
      value.selected &&
      !existingIds.has(value.entry.id) &&
      !existingNames.has(slug(value.entry.name)),
  );
  const signature = hash(
    JSON.stringify({
      dependencies: project.dependencies.toSorted(),
      additions: additions.map((value) => [value.entry.id, store.get('trust', value.entry.id)]),
      kit: [...existingIds].sort(),
      manifest: owned?.manifestHash,
      auto,
    }),
  );
  signal?.throwIfAborted();
  const last = store.get<{ signature: string }>('suggestion', project.id);
  if (last?.signature === signature) return { unchanged: true, project: project.name };
  const result = {
    id: project.id,
    signature,
    project: project.name,
    createdAt: now(),
    additions,
    autoApplied: false,
  };
  if (auto && owned && kit && additions.length) {
    const drift = await kitDrift(path, kit);
    if (drift.length)
      throw new Error(
        `Automatic additions paused: ${drift.length} managed files changed or disappeared. Review a new setup plan first.`,
      );
    const trusted = additions.filter(
      (value) =>
        store.get<{ digest: string }>('trust', value.entry.id)?.digest === value.entry.digest &&
        !value.entry.archived &&
        !value.entry.findings.some((finding) => finding.level !== 'info'),
    );
    if (trusted.length) {
      const plan = await createPlan(store, {
        projectPath: path,
        providers: kit.providers,
        entryIds: [...existingIds, ...trusted.map((value) => value.entry.id)],
        includeRules: false,
        allowReviewed: false,
        requirements: kit.requirements || '',
        replaceExisting: false,
        presetId: kit.presetId,
      });
      const guard = async () => {
        signal?.throwIfAborted();
        await assertAutomation(store, owned, plan.manifestHash);
        for (const value of trusted) {
          const entry = store.entry(value.entry.id);
          if (
            !entry ||
            entry.archived ||
            entry.findings.some((finding) => finding.level !== 'info') ||
            store.get<{ digest: string }>('trust', entry.id)?.digest !== entry.digest
          )
            throw new Error('Automatic additions paused: snapshot approval changed.');
        }
      };
      await executePlan(store, plan.id, 'apply', guard);
      result.autoApplied = true;
    }
  }
  signal?.throwIfAborted();
  store.put('project', project);
  store.put('suggestion', result);
  store.event(
    'project.checked',
    `${project.name}: ${additions.length} suggested additions${result.autoApplied ? ', trusted additions applied' : ''}`,
  );
  return result;
}

export async function watchProject(
  store: Store,
  projectPath: string,
  auto = false,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  const path = await checkedProject(projectPath);
  const controller = new AbortController();
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let running = false,
    pending = false;
  const schedule = () => {
    if (controller.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(kick, 800);
  };
  function kick() {
    if (controller.signal.aborted) return;
    if (running) {
      pending = true;
      return;
    }
    active = run();
  }
  async function refreshWatchers() {
    const project = await detectProject(path);
    if (controller.signal.aborted) return;
    const directories = new Map<string, boolean>([[path, false]]);
    for (const workspace of (project.workspaces || []).slice(0, 64))
      directories.set(join(path, workspace.path), false);
    for (const name of ['apps', 'packages', 'services']) directories.set(join(path, name), true);
    for (const [directory, watcher] of watchers)
      if (!directories.has(directory)) {
        watcher.close();
        watchers.delete(directory);
      }
    for (const [directory, discovery] of directories) {
      if (watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, (_event, filename) => {
          if (
            discovery ||
            !filename ||
            manifests.has(String(filename)) ||
            ['apps', 'packages', 'services'].includes(String(filename))
          )
            schedule();
        });
        watcher.on('error', (error) => store.event('watch.failed', error.message));
        watchers.set(directory, watcher);
      } catch (error) {
        if (directory === path) throw error;
      }
    }
  }
  async function run(): Promise<void> {
    if (controller.signal.aborted) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await checkProject(store, path, auto, controller.signal);
      await refreshWatchers();
    } catch (error) {
      if (!controller.signal.aborted)
        store.event(
          'watch.failed',
          error instanceof Error ? error.message : 'Dependency check failed',
        );
    } finally {
      running = false;
      if (pending && !controller.signal.aborted) {
        pending = false;
        kick();
      }
    }
  }
  async function stop() {
    controller.abort();
    pending = false;
    clearTimeout(timer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    signal?.removeEventListener('abort', onAbort);
    await active;
  }
  const onAbort = () => {
    void stop();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    await checkProject(store, path, auto, controller.signal);
    await refreshWatchers();
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
