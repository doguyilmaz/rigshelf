import type { BackupFetch } from '../../src/core/backup-network';
import { hash } from '../../src/core/safety';

/** An isolated protocol fixture; it never opens a network connection. */
export class MemoryS3 {
  objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  requests: { method: string; path: string; headers: Headers }[] = [];
  enforceConditions = true;
  rejectProbeDeletion = false;
  loseNextCurrentResponse = false;
  beforePut?: (path: string) => Promise<void>;
  fetch: BackupFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method || 'GET';
      const path = url.pathname;
      const headers = new Headers(init?.headers);
      init?.signal?.throwIfAborted();
      this.requests.push({ method, path, headers });
      if (method === 'PUT') await this.beforePut?.(path);
      init?.signal?.throwIfAborted();
      const current = this.objects.get(path);
      if (method === 'GET')
        return current
          ? new Response(new Uint8Array(current.bytes), { headers: { etag: current.etag } })
          : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      if (method === 'DELETE') {
        if (this.rejectProbeDeletion && path.includes('/.probe/'))
          return new Response(null, { status: 403 });
        this.objects.delete(path);
        return new Response(null, { status: 204 });
      }
      if (method !== 'PUT') return new Response(null, { status: 405 });
      if (
        this.enforceConditions &&
        ((headers.get('if-none-match') === '*' && current) ||
          (headers.has('if-match') && headers.get('if-match') !== current?.etag))
      )
        return new Response(null, { status: 412 });
      const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
      const etag = `"${hash(bytes)}"`;
      this.objects.set(path, { bytes, etag });
      if (path.endsWith('/current.json') && this.loseNextCurrentResponse) {
        this.loseNextCurrentResponse = false;
        throw new Error('fixture lost acknowledgement');
      }
      return new Response(null, { status: 200, headers: { etag } });
    },
    { preconnect: fetch.preconnect },
  );
}
