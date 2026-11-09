import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { AiRequestSchema } from '../src/core/ai-drafts';
import { route } from '../src/core/service';
import { runAi } from '../src/platform/ai-runner';
import { getOllamaModels } from '../src/platform/ollama-models';
import { fixture } from './helpers';

afterEach(() => mock.restore());
test('local generation and document-review requests refuse redirects before forwarding their private prompts', async () => {
  const data = await fixture();
  let forwarded = 0;
  let received = 0;
  const destination = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      forwarded++;
      return Response.json({ response: 'Unexpected forwarding.' });
    },
  });
  const origin = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const input = (await request.json()) as { prompt: string };
      expect(input.prompt).toContain('Private fixture note.');
      received++;
      return new Response(null, { status: 307, headers: { location: destination.url.toString() } });
    },
  });
  const actualFetch = globalThis.fetch;
  mockFetch(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    return actualFetch(new URL('api/generate', origin.url), init);
  });
  try {
    await expect(
      runAi({
        request: AiRequestSchema.parse({
          task: 'rule',
          intent: 'format',
          text: 'Private fixture note.',
          runner: 'ollama',
          model: 'fixture',
        }),
        prompt: 'Private fixture note.',
        directory: data.store.directory,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    data.store.put('settings', {
      id: 'main',
      ...data.store.settings(),
      aiRunner: 'ollama',
      ollamaModel: 'fixture',
    });
    await expect(
      route(data.store, 'POST', 'ai-review', { text: 'Private fixture note.', task: 'rule' }),
    ).rejects.toThrow();
    expect(received).toBe(2);
    expect(forwarded).toBe(0);
    expect(data.store.list('ai-draft')).toEqual([]);
    expect(data.store.entries()).toEqual([]);
  } finally {
    await origin.stop(true);
    await destination.stop(true);
    await data.cleanup();
  }
});
test('the shared model-list operation returns metadata without creating drafts, catalog content, plans or approval', async () => {
  const data = await fixture();
  try {
    let requests = 0;
    mockFetch(async () => {
      requests++;
      return Response.json({ models: [{ name: 'local:latest', size: 123 }] });
    });
    expect(await route(data.store, 'GET', 'ai/ollama-models', undefined)).toEqual([
      { name: 'local:latest', sizeBytes: 123, isRemote: false },
    ]);
    await expect(route(data.store, 'POST', 'ai/ollama-models', {})).rejects.toThrow(
      'Unknown AI operation',
    );
    expect(requests).toBe(1);
    for (const kind of ['ai-draft', 'plan', 'approval', 'trust'])
      expect(data.store.list(kind)).toEqual([]);
    expect(data.store.entries()).toEqual([]);
  } finally {
    await data.cleanup();
  }
});
function mockFetch(implementation: (url: string, init?: RequestInit) => Promise<Response>) {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        implementation(String(input), init),
      { preconnect: fetch.preconnect },
    ),
  );
}

test('model discovery reads only loopback metadata, preserves exact model names and reports remote routing without exposing its host', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  mockFetch(async (url, init) => {
    requests.push({ url, init });
    return Response.json({
      models: [
        { name: 'local:latest', size: 123 },
        {
          name: 'remote:cloud',
          remote_host: 'https://example.invalid/private-route',
          remote_model: 'remote',
          size: 1,
        },
        { name: 'local:latest', remote_model: 'remote-alias', size: 100 },
      ],
    });
  });
  const result = await getOllamaModels();
  expect(result).toEqual([
    { name: 'local:latest', sizeBytes: 123, isRemote: true },
    { name: 'remote:cloud', sizeBytes: 1, isRemote: true },
  ]);
  expect(JSON.stringify(result)).not.toContain('private-route');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
  expect(requests[0]?.init?.redirect).toBe('error');
  expect(new Headers(requests[0]?.init?.headers).get('Authorization')).toBeNull();
  expect(requests[0]?.init?.body).toBeUndefined();
});

test('invalid and oversized model metadata fail without turning service content into an error or an editable catalog record', async () => {
  for (const response of [
    new Response('private service detail', { status: 500 }),
    new Response('private parser detail'),
    Response.json({ models: [{ name: 'invalid\nmodel' }] }),
    Response.json({ models: [{ name: ' local:latest' }] }),
    Response.json({ models: [{ name: 'model', size: -1 }] }),
    new Response('x'.repeat(1024 * 1024 + 1)),
  ]) {
    mockFetch(async () => response);
    try {
      await getOllamaModels();
      throw new Error('Expected refusal');
    } catch (error) {
      expect((error as Error).message).not.toContain('private');
      expect((error as Error).message).toMatch(/Ollama/);
    }
    mock.restore();
  }
});

test('closing model discovery aborts its one request and an already canceled caller sends nothing', async () => {
  let requests = 0;
  mockFetch(async (_url, init) => {
    requests++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('fixture aborted')), {
        once: true,
      });
    });
  });
  const controller = new AbortController();
  const pending = getOllamaModels({ signal: controller.signal });
  controller.abort(new Error('Caller closed'));
  await expect(pending).rejects.toThrow('Caller closed');
  expect(requests).toBe(1);
  await expect(getOllamaModels({ signal: controller.signal })).rejects.toThrow('Caller closed');
  expect(requests).toBe(1);
});
