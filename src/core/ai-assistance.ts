import { randomUUID } from 'node:crypto';
import { AI_TIMEOUT_MS, type AiDriver, aiProviders, runAi } from '../platform/ai-runner';
import {
  type AiProposal,
  type AiRequest,
  AiRequestSchema,
  draftPrompt,
  maskAiText,
  parseAiProposal,
} from './ai-drafts';
import { redact } from './safety';
import { classifyResource } from './seeds';
import type { Store } from './store';

const MAX_REQUESTS = 24;
const MAX_CONTEXT_ENTRIES = 80;
const MAX_MATCH_TERMS = 64;
const MAX_ACTIVE = 2;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const AGENT_WAIT_MS = 15 * 60 * 1000;
export interface AiDraftJob {
  id: string;
  createdAt: string;
  state: 'waiting' | 'running' | 'ready' | 'failed' | 'canceled';
  request: AiRequest;
  prompt: string;
  entryIds: string[];
  proposal?: AiProposal;
  error?: string;
}
export type AiDraftView = Pick<AiDraftJob, 'id' | 'createdAt' | 'state' | 'proposal' | 'error'>;
export function aiDraftView(job: AiDraftJob): AiDraftView {
  return {
    id: job.id,
    createdAt: job.createdAt,
    state: job.state,
    proposal: job.proposal,
    error: job.error,
  };
}
const active = new WeakMap<
  Store,
  Map<string, { controller: AbortController; done: Promise<void> }>
>();
const closing = new WeakSet<Store>();
function ownedJobs(store: Store) {
  let jobs = active.get(store);
  if (!jobs) {
    jobs = new Map();
    active.set(store, jobs);
  }
  return jobs;
}
function contextFor(store: Store, request: AiRequest): { text: string; ids: string[] } {
  if (!['requirements', 'preset'].includes(request.task)) return { text: '', ids: [] };
  const terms = [
    ...new Set(
      `${request.text} ${request.current}`.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [],
    ),
  ].slice(0, MAX_MATCH_TERMS);
  const entries = store
    .entries(true)
    .filter((entry) => !entry.archived && ['skill', 'mcp'].includes(entry.kind))
    .map((entry) => ({
      entry,
      score: [entry.name, ...entry.tags].filter((word) =>
        terms.some((term) => word.toLowerCase().includes(term)),
      ).length,
    }))
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .slice(0, MAX_CONTEXT_ENTRIES)
    .map(({ entry }) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      tags: entry.tags,
      description: entry.description.slice(0, 180),
    }));
  return {
    text: JSON.stringify({
      entries,
      scopes: [
        'global',
        'mobile',
        'web',
        'backend',
        'expo',
        'react-native',
        'ios',
        'android',
        'macos',
        'swift',
        'kotlin',
        'go',
        'bun',
        'hono',
        'nextjs',
      ],
    }),
    ids: entries.map((entry) => entry.id),
  };
}
export function listAiDrafts(store: Store): AiDraftJob[] {
  return store
    .list<AiDraftJob>('ai-draft')
    .filter((job) => Date.now() - Date.parse(job.createdAt) < RETENTION_MS)
    .map((job) => {
      if (job.state === 'waiting' && Date.now() - Date.parse(job.createdAt) > AGENT_WAIT_MS) {
        const canceled: AiDraftJob = {
          ...job,
          state: 'canceled',
          error: 'The connected Agent request expired. Generate a new draft.',
        };
        store.put('ai-draft', canceled);
        return canceled;
      }
      if (job.state !== 'running' || Date.now() - Date.parse(job.createdAt) <= AI_TIMEOUT_MS + 5000)
        return job;
      const failed: AiDraftJob = {
        ...job,
        state: 'failed',
        error: 'The previous AI run ended before completion. Generate a new draft.',
      };
      store.put('ai-draft', failed);
      return failed;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
export function aiDraft(store: Store, id: string): AiDraftJob {
  const job = listAiDrafts(store).find((item) => item.id === id);
  if (!job) throw new Error('AI draft request expired or was not found.');
  return job;
}
function proposalFor(job: AiDraftJob, output: unknown): AiProposal {
  const proposal = parseAiProposal(output, job.request.task, new Set(job.entryIds));
  const draft = proposal.draft;
  if (draft.kind !== 'source') return proposal;
  const material = `${job.request.text}\n${job.request.current}`;
  const references = [
    ...(material.match(/https?:\/\/[^\s"'<>`\\]+/g) || []).map((value) =>
      value.replace(/[),.;]+$/, ''),
    ),
    ...(material.match(/(?:bunx|npx)\s+(?:skills\s+add|add-skill)\s+[^\r\n`"]+/g) || []),
  ];
  const canonical = (value: string) => {
    try {
      const source = classifyResource(value);
      return source.type === 'github' ? source.url.toLowerCase() : source.url;
    } catch {
      return '';
    }
  };
  const target = canonical(draft.input);
  const original = references.find(
    (value) => value === draft.input || (target && canonical(value) === target),
  );
  if (original) draft.input = original;
  else if (!material.includes(draft.input))
    throw new Error(
      'AI suggested a source reference you did not provide. Paste the exact link or command and try again.',
    );
  return proposal;
}
export function completeAiDraft(store: Store, id: string, output: unknown): AiDraftJob {
  const job = aiDraft(store, id);
  if (job.state !== 'waiting')
    throw new Error('Only a waiting request can receive a connected-agent draft.');
  const proposal = proposalFor(job, output);
  const next: AiDraftJob = { ...job, state: 'ready', proposal };
  store.put('ai-draft', next);
  return next;
}
export async function cancelAiDraft(store: Store, id: string): Promise<AiDraftJob> {
  const job = aiDraft(store, id);
  if (job.state === 'ready' || job.state === 'failed' || job.state === 'canceled') return job;
  const task = ownedJobs(store).get(id);
  store.put('ai-draft', { ...job, state: 'canceled' });
  task?.controller.abort();
  await task?.done;
  return aiDraft(store, id);
}
export function startAiDraft(store: Store, raw: unknown, driver: AiDriver = runAi): AiDraftJob {
  if (closing.has(store))
    throw new Error('The workbench is shutting down. No AI generation was started.');
  const validated = AiRequestSchema.safeParse(raw);
  if (!validated.success)
    throw new Error(
      'Check the request, Provider and model name. Model names cannot contain spaces or shell options.',
    );
  const parsed = validated.data;
  const connection =
    parsed.runner === 'compatible'
      ? store.settings().aiConnections.find((value) => value.id === parsed.connectionId)
      : undefined;
  if (parsed.runner === 'compatible' && !connection)
    throw new Error('Choose a saved AI connection in Settings.');
  const request = { ...parsed, text: maskAiText(parsed.text), current: maskAiText(parsed.current) };
  const jobs = listAiDrafts(store);
  if (jobs.filter((job) => job.state === 'running').length >= MAX_ACTIVE)
    throw new Error('Two AI drafts are already running. Finish or cancel one first.');
  for (const job of store.list<AiDraftJob>('ai-draft'))
    if (Date.now() - Date.parse(job.createdAt) >= RETENTION_MS) store.remove('ai-draft', job.id);
  for (const job of jobs.slice(MAX_REQUESTS - 1))
    if (job.state !== 'running') store.remove('ai-draft', job.id);
  const context = contextFor(store, request);
  const job: AiDraftJob = {
    id: `draft-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    state: request.runner === 'session' ? 'waiting' : 'running',
    request,
    prompt: draftPrompt(request, maskAiText(context.text)),
    entryIds: context.ids,
  };
  store.put('ai-draft', job);
  if (request.runner === 'session') return job;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const done = Promise.resolve()
    .then(() =>
      driver({
        request,
        prompt: job.prompt,
        directory: store.directory,
        signal: controller.signal,
        connection,
      }),
    )
    .then((output) => {
      if (
        controller.signal.aborted ||
        store.get<AiDraftJob>('ai-draft', job.id)?.state !== 'running'
      )
        return;
      const proposal = proposalFor(job, output);
      store.put('ai-draft', { ...job, state: 'ready', proposal });
    })
    .catch((error) => {
      if (store.get<AiDraftJob>('ai-draft', job.id)?.state !== 'running') return;
      store.put('ai-draft', {
        ...job,
        state: 'failed',
        error: controller.signal.aborted
          ? 'AI generation timed out. Your draft is unchanged.'
          : error instanceof Error
            ? redact(error.message)
            : 'AI generation failed.',
      });
    })
    .finally(() => {
      clearTimeout(timer);
      ownedJobs(store).delete(job.id);
    });
  ownedJobs(store).set(job.id, { controller, done });
  return job;
}
export async function closeAiDrafts(store: Store): Promise<void> {
  closing.add(store);
  const jobs = [...ownedJobs(store)];
  for (const [id, { controller }] of jobs) {
    const job = store.get<AiDraftJob>('ai-draft', id);
    if (job?.state === 'running') store.put('ai-draft', { ...job, state: 'canceled' });
    controller.abort();
  }
  await Promise.allSettled(jobs.map(([, task]) => task.done));
}
export { aiProviders };
