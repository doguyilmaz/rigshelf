import { discoverSkills } from './discovery';
import type { Project } from './model';
import { hash, now } from './safety';
import type { Store } from './store';
import { checkSource } from './upstream';
import { watchProject } from './watch';

export class Automation {
  private watchers = new Map<string, () => Promise<void>>();
  private interval: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;
  private controller = new AbortController();
  private syncing?: Promise<void>;
  private ticking?: Promise<void>;
  constructor(private store: Store) {
    this.interval = setInterval(() => {
      if (!this.busy && !this.stopped) this.ticking = this.tick();
    }, 60000);
    this.interval.unref();
  }
  async sync(): Promise<void> {
    while (this.syncing) await this.syncing;
    if (this.stopped) return;
    const pending = this.reconcile();
    this.syncing = pending;
    try {
      await pending;
    } finally {
      this.syncing = undefined;
    }
  }
  private async reconcile(): Promise<void> {
    const approved = this.store
      .list<{ id: string; enabled: boolean }>('approval')
      .filter((value) => value.enabled);
    for (const [id, close] of this.watchers)
      if (!approved.some((value) => value.id === id)) {
        await close();
        this.watchers.delete(id);
      }
    for (const approval of approved)
      if (!this.watchers.has(approval.id)) {
        const project = this.store.get<Project>('project', approval.id);
        if (!project) continue;
        try {
          const stop = await watchProject(this.store, project.path, true, this.controller.signal);
          if (
            this.stopped ||
            !this.store.get<{ enabled: boolean }>('approval', approval.id)?.enabled
          ) {
            await stop();
            continue;
          }
          this.watchers.set(approval.id, stop);
        } catch (error) {
          if (this.stopped) return;
          this.store.event(
            'automation.failed',
            `${project.name}: ${error instanceof Error ? error.message : 'Watcher failed'}`,
          );
        }
      }
  }
  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sync();
      if (this.stopped) return;
      const days = this.store.settings().discoveryDays;
      if (!days) return;
      const due = this.store
        .sources()
        .find(
          (source) =>
            source.url &&
            (!source.checkedAt ||
              Date.now() - new Date(source.checkedAt).getTime() > days * 86400000),
        );
      // One source per minute keeps checks bounded and avoids retry storms.
      if (due) await checkSource(this.store, due.id);
      if (this.stopped) return;
      for (const query of this.store.settings().discoveryQueries || []) {
        const id = `discovery-${hash(query.toLowerCase()).slice(0, 20)}`;
        const last =
          this.store.get<{ checkedAt: string }>('discovery-attempt', id) ||
          this.store.get<{ checkedAt: string }>('discovery', id);
        if (last && Date.now() - new Date(last.checkedAt).getTime() < days * 86400000) continue;
        this.store.put('discovery-attempt', { id, checkedAt: now() });
        await discoverSkills(this.store, { query });
        break;
      }
    } catch (error) {
      this.store.event(
        'discovery.failed',
        error instanceof Error ? error.message : 'Source check failed',
      );
    } finally {
      this.busy = false;
    }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.controller.abort();
    clearInterval(this.interval);
    await this.syncing;
    await this.ticking;
    await Promise.all([...this.watchers.values()].map((close) => close()));
    this.watchers.clear();
  }
}
