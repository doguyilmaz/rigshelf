import { scan } from './scanner';
import type { Store } from './store';

/** Owns a background inventory job until its writes and failure receipt settle. */
export class InventoryScan {
  private pending?: Promise<void>;
  private closed = false;
  constructor(
    private store: Store,
    private runScan: () => Promise<unknown> = () => scan(store),
  ) {}

  start(): void {
    if (this.closed) throw new Error('The workbench is shutting down. Reopen it before scanning.');
    if (this.pending) throw new Error('A scan is already running.');
    const pending = Promise.resolve().then(async () => {
      try {
        await this.runScan();
      } catch (error) {
        this.store.event('scan.failed', error instanceof Error ? error.message : 'Scan failed');
      }
    });
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      })
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending;
  }
}

const jobs = new WeakMap<Store, InventoryScan>();
export function inventoryScan(store: Store): InventoryScan {
  let owned = jobs.get(store);
  if (!owned) {
    owned = new InventoryScan(store);
    jobs.set(store, owned);
  }
  return owned;
}
