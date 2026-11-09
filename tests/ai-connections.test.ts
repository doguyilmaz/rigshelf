import { expect, test } from 'bun:test';
import { aiDraft, closeAiDrafts, startAiDraft } from '../src/core/ai-assistance';
import { AiConnectionSchema } from '../src/core/ai-connections';
import { exportLibrary } from '../src/core/backup';
import { SettingsSchema } from '../src/core/model';
import { runCompatibleAi } from '../src/platform/compatible-ai';
import { fixture } from './helpers';

const connection = {
  id: 'local-api',
  name: 'Local API',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'local-model',
  apiKeyEnv: '',
};
test('API credentials are resolved only for the selected server-side reference and never included in the JSON prompt', async () => {
  const variable = 'RIGSHELF_AI_UNIT_FIXTURE_TOKEN';
  const original = process.env[variable];
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      calls++;
      expect(request.headers.get('authorization')).toBe('Bearer fixture-only-value');
      expect(await request.text()).not.toContain('fixture-only-value');
      return Response.json({ choices: [{ message: { content: 'draft' }, finish_reason: 'stop' }] });
    },
  });
  const input = {
    connection: {
      ...connection,
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKeyEnv: variable,
    },
    prompt: 'Fixture request',
    model: '',
    signal: AbortSignal.timeout(1000),
  };
  try {
    delete process.env[variable];
    await expect(runCompatibleAi(input)).rejects.toThrow('environment variable');
    expect(calls).toBe(0);
    process.env[variable] = 'fixture-only-value';
    expect(await runCompatibleAi(input)).toBe('draft');
    expect(calls).toBe(1);
  } finally {
    if (original === undefined) delete process.env[variable];
    else process.env[variable] = original;
    await server.stop(true);
  }
});
test('AI profiles reject credential URLs, insecure remote transport and ambient environment references', () => {
  for (const baseUrl of [
    'http://remote.example/v1',
    'https://user:password@example.com/v1',
    'https://example.com/v1?key=secret',
    'https://example.com/v1#key',
    'https://example.com/v1#',
    'https://example.com/v1?',
    'https://169.254.169.254/v1',
  ])
    expect(AiConnectionSchema.safeParse({ ...connection, baseUrl }).success).toBe(false);
  expect(AiConnectionSchema.safeParse({ ...connection, apiKeyEnv: 'HOME' }).success).toBe(false);
  expect(
    AiConnectionSchema.safeParse({
      ...connection,
      baseUrl: 'https://api.example.com/v1',
      apiKeyEnv: 'RIGSHELF_AI_EXAMPLE_KEY',
    }).success,
  ).toBe(true);
});
test('compatible service receives only the selected prompt and model, and bounds response shape', async () => {
  let request: unknown;
  let mode: 'ready' | 'invalid' | 'truncated' = 'ready';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(input) {
      expect(new URL(input.url).pathname).toBe('/v1/chat/completions');
      expect(input.headers.get('authorization')).toBeNull();
      request = await input.json();
      return Response.json(
        mode === 'invalid'
          ? { choices: [] }
          : {
              choices: [
                {
                  message: { content: 'draft' },
                  finish_reason: mode === 'ready' ? 'stop' : 'length',
                },
              ],
            },
      );
    },
  });
  try {
    const input = {
      connection: { ...connection, baseUrl: `http://127.0.0.1:${server.port}/v1/` },
      prompt: 'Fixture request',
      model: '',
      signal: AbortSignal.timeout(1000),
    };
    expect(await runCompatibleAi(input)).toBe('draft');
    expect(request).toEqual({
      model: 'local-model',
      messages: [{ role: 'user', content: 'Fixture request' }],
      stream: false,
    });
    mode = 'invalid';
    await expect(runCompatibleAi(input)).rejects.toThrow('unsupported');
    mode = 'truncated';
    await expect(runCompatibleAi(input)).rejects.toThrow('did not finish');
  } finally {
    await server.stop(true);
  }
});
test('compatible transport refuses redirects and never returns provider error bodies', async () => {
  let forwarded = 0;
  const other = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      forwarded++;
      return Response.json({});
    },
  });
  let redirect = true;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return redirect
        ? Response.redirect(`http://127.0.0.1:${other.port}/`, 307)
        : new Response('private upstream details', { status: 401 });
    },
  });
  try {
    const input = {
      connection: { ...connection, baseUrl: `http://127.0.0.1:${server.port}/v1` },
      prompt: 'Fixture request',
      model: '',
      signal: AbortSignal.timeout(1000),
    };
    await expect(runCompatibleAi(input)).rejects.toThrow('Redirects are refused');
    expect(forwarded).toBe(0);
    redirect = false;
    await expect(runCompatibleAi(input)).rejects.toThrow('HTTP 401');
  } finally {
    await server.stop(true);
    await other.stop(true);
  }
});
test('generation resolves a saved connection once and portable exports exclude profiles', async () => {
  const data = await fixture();
  try {
    const settings = { ...data.store.settings(), aiConnections: [connection] };
    expect(
      SettingsSchema.safeParse({ ...settings, aiConnections: [connection, connection] }).success,
    ).toBe(false);
    data.store.put('settings', { id: 'main', ...settings });
    expect(JSON.stringify(exportLibrary(data.store))).not.toContain('local-api');
    const input = {
      task: 'text',
      text: 'Fixture request',
      runner: 'compatible',
      connectionId: 'missing',
    };
    expect(() => startAiDraft(data.store, input)).toThrow('saved AI connection');
    let selected: unknown;
    const job = startAiDraft(
      data.store,
      { ...input, connectionId: connection.id },
      async (value) => {
        selected = value.connection;
        return {
          summary: 'Fixture draft',
          questions: [],
          draft: { kind: 'text', text: 'A useful instruction.' },
        };
      },
    );
    data.store.put('settings', { id: 'main', ...settings, aiConnections: [] });
    for (
      let attempt = 0;
      attempt < 100 && aiDraft(data.store, job.id).state === 'running';
      attempt++
    )
      await Bun.sleep(5);
    expect(aiDraft(data.store, job.id).state).toBe('ready');
    expect(selected).toEqual(connection);
  } finally {
    await closeAiDrafts(data.store);
    await data.cleanup();
  }
});
