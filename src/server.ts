import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAiDrafts } from './core/ai-assistance';
import { compareArchive, exportArchive, importArchive } from './core/archive';
import { Automation } from './core/automation';
import { closeBackupJobs } from './core/backup-jobs';
import type { BackupTransportFactory } from './core/backup-transport';
import { DefinitionConflict } from './core/definitions';
import { inside } from './core/safety';
import { inventoryScan } from './core/scan-lifecycle';
import { route } from './core/service';
import type { Store } from './core/store';
import type { AiDriver } from './platform/ai-runner';
import { devBuild } from './platform/dev-build';
import { createDirectoryPicker, type DirectoryPickerDriver } from './platform/folder-picker';

export type WorkbenchServer = Bun.Server<undefined> & { accessUrl: string };
async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 32 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('JSON request exceeds 32 MiB. Use a compressed archive for library imports.');
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function startServer(
  store: Store,
  port = 47471,
  options: {
    chooseDirectory?: DirectoryPickerDriver;
    aiDriver?: AiDriver;
    resetAccess?: boolean;
    backupTransport?: BackupTransportFactory;
  } = {},
): WorkbenchServer {
  let token = '';
  const root = resolve(
    fileURLToPath(new URL(Bun.isStandaloneExecutable ? './dist' : '../dist', import.meta.url)),
  );
  const base = `http://127.0.0.1:${port}`;
  const directoryPicker = createDirectoryPicker(options.chooseDirectory);
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const activeRequests = new Set<Promise<Response>>();
  let closing = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: 128 * 1024 * 1024,
    idleTimeout: 60,
    fetch(request) {
      if (closing)
        return Response.json(
          { error: 'The workbench is shutting down. Reopen it before continuing.' },
          { status: 503, headers },
        );
      const pending = handleRequest(request);
      activeRequests.add(pending);
      return pending.finally(() => activeRequests.delete(pending));
    },
    error() {
      return Response.json(
        { error: 'The workbench could not complete this request. Reopen it and try again.' },
        { status: 500, headers },
      );
    },
  });
  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return new Response('Invalid host', { status: 403, headers });
    const origin = request.headers.get('origin');
    if (origin && origin !== base && origin !== `http://localhost:${port}`)
      return new Response('Origin denied', { status: 403, headers });
    if (url.pathname.startsWith('/api/')) {
      if (request.headers.get('x-kitfold-token') !== token)
        return Response.json(
          {
            error:
              'Open the private access URL printed by rigshelf ui. The access key is required for this workbench.',
          },
          { status: 403, headers },
        );
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
        return new Response('Method denied', { status: 405, headers });
      if (url.pathname === '/api/pick-directory' && request.method !== 'POST')
        return new Response('Method denied', { status: 405, headers });
      if (url.pathname === '/api/library-export' && request.method === 'GET') {
        try {
          const expected = url.searchParams.get('expected') || undefined;
          if (expected && !/^[a-f0-9]{64}$/.test(expected))
            throw new Error('Invalid backup review fingerprint.');
          const archive = exportArchive(store, expected);
          return new Response(new Uint8Array(archive.bytes).buffer, {
            headers: {
              ...headers,
              'Content-Type': 'application/gzip',
              'Content-Disposition': 'attachment; filename="rigshelf-library.json.gz"',
              'X-Kitfold-Excluded': String(archive.excluded),
            },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Export failed' },
            { status: 400, headers },
          );
        }
      }
      if (
        url.pathname === '/api/backup-review' &&
        request.method === 'POST' &&
        request.headers.get('content-type') === 'application/gzip'
      ) {
        try {
          return Response.json(compareArchive(store, new Uint8Array(await request.arrayBuffer())), {
            headers,
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Backup comparison failed' },
            { status: 400, headers },
          );
        }
      }
      if (url.pathname === '/api/library-import' && request.method === 'POST') {
        if (request.headers.get('content-type') !== 'application/gzip')
          return new Response('Gzip required', { status: 415, headers });
        try {
          return Response.json(
            importArchive(
              store,
              new Uint8Array(await request.arrayBuffer()),
              url.searchParams.get('apply') === '1',
            ),
            { headers },
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Import failed' },
            { status: 400, headers },
          );
        }
      }
      const hasBody =
        ['POST', 'PUT', 'PATCH'].includes(request.method) ||
        (request.method === 'DELETE' && request.body !== null);
      if (hasBody && !request.headers.get('content-type')?.startsWith('application/json'))
        return new Response('JSON required', { status: 415, headers });
      try {
        const input: unknown = hasBody ? await readJson(request) : undefined;
        if (url.pathname === '/api/pick-directory') server.timeout(request, 0);
        const result =
          url.pathname === '/api/dev-build' && request.method === 'GET'
            ? await devBuild(root)
            : url.pathname === '/api/pick-directory'
              ? await directoryPicker.pick(input, request.signal)
              : await route(store, request.method, url.pathname.slice(5), input, {
                  aiDriver: options.aiDriver,
                  signal: request.signal,
                  backupTransport: options.backupTransport,
                });
        if (url.pathname.startsWith('/api/automation/')) await automation.sync();
        return Response.json(result ?? { error: 'Not found' }, {
          status: result === undefined ? 404 : 200,
          headers,
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Operation failed' },
          { status: error instanceof DefinitionConflict ? 409 : 400, headers },
        );
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method denied', { status: 405, headers });
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Invalid path encoding', { status: 400, headers });
    }
    const path = resolve(root, `.${decodedPath}`);
    if (!inside(root, path)) return new Response('Not found', { status: 404, headers });
    if (path !== root && (await Bun.file(path).exists()))
      return new Response(Bun.file(path), { headers });
    const index = Bun.file(join(root, 'index.html'));
    if (!(await index.exists()))
      return new Response('Build the web UI with bun run build, then restart.', {
        status: 503,
        headers,
      });
    const html = await index.text();
    return new Response(html, {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  try {
    token = store.db.transaction(() => {
      const saved = store.get<{ id: string; token: string }>('local-ui-access', 'main');
      if (!options.resetAccess && saved && /^[a-f0-9]{64}$/.test(saved.token)) return saved.token;
      const next = randomBytes(32).toString('hex');
      store.put('local-ui-access', { id: 'main', token: next });
      return next;
    })();
  } catch (error) {
    void server.stop(true);
    throw error;
  }
  const automation = new Automation(store);
  const stop = server.stop.bind(server);
  void automation
    .sync()
    .catch((error) =>
      store.event('automation.failed', error instanceof Error ? error.message : 'Startup failed'),
    );
  server.stop = async (closeActiveConnections?: boolean) => {
    closing = true;
    const stopped = stop(closeActiveConnections);
    const settled = await Promise.allSettled([
      stopped,
      closeAiDrafts(store),
      closeBackupJobs(store),
      directoryPicker.close(),
      inventoryScan(store).close(),
      automation.stop(),
      ...activeRequests,
    ]);
    const failures = settled
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (failures.length)
      throw new AggregateError(
        failures,
        'Could not settle all workbench operations during shutdown.',
      );
  };
  return Object.assign(server, { accessUrl: `${base}/#access=${token}` });
}
