import { homedir } from 'node:os';
import { z } from 'zod';
import type { AiDriver } from '../platform/ai-runner';
import { getOllamaModels } from '../platform/ollama-models';
import {
  aiDraft,
  aiDraftView,
  aiProviders,
  cancelAiDraft,
  completeAiDraft,
  listAiDrafts,
  startAiDraft,
} from './ai-assistance';
import type { AiFileInventory } from './ai-files';
import { exportLibrary, importLibrary } from './backup';
import { connection } from './connection';
import { contentPreview } from './content-preview';
import { detectProject } from './detect';
import { discoverSkills } from './discovery';
import { documentPlan, projectDocument } from './documents';
import { guidanceFindings } from './guidance';
import { createCustomSkill, importSkillDirectory } from './ingest';
import { inventoryHistory, readInventoryBaseline } from './inventory-baselines';
import {
  type Entry,
  McpSchema,
  PresetSchema,
  type Project,
  RecordIdSchema,
  type Rule,
  RuleSchema,
  SettingsSchema,
  type Source,
} from './model';
import { approveProject, matchesManifest, ownedProject } from './ownership';
import { filePreview, planView } from './plan-view';
import { createPlan, executePlan } from './planner';
import { preserveProjectInventory } from './project-inventory';
import { adapters } from './providers';
import { effectiveRules, presetChain, recommend } from './recommend';
import { recoverPlan } from './recovery';
import { readReviewResponse } from './review-response';
import { checkedProject, hash, now, redact, scanText, slug } from './safety';
import { sanitizeMcp, scan, scanProgress } from './scanner';
import { reviseSkill } from './skill-revisions';
import { addSource, editSource } from './source-library';
import type { Store } from './store';
import { checkSource, discoverSourceSkills, importUpstreamSkill } from './upstream';
import { checkProject } from './watch';

const CustomSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  body: z
    .string()
    .min(1)
    .max(512 * 1024),
  tags: z.array(z.string().max(64)).max(30).default([]),
});
export function state(store: Store): unknown {
  const rules = store.list<Rule>('rule');
  return {
    entries: store.entries(true),
    sources: store.sources(),
    projects: store.projects(),
    globalAiFiles: store.get<AiFileInventory>('global-ai-inventory', 'main')?.files || [],
    globalAiWarnings: store.get<AiFileInventory>('global-ai-inventory', 'main')?.warnings || [],
    installations: store.installations(),
    presets: store.list('preset'),
    rules,
    ruleFindings: rules
      .map((rule) => ({ id: rule.id, findings: guidanceFindings(rule) }))
      .filter((rule) => rule.findings.length),
    events: store.events(),
    adapters,
    settings: store.settings(),
    lastScan: store.get('scan', 'last'),
    scan: scanProgress,
    dataDirectory: store.directory,
    approvals: store.list('approval'),
    trust: store.list('trust'),
    recoveries: store
      .list<{ id: string; state: string }>('journal')
      .filter((journal) => ['writing', 'needs-recovery'].includes(journal.state)),
    suggestions: store.list('suggestion'),
    discoveries: store.list('discovery'),
    plans: store.planSummaries(),
  };
}

export async function route(
  store: Store,
  method: string,
  path: string,
  input: unknown,
  options: { aiDriver?: AiDriver; signal?: AbortSignal } = {},
): Promise<unknown> {
  const segments = path.split('/').map((segment) => decodeURIComponent(segment));
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    segments.length > 4
  )
    throw new Error('Invalid API route.');
  const [resource, id, action] = segments;
  if (id) RecordIdSchema.parse(id);
  if (resource === 'ai') {
    if (method === 'GET' && id === 'providers' && segments.length === 2) return aiProviders();
    if (method === 'GET' && id === 'ollama-models' && segments.length === 2)
      return getOllamaModels({ signal: options.signal });
    if (id === 'drafts') {
      if (method === 'GET' && segments.length <= 3)
        return action
          ? aiDraftView(aiDraft(store, RecordIdSchema.parse(action)))
          : listAiDrafts(store).map(aiDraftView);
      if (method === 'POST' && segments.length === 2)
        return aiDraftView(startAiDraft(store, input, options.aiDriver));
      if (method === 'POST' && action && segments.length === 4) {
        RecordIdSchema.parse(action);
        if (segments[3] === 'cancel') return aiDraftView(await cancelAiDraft(store, action));
        if (segments[3] === 'complete') return aiDraftView(completeAiDraft(store, action, input));
      }
    }
    throw new Error('Unknown AI operation.');
  }
  if (
    segments[3] &&
    !(
      method === 'GET' &&
      ((resource === 'entries' && action === 'files') ||
        (resource === 'plans' && action === 'changes'))
    )
  )
    throw new Error('Invalid API route.');
  if (method === 'POST' && resource === 'discover') return discoverSkills(store, input);
  if (method === 'POST' && resource === 'connection') return connection(input);
  if (method === 'GET' && resource === 'state') return state(store);
  if (method === 'GET' && resource === 'scan') return scanProgress;
  if (method === 'GET' && resource === 'scan-history')
    return id ? readInventoryBaseline(store, id) : inventoryHistory(store);
  if (method === 'POST' && resource === 'scan') {
    if (scanProgress.state === 'running') throw new Error('A scan is already running');
    void scan(store).catch((error) => store.event('scan.failed', String(error)));
    return { started: true };
  }
  if (method === 'GET' && resource === 'entries' && id && action === 'files') {
    const index = z.coerce.number().int().min(0).parse(segments[3]);
    const file = store.fileAt(id, index);
    if (!file) throw new Error('Snapshot file not found');
    return {
      path: file.path,
      executable: file.executable,
      ...contentPreview(file.content, 512 * 1024),
    };
  }
  if (method === 'POST' && resource === 'entries' && id && action === 'files') {
    const entry = store.entry(id);
    if (!entry?.custom) throw new Error('Fork upstream content before editing its files.');
    const value = z
      .object({
        path: z.string(),
        text: z.string().max(512 * 1024),
        executable: z.boolean().default(false),
      })
      .parse(input);
    return reviseSkill(store, id, {
      file: {
        path: value.path,
        content: Buffer.from(value.text).toString('base64'),
        executable: value.executable,
      },
    });
  }
  if (method === 'DELETE' && resource === 'entries' && id && action === 'files') {
    if (!store.entry(id)?.custom)
      throw new Error('Fork upstream content before editing its files.');
    const value = z.object({ path: z.string().min(1).max(4096) }).parse(input);
    return reviseSkill(store, id, { removePath: value.path });
  }
  if (method === 'GET' && resource === 'entries' && id && !action) {
    const entry = store.entry(id);
    if (!entry) throw new Error('Snapshot no longer exists. Refresh the library.');
    return {
      entry,
      files: store.fileMetadata(id),
    };
  }
  if (method === 'POST' && resource === 'custom')
    return createCustomSkill(store, CustomSchema.parse(input));
  if (method === 'POST' && resource === 'fork') {
    const value = z
      .object({
        fromId: z.string(),
        name: z.string().max(64).optional(),
        description: z.string().max(1024).optional(),
        body: z
          .string()
          .max(512 * 1024)
          .optional(),
        tags: z.array(z.string().max(64)).optional(),
      })
      .parse(input);
    return reviseSkill(store, value.fromId, value);
  }
  if (method === 'POST' && resource === 'local-import') {
    const value = z.object({ path: z.string().min(1) }).parse(input);
    return importSkillDirectory(store, value.path, homedir());
  }
  if (method === 'PATCH' && resource === 'entries' && id && !action) {
    const entry = store.entry(id);
    if (!entry) throw new Error('Entry not found');
    const value = z
      .object({
        tags: z.array(z.string().min(1).max(64)).max(50),
        sourceId: z.string().optional(),
        archived: z.boolean().optional(),
        body: z
          .string()
          .max(512 * 1024)
          .optional(),
      })
      .parse(input);
    if (value.sourceId && !store.get('source', value.sourceId)) throw new Error('Unknown source');
    entry.tags = value.tags;
    if (value.archived !== undefined) entry.archived = value.archived;
    if (value.sourceId) entry.sourceId = value.sourceId;
    if (value.body !== undefined) {
      if (!entry.custom || entry.kind !== 'skill')
        throw new Error('Fork upstream content as a custom skill before editing.');
      return reviseSkill(store, id, { body: value.body, tags: value.tags });
    }
    store.saveEntry(entry);
    store.event('entry.updated', entry.name);
    return entry;
  }
  if (method === 'DELETE' && resource === 'entries' && id && (!action || action === 'purge')) {
    const entry = store.entry(id);
    if (!entry) throw new Error('Entry not found');
    if (action === 'purge') {
      if (
        !entry.archived ||
        store.installations().some((location) => location.entryId === id) ||
        store.planReferences(id)
      )
        throw new Error('Only archived, unreferenced snapshots can be permanently deleted.');
      store.deleteEntry(id);
      store.event('entry.deleted', entry.name);
      return { removed: true };
    }
    entry.archived = true;
    store.saveEntry(entry);
    store.event('entry.archived', `${entry.name}; installed and pinned copies remain available.`);
    return { archived: true };
  }
  if (method === 'POST' && resource === 'mcp') {
    const value = z
      .object({
        name: z.string().min(1).max(64),
        mcp: McpSchema,
        tags: z.array(z.string()).default([]),
      })
      .parse(input);
    const mcp = McpSchema.parse(sanitizeMcp(value.mcp));
    const body = JSON.stringify(mcp, null, 2);
    const entry: Entry = {
      id: `mcp-${hash(slug(value.name) + body).slice(0, 24)}`,
      name: slug(value.name),
      kind: 'mcp',
      description: `MCP · ${mcp.command || mcp.url}`,
      tags: value.tags,
      sourceId: 'custom-mcp',
      digest: hash(body),
      custom: true,
      body,
      mcp,
      findings: scanText(body),
      updatedAt: now(),
    };
    store.put('source', {
      id: 'custom-mcp',
      name: 'Custom MCP servers',
      url: '',
      type: 'local',
      recipe: '',
      status: 'unchecked',
      notes: 'Use environment placeholders for secrets.',
    } satisfies Source);
    store.saveEntry(entry);
    store.event('mcp.created', entry.name);
    return entry;
  }
  if (method === 'POST' && resource === 'detect') {
    const value = z
      .object({
        projectPath: z.string().min(1).max(4096),
        requirements: z.string().max(10000).default(''),
        presetId: z.string().max(100).optional(),
        restorePrevious: z.boolean().default(false),
      })
      .parse(input);
    const projectPath = await checkedProject(value.projectPath);
    const owned = await ownedProject(store, projectPath);
    const previousSetup = owned
      ? {
          providers: owned.kit.providers,
          entryIds: owned.kit.entries.map((entry) => entry.id),
          requirements: owned.kit.requirements || '',
          presetId: owned.kit.presetId,
          manifestMatches: await matchesManifest(owned),
        }
      : undefined;
    const savedPreset =
      previousSetup?.presetId && store.get('preset', previousSetup.presetId)
        ? previousSetup.presetId
        : undefined;
    const requirements =
      value.restorePrevious && previousSetup ? previousSetup.requirements : value.requirements;
    const presetId = value.presetId || (value.restorePrevious ? savedPreset : undefined);
    const detected = await detectProject(projectPath, requirements);
    const project = {
      ...preserveProjectInventory(store, detected),
      ...store.get<object>('project-override', detected.id),
    };
    const result = recommend(store, project, presetId);
    const stacks = presetChain(store, result.presetId).flatMap((preset) => preset.stacks);
    const applicableRules = effectiveRules(store, project, stacks);
    const guidanceIssues = applicableRules
      .map((rule) => ({ id: rule.id, name: rule.name, findings: guidanceFindings(rule) }))
      .filter((rule) => rule.findings.length);
    return {
      project,
      ...result,
      guidanceIssues,
      previousSetup,
      applicableRuleIds: applicableRules.map((rule) => rule.id),
    };
  }
  if (method === 'POST' && resource === 'plans' && !id)
    return planView(await createPlan(store, input as Parameters<typeof createPlan>[1]));
  if (method === 'GET' && resource === 'plans' && id) {
    const plan = store.get<import('./model').Plan>('plan', id);
    if (!plan) throw new Error('Plan not found');
    return action === 'changes'
      ? filePreview(plan, z.coerce.number().int().min(0).parse(segments[3]))
      : planView(plan);
  }
  if (
    method === 'POST' &&
    resource === 'plans' &&
    id &&
    (action === 'apply' || action === 'rollback')
  )
    return planView(await executePlan(store, id, action));
  if (method === 'POST' && resource === 'plans' && id && action === 'recover')
    return planView(await recoverPlan(store, id));
  if (method === 'PUT' && resource === 'presets') {
    const preset = PresetSchema.parse(input);
    const previous = store.get('preset', preset.id);
    store.put('preset', preset);
    try {
      presetChain(store, preset.id);
    } catch (error) {
      if (previous) store.put('preset', previous as { id: string });
      else store.remove('preset', preset.id);
      throw error;
    }
    store.event('preset.saved', preset.name);
    return preset;
  }
  if (method === 'DELETE' && resource === 'presets' && id && !action) {
    if (
      store
        .list<{ id: string; parentId: string }>('preset')
        .some((preset) => preset.parentId === id)
    )
      throw new Error('Reassign child presets before removing this parent.');
    store.remove('preset', id);
    return { removed: true };
  }
  if (method === 'PUT' && resource === 'rules') {
    const rule = RuleSchema.parse(input);
    if (guidanceFindings(rule).some((finding) => finding.level === 'block'))
      throw new Error(
        'Keep credential-looking values outside reusable directives. Use environment references.',
      );
    store.put('rule', rule);
    store.event('rule.saved', rule.name);
    return rule;
  }
  if (method === 'DELETE' && resource === 'rules' && id && !action) {
    store.remove('rule', id);
    return { removed: true };
  }
  if (method === 'PUT' && resource === 'settings') {
    const settings = SettingsSchema.parse(input);
    store.put('settings', { id: 'main', ...settings });
    return settings;
  }
  if (method === 'POST' && resource === 'trust' && id && !action) {
    const entry = store.entry(id);
    if (!entry) throw new Error('Entry not found');
    if (!['skill', 'mcp'].includes(entry.kind) || entry.archived)
      throw new Error('Only active skill and MCP snapshots can be approved.');
    if (entry.findings.some((finding) => finding.level !== 'info'))
      throw new Error('Resolve content findings before approving automation.');
    store.put('trust', { id, digest: entry.digest });
    store.event('entry.trusted', entry.name);
    return { approved: true, digest: entry.digest };
  }
  if (method === 'DELETE' && resource === 'trust' && id && !action) {
    store.remove('trust', id);
    store.event('entry.untrusted', store.entry(id)?.name || id);
    return { approved: false };
  }
  if (method === 'PUT' && resource === 'automation' && id && !action) {
    const project = store.get<Project>('project', id);
    if (!project) throw new Error('Project not found');
    const value = z.object({ enabled: z.boolean() }).parse(input);
    await approveProject(store, project.path, value.enabled);
    store.event('automation.changed', `${project.name}: ${value.enabled ? 'enabled' : 'disabled'}`);
    return value;
  }
  if (method === 'PATCH' && resource === 'projects' && id && !action) {
    const project = store.get<Project>('project', id);
    if (!project) throw new Error('Project not found');
    const value = z
      .object({ name: z.string().min(1).max(200), stacks: z.array(z.string().max(64)).max(50) })
      .parse(input);
    store.put('project-override', { id, ...value });
    store.put('project', { ...project, ...value });
    return { ...project, ...value };
  }
  if (method === 'POST' && resource === 'projects' && id && action === 'check') {
    z.object({}).strict().parse(input);
    const project = store.get<Project>('project', id);
    if (!project) throw new Error('Project not found');
    return checkProject(store, project.path, false);
  }
  if (method === 'POST' && resource === 'sources' && !id) return addSource(store, input);
  if (method === 'PATCH' && resource === 'sources' && id && !action)
    return editSource(store, id, input);
  if (method === 'GET' && resource === 'sources' && id && action === 'index')
    return store.get('source-index', id) || null;
  if (method === 'DELETE' && resource === 'sources' && id && !action) {
    if (store.entries(true).some((entry) => entry.sourceId === id))
      throw new Error('Reassign library entries before removing their source.');
    store.remove('source', id);
    return { removed: true };
  }
  if (method === 'POST' && resource === 'sources' && id && action === 'check')
    return checkSource(store, id);
  if (method === 'GET' && resource === 'sources' && id && action === 'skills')
    return discoverSourceSkills(store, id);
  if (method === 'POST' && resource === 'sources' && id && action === 'import')
    return importUpstreamSkill(store, id, z.object({ path: z.string() }).parse(input).path);
  if (method === 'GET' && resource === 'export') return exportLibrary(store);
  if (method === 'POST' && resource === 'import') {
    const value = z.object({ bundle: z.unknown(), apply: z.boolean().default(false) }).parse(input);
    return importLibrary(store, value.bundle, value.apply);
  }
  if (method === 'POST' && resource === 'document-plan') return documentPlan(store, input);
  if (method === 'POST' && resource === 'document') return projectDocument(store, input);
  if (method === 'POST' && resource === 'ai-review') return prepareReview(store, input);
  throw new Error('Unknown operation');
}

async function prepareReview(store: Store, raw: unknown): Promise<unknown> {
  const input = z
    .object({
      text: z.string().max(20000),
      task: z.enum(['rule', 'skill', 'requirements']).default('rule'),
    })
    .parse(raw);
  const prompt = `Review this ${input.task} for a project setup library. Preserve the author’s intent. Be concise, identify contradictions, remove unnecessary context, and propose clear scoped guidance. Never include credentials or project-private details in reusable rules. Return a proposal, not commands to execute.\n\n${redact(input.text)}`;
  const settings = store.settings();
  if (settings.aiRunner !== 'ollama')
    return {
      runner: settings.aiRunner,
      prompt,
      result: '',
      note: 'Paste this into your selected agent, or use the Rigshelf MCP server in the active session. No CLI or paid model was launched.',
    };
  if (!settings.ollamaModel) throw new Error('Choose an Ollama model in Settings first.');
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      prompt,
      stream: false,
      options: { num_predict: 2000 },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  const result = await readReviewResponse(response);
  return {
    runner: 'ollama',
    prompt,
    result,
    note: 'Proposal only. Review before saving.',
  };
}
