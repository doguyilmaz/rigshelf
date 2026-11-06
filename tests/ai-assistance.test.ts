import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  aiDraft,
  cancelAiDraft,
  closeAiDrafts,
  completeAiDraft,
  listAiDrafts,
  startAiDraft,
} from '../src/core/ai-assistance';
import { AiRequestSchema, parseAiProposal } from '../src/core/ai-drafts';
import { route } from '../src/core/service';
import { aiCommand, runAi } from '../src/platform/ai-runner';
import { fixture, sampleSkill } from './helpers';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const data = await fixture();
  cleanup.push(async () => {
    await closeAiDrafts(data.store);
    await data.cleanup();
  });
  return data;
}
const request = {
  task: 'rule' as const,
  intent: 'format' as const,
  text: 'Keep error messages short and actionable.',
  runner: 'claude' as const,
  model: '',
  current: '',
  language: 'en' as const,
};
const proposal = {
  summary: 'Clear project guidance.',
  questions: [],
  draft: {
    kind: 'rule' as const,
    name: 'Actionable errors',
    scope: 'backend',
    content: 'Return a concise message and a useful next step when an operation fails.',
    priority: 50,
    provenance: 'User request',
  },
};
async function finished(store: Awaited<ReturnType<typeof fixture>>['store'], id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = aiDraft(store, id);
    if (job.state !== 'running') return job;
    await Bun.sleep(5);
  }
  throw new Error('Fixture AI request did not settle.');
}
test('AI prepares a validated proposal without saving rules, snapshots, plans or approval', async () => {
  const data = await setup();
  const skill = sampleSkill(data.store);
  const rules = data.store.list('rule');
  const job = startAiDraft(data.store, request, async () => JSON.stringify(proposal));
  const result = await finished(data.store, job.id);
  expect(result.state).toBe('ready');
  expect(result.proposal?.draft).toEqual(proposal.draft);
  expect(data.store.list('rule')).toEqual(rules);
  expect(data.store.entry(skill.id)).toEqual(skill);
  expect(data.store.planSummaries()).toEqual([]);
  expect(data.store.list('approval')).toEqual([]);
  const view = await route(data.store, 'GET', `ai/drafts/${job.id}`, undefined);
  expect(view).not.toHaveProperty('prompt');
  expect(view).not.toHaveProperty('request');
});
test('canceling drains an in-flight generation and ignores its late valid proposal', async () => {
  const data = await setup();
  let aborted = false;
  const job = startAiDraft(
    data.store,
    request,
    async ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve(proposal);
          },
          { once: true },
        );
      }),
  );
  await Bun.sleep(0);
  const result = await cancelAiDraft(data.store, job.id);
  expect(aborted).toBe(true);
  expect(result.state).toBe('canceled');
  expect(result.proposal).toBeUndefined();
});
test('connected Agents may answer only waiting requests, using offered IDs, without saving a kit', async () => {
  const data = await setup();
  const skill = sampleSkill(data.store, 'expo-guide');
  const job = startAiDraft(data.store, {
    ...request,
    runner: 'session',
    task: 'requirements',
    text: 'An Expo app',
  });
  expect(() =>
    completeAiDraft(data.store, job.id, {
      summary: 'Example',
      questions: [],
      draft: { kind: 'requirements', text: 'An Expo app', entryIds: ['invented'] },
    }),
  ).toThrow('unknown library');
  expect(aiDraft(data.store, job.id).state).toBe('waiting');
  const result = completeAiDraft(data.store, job.id, {
    summary: 'Example',
    questions: [],
    draft: { kind: 'requirements', text: 'An Expo app', entryIds: [skill.id] },
  });
  expect(result.state).toBe('ready');
  expect(() => completeAiDraft(data.store, job.id, proposal)).toThrow();
  const canceled = startAiDraft(data.store, { ...request, runner: 'session' });
  await cancelAiDraft(data.store, canceled.id);
  expect(() => completeAiDraft(data.store, canceled.id, proposal)).toThrow();
  expect(data.store.installations()).toEqual([]);
  expect(data.store.planSummaries()).toEqual([]);
});

test('AI source formatting preserves the supplied focused reference and rejects an invented repository', async () => {
  const data = await setup();
  const original = 'https://skills.sh/example/skills/focused-guide';
  const job = startAiDraft(data.store, {
    ...request,
    runner: 'session',
    task: 'library',
    text: `Add this source: ${original}`,
  });
  const proposed = {
    summary: 'Source details.',
    questions: [],
    draft: {
      kind: 'source',
      name: 'Example skills',
      input: 'https://github.com/example/skills',
      recipe: '',
    },
  };
  const result = completeAiDraft(data.store, job.id, proposed);
  expect(result.proposal?.draft).toHaveProperty('input', original);
  const unknown = startAiDraft(data.store, {
    ...request,
    runner: 'session',
    task: 'library',
    text: 'I want a source but have not supplied a link.',
  });
  expect(() => completeAiDraft(data.store, unknown.id, proposed)).toThrow('did not provide');
  expect(aiDraft(data.store, unknown.id).state).toBe('waiting');
});
test('malformed output, a wrong draft type and credential-looking content never become usable proposals', async () => {
  const data = await setup();
  const job = startAiDraft(data.store, request, async () => 'not json');
  expect((await finished(data.store, job.id)).state).toBe('failed');
  expect(() => parseAiProposal(proposal, 'skill', new Set())).toThrow('different kind');
  expect(() =>
    parseAiProposal(
      {
        ...proposal,
        draft: {
          ...proposal.draft,
          content: 'Authorization: Bearer fictional-secret-value-for-tests',
        },
      },
      'rule',
      new Set(),
    ),
  ).toThrow('credential');
  expect(
    AiRequestSchema.safeParse({ ...request, model: '--dangerously-bypass-approvals-and-sandbox' })
      .success,
  ).toBe(false);
  expect(AiRequestSchema.safeParse({ ...request, execute: true }).success).toBe(false);
  const formattedJson = '{\n  "meaning": "keep this formatting"\n}';
  expect(
    parseAiProposal(
      { summary: 'Formatted JSON.', questions: [], draft: { kind: 'text', text: formattedJson } },
      'text',
      new Set(),
    ).draft,
  ).toHaveProperty('text', formattedJson);
});
test('prompts mask known credential formats and bound catalog context without collecting Skill bodies', async () => {
  const data = await setup();
  for (let index = 0; index < 90; index++) sampleSkill(data.store, `expo-example-${index}`);
  const job = startAiDraft(data.store, {
    ...request,
    runner: 'session',
    task: 'requirements',
    text: 'Expo API_TOKEN="fictional-secret-for-mask-test"',
  });
  expect(job.prompt).not.toContain('fictional-secret-for-mask-test');
  const nested = startAiDraft(data.store, {
    ...request,
    runner: 'session',
    current: JSON.stringify({
      mcp: JSON.stringify({
        env: { API_TOKEN: 'nested-fixture-private-value' },
        headers: { Authorization: 'Bearer ${KEPT_TOKEN}' },
      }),
    }),
  });
  expect(nested.prompt).not.toContain('nested-fixture-private-value');
  expect(nested.prompt).toContain('${KEPT_TOKEN}');
  expect(job.entryIds).toHaveLength(80);
  expect(job.prompt).not.toContain('Use clear inputs and return a useful result.');
  for (let index = 0; index < 28; index++)
    startAiDraft(data.store, { ...request, runner: 'session' });
  expect(listAiDrafts(data.store)).toHaveLength(24);
});
test('an interrupted old run cannot block generation indefinitely', async () => {
  const data = await setup();
  const job = startAiDraft(data.store, { ...request, runner: 'session' });
  data.store.put('ai-draft', {
    ...job,
    state: 'running',
    createdAt: new Date(Date.now() - 180000).toISOString(),
  });
  expect(aiDraft(data.store, job.id).state).toBe('failed');
  expect(startAiDraft(data.store, { ...request, runner: 'session' }).state).toBe('waiting');
  const waiting = startAiDraft(data.store, { ...request, runner: 'session' });
  data.store.put('ai-draft', {
    ...waiting,
    createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  });
  expect(aiDraft(data.store, waiting.id).state).toBe('canceled');
  expect(() => completeAiDraft(data.store, waiting.id, proposal)).toThrow();
});

test('generation concurrency is bounded and cancellation frees an owned slot', async () => {
  const data = await setup();
  const driver = async ({ signal }: { signal: AbortSignal }) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve(proposal);
        return;
      }
      signal.addEventListener('abort', () => resolve(proposal), { once: true });
    });
  const first = startAiDraft(data.store, request, driver);
  startAiDraft(data.store, request, driver);
  expect(() => startAiDraft(data.store, request, driver)).toThrow('already running');
  await cancelAiDraft(data.store, first.id);
  expect(startAiDraft(data.store, { ...request, runner: 'session' }).state).toBe('waiting');
  await closeAiDrafts(data.store);
  expect(() => startAiDraft(data.store, request, driver)).toThrow('shutting down');
});

test('CLI cancellation drains the fixture process and removes its temporary files', async () => {
  const data = await setup();
  const directory = join(data.root, 'cancel-bin');
  await mkdir(directory);
  const executable = join(directory, 'claude');
  const marker = join(data.root, 'fixture-pid');
  await Bun.write(
    executable,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)},String(process.pid));await Bun.sleep(60000);\n`,
  );
  await chmod(executable, 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath}`;
  const controller = new AbortController();
  let running: Promise<unknown> | undefined;
  try {
    expect(Bun.which('claude', { PATH: process.env.PATH })).toBe(executable);
    running = runAi({
      request: AiRequestSchema.parse(request),
      prompt: 'Fixture only.',
      directory: data.store.directory,
      signal: controller.signal,
    });
    void running.catch(() => undefined);
    const readinessDeadline = Date.now() + 2500;
    while (!(await Bun.file(marker).exists()) && Date.now() < readinessDeadline)
      await Bun.sleep(10);
    expect(await Bun.file(marker).exists()).toBe(true);
    const pid = Number(await Bun.file(marker).text());
    expect(pid).toBeGreaterThan(1);
    controller.abort();
    await expect(running).rejects.toThrow('canceled');
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readdir(join(data.store.directory, 'ai-work'))).toEqual([]);
  } finally {
    controller.abort();
    await running?.catch(() => undefined);
    process.env.PATH = previousPath;
  }
});
test('CLI runners use isolated fixed arguments, stdin, bounded output and a minimal environment', async () => {
  const data = await setup();
  const binaries = join(data.root, 'bin');
  await mkdir(binaries);
  const executable = join(binaries, 'claude');
  const codexExecutable = join(binaries, 'codex');
  await Bun.write(
    executable,
    `#!${process.execPath}\nconst input=await new Response(Bun.stdin.stream()).text();process.stdout.write(JSON.stringify({result:JSON.stringify({input,args:process.argv.slice(2),cwd:process.cwd(),unrelated:process.env.KITFOLD_UNRELATED_DUMMY || null})}));\n`,
  );
  await chmod(executable, 0o700);
  await Bun.write(
    codexExecutable,
    `#!${process.execPath}\nconst args=process.argv.slice(2);const input=await new Response(Bun.stdin.stream()).text();await Bun.write(args[args.indexOf('--output-last-message')+1],JSON.stringify({input,args}));process.stdout.write('ignored event stream');\n`,
  );
  await chmod(codexExecutable, 0o700);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaries}:${originalPath}`;
  process.env.KITFOLD_UNRELATED_DUMMY = 'must-not-be-forwarded';
  const prompt = 'Format literal $(touch never-execute) and `not a shell command`.';
  try {
    expect(Bun.which('claude', { PATH: process.env.PATH })).toBe(executable);
    const raw = await runAi({
      request: AiRequestSchema.parse(request),
      prompt,
      directory: data.store.directory,
      signal: new AbortController().signal,
    });
    const result = JSON.parse(String(raw));
    expect(result.input).toBe(prompt);
    expect(result.unrelated).toBeNull();
    expect(result.args).toContain('--safe-mode');
    expect(result.args).toContain('--restricted');
    expect(result.args).toContain('--no-session-persistence');
    expect(result.cwd).toStartWith(join(data.store.directory, 'ai-work'));
    expect(await readdir(join(data.store.directory, 'ai-work'))).toEqual([]);
    const command = aiCommand('codex', 'selected-model', 'result.json');
    expect(command).toContain('--ignore-user-config');
    expect(command).toContain('--ignore-rules');
    expect(command).toContain('--ephemeral');
    expect(command).toContain('read-only');
    expect(command).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(Bun.which('codex', { PATH: process.env.PATH })).toBe(codexExecutable);
    const codexOutput = JSON.parse(
      String(
        await runAi({
          request: AiRequestSchema.parse({ ...request, runner: 'codex' }),
          prompt,
          directory: data.store.directory,
          signal: new AbortController().signal,
        }),
      ),
    );
    expect(codexOutput.input).toBe(prompt);
    expect(codexOutput.args).toContain('--ephemeral');
    expect(await readdir(join(data.store.directory, 'ai-work'))).toEqual([]);
  } finally {
    process.env.PATH = originalPath;
    delete process.env.KITFOLD_UNRELATED_DUMMY;
  }
});
