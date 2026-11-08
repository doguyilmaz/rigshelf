import { randomUUID } from 'node:crypto';
import { lstat, readlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectProject, readText } from './detect';
import { guidanceFindings } from './guidance';
import { readKit } from './kit';
import { bridgeDefinition, bridgeReason } from './mcp-compat';
import { checkedMcpDefinition } from './mcp-definition';
import {
  type Change,
  type Mcp,
  type Plan,
  type Provider,
  type SetupRequest,
  SetupSchema,
} from './model';
import { ownedProject, rootIdentity } from './ownership';
import { MAX_PLAN_BYTES, MAX_PLAN_CHANGES, planFile } from './plan-limits';
import { projectMcpFile } from './project-config';
import { adapter, mergeMcp } from './providers';
import { effectiveRules, presetChain } from './recommend';
import { assertWritePath, checkedProject, hash, now, slug } from './safety';
import { skillOutputPath } from './skill-paths';
import type { Store } from './store';

const SHARED_RENDER_ORDER: Provider[] = [
  'codex',
  'opencode',
  'antigravity',
  'kiro',
  'grok',
  'claude',
];

type GuidanceFile = 'AGENTS.md' | 'CLAUDE.md';
const guidanceLinks: [GuidanceFile, GuidanceFile][] = [
  ['CLAUDE.md', 'AGENTS.md'],
  ['AGENTS.md', 'CLAUDE.md'],
];

async function sharedGuidance(projectPath: string): Promise<GuidanceFile | null> {
  for (const [link, target] of guidanceLinks) {
    const path = join(projectPath, link);
    const stats = await lstat(path).catch(() => null);
    if (
      stats?.isSymbolicLink() &&
      resolve(projectPath, await readlink(path)) === join(projectPath, target)
    )
      return target;
  }
  return null;
}

/** Maps portable skill folder names to the source recorded by the skills CLI lock (version 1). */
async function readSkillsLock(projectPath: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  try {
    const lock = JSON.parse((await readText(join(projectPath, 'skills-lock.json'))) || '{}');
    if (lock.version !== 1 || typeof lock.skills !== 'object' || !lock.skills) return sources;
    for (const [name, value] of Object.entries(lock.skills as Record<string, { source?: unknown }>))
      if (typeof value?.source === 'string') sources.set(slug(name), value.source.slice(0, 200));
  } catch {}
  return sources;
}

const CODEX_GUIDANCE_BYTES = 32 * 1024;

async function codexGuidanceWarnings(projectPath: string, planned: string): Promise<string[]> {
  const warnings: string[] = [];
  const override = await readText(join(projectPath, 'AGENTS.override.md'));
  if (override?.trim())
    warnings.push(
      'Codex reads AGENTS.override.md instead of AGENTS.md in this folder, so it will not see the Rigshelf guidance block.',
    );
  const agents = Buffer.from(planned, 'base64');
  if (agents.length > CODEX_GUIDANCE_BYTES)
    warnings.push(
      `AGENTS.md is ${Math.ceil(agents.length / 1024)} KiB; Codex reads 32 KiB of project guidance by default (project_doc_max_bytes), so text near the end, including the Rigshelf block, may be dropped.`,
    );
  return warnings;
}

export async function missingDirectories(
  projectPath: string,
  changes: Change[],
): Promise<string[]> {
  const missing = new Set<string>();
  for (const change of changes) {
    if (change.before !== null) continue;
    for (let path = dirname(change.path); path !== '.'; path = dirname(path)) {
      if (missing.has(path)) continue;
      if (await lstat(join(projectPath, path)).catch(() => null)) break;
      missing.add(path);
    }
  }
  return [...missing].sort((left, right) => right.split('/').length - left.split('/').length);
}

const START = '<!-- kitfold:begin -->';
const END = '<!-- kitfold:end -->';
export function managedBlock(before: string | null, content: string): string {
  const eol = before?.includes('\r\n') ? '\r\n' : '\n';
  const block = `${START}\n${content.trim()}\n${END}`.replace(/\r?\n/g, eol);
  if (!before) return `${block}${eol}`;
  const start = before.indexOf(START),
    end = before.indexOf(END);
  if (
    start < 0 !== end < 0 ||
    (end >= 0 && end < start) ||
    before.indexOf(START, start + START.length) >= 0
  )
    throw new Error('Malformed or duplicate Rigshelf directive markers.');
  return start < 0
    ? `${before.trimEnd()}${eol}${eol}${block}${eol}`
    : before.slice(0, start) + block + before.slice(end + END.length);
}

function portableSkill(body: string, provider: string): string {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Skill needs valid frontmatter before installation.');
  const metadata = parseYaml(match[1], { maxAliasCount: 10 }) as Record<string, unknown>;
  if (
    !metadata ||
    typeof metadata.name !== 'string' ||
    !metadata.name.trim() ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024
  )
    throw new Error(
      'Skill frontmatter needs a nonempty name and a description of at most 1024 characters. Edit a custom fork before installation.',
    );
  const originalMetadata = JSON.stringify(metadata);
  if (metadata['disable-model-invocation'] === true && !['claude', 'grok'].includes(provider))
    throw new Error(
      `Manual-only invocation policy cannot be preserved for ${provider}. Use an explicit custom fork with a reviewed invocation policy.`,
    );
  metadata.name = slug(String(metadata.name));
  if (provider !== 'claude')
    for (const key of [
      'hooks',
      'context',
      'agent',
      'model',
      'allowed-tools',
      ...(provider === 'grok' ? [] : ['disable-model-invocation', 'user-invocable']),
    ])
      delete metadata[key];
  if (JSON.stringify(metadata) === originalMetadata) return body;
  return `---\n${stringifyYaml(metadata).trimEnd()}\n---\n${body.slice(match[0].length)}`;
}

export async function createPlan(store: Store, raw: SetupRequest): Promise<Plan> {
  const input = SetupSchema.parse(raw);
  const projectPath = await checkedProject(input.projectPath);
  const detected = await detectProject(projectPath, input.requirements);
  const project = { ...detected, ...store.get<object>('project-override', detected.id) };
  const extraStacks = input.presetId
    ? presetChain(store, input.presetId).flatMap((preset) => preset.stacks)
    : [];
  const entries = [...new Set(input.entryIds)].map((id) => {
    const entry = store.entry(id);
    if (!entry) throw new Error(`Missing entry: ${id}`);
    return entry;
  });
  const warnings: string[] = [];
  for (const entry of entries) {
    if (entry.findings.some((finding) => finding.level === 'block'))
      throw new Error(
        `${entry.name} is blocked by its content scan. Resolve the finding before setup.`,
      );
    if (entry.findings.some((finding) => finding.level === 'review') && !input.allowReviewed)
      throw new Error(
        `${entry.name} needs review. Inspect its findings and enable reviewed content to continue.`,
      );
    if (entry.kind !== 'skill' && entry.kind !== 'mcp')
      throw new Error(
        `${entry.name} is a recipe/resource. It cannot be silently installed as a skill.`,
      );
  }
  const changes = new Map<string, Change>();
  const intended = new Map<string, string>();
  let plannedBytes = 0;
  const ownership = await ownedProject(store, projectPath);
  const diskKit = await readKit(projectPath);
  const previousKit = ownership?.kit;
  if (diskKit && !ownership)
    warnings.push(
      'This project kit has no reviewed ownership record on this machine. Existing files are preserved; applying this plan records the selected kit locally.',
    );
  const previousHashes = previousKit?.hashes || {};
  function reserve(before: Buffer | null, after: string | null): void {
    plannedBytes += (before?.length || 0) + (after ? Buffer.byteLength(after, 'base64') : 0);
    if (plannedBytes > MAX_PLAN_BYTES || changes.size >= MAX_PLAN_CHANGES)
      throw new Error(
        'This setup exceeds the 128 MiB / 10,000 file plan limit. Select a smaller kit or fewer harnesses.',
      );
  }
  const installedSkills = new Set<string>();
  const shared = await sharedGuidance(projectPath);
  const skillsLock = await readSkillsLock(projectPath);
  async function sharedRenderer(provider: Provider, name: string): Promise<Provider> {
    const skillFile = (value: Provider) =>
      skillOutputPath(projectPath, `${adapter(value).skills}/${name}/SKILL.md`);
    const target = await skillFile(provider);
    const sharing: Provider[] = [];
    for (const other of new Set(input.providers))
      if ((await skillFile(other)) === target) sharing.push(other);
    return SHARED_RENDER_ORDER.find((value) => sharing.includes(value)) ?? provider;
  }
  async function existingSkillFile(
    path: string,
    content: string,
    upstream: string,
  ): Promise<'install' | 'adopt' | 'conflict'> {
    const resolved = await skillOutputPath(projectPath, path);
    const bytes = await planFile(await assertWritePath(projectPath, resolved));
    if (!bytes) return 'install';
    const current = bytes.toString('base64');
    if (current === content || input.replaceExisting) return 'install';
    if (current === upstream) return 'adopt';
    if (previousHashes[resolved] === hash(bytes)) return 'install';
    if (previousHashes[resolved])
      throw new Error(
        `Existing file differs: ${resolved}. Rigshelf will not overwrite an unmanaged or locally modified skill.`,
      );
    return 'conflict';
  }
  async function add(
    path: string,
    content: string,
    reason: string,
    replaceManaged = false,
    executable = false,
  ): Promise<void> {
    const resolved = await skillOutputPath(projectPath, path);
    if (resolved !== path) {
      warnings.push(`Project-local skill alias ${path} resolves to ${resolved}.`);
      path = resolved;
    }
    const target = await assertWritePath(projectPath, path);
    if (intended.has(path) && intended.get(path) !== content)
      throw new Error(`Conflicting output for ${path}. Select one version of each skill.`);
    intended.set(path, content);
    const existing = changes.get(path);
    if (existing) {
      if (existing.after !== content)
        throw new Error(`Conflicting output for ${path}. Select one version of each skill.`);
      return;
    }
    const bytes = await planFile(target);
    const beforeHash = bytes ? hash(bytes) : null;
    if (bytes && bytes.toString('base64') === content) return;
    if (bytes && !replaceManaged && !input.replaceExisting && previousHashes[path] !== beforeHash)
      throw new Error(
        `Existing file differs: ${path}. Rigshelf will not overwrite an unmanaged or locally modified skill.`,
      );
    if (bytes && !replaceManaged && input.replaceExisting && previousHashes[path] !== beforeHash)
      warnings.push(
        `Explicit replacement of ${path}; its original bytes are retained for rollback.`,
      );
    const beforeMode = bytes ? (await lstat(target)).mode & 0o777 : undefined;
    reserve(bytes, content);
    changes.set(path, {
      path,
      beforeHash,
      before: bytes ? bytes.toString('base64') : null,
      after: content,
      reason,
      beforeMode,
      afterMode: executable ? 0o700 : beforeMode || 0o600,
    });
  }
  const selectedMcp: Record<string, Mcp> = {};
  const providerMcp: Record<string, Record<string, Mcp>> = {};
  for (const entry of entries)
    if (entry.kind === 'mcp') {
      const definition = checkedMcpDefinition(entry.body);
      const name = slug(entry.name);
      if (selectedMcp[name] && JSON.stringify(selectedMcp[name]) !== JSON.stringify(definition))
        throw new Error(`Select one MCP variant for ${name}.`);
      selectedMcp[name] = definition;
      if (/\$\{/.test(JSON.stringify(definition)))
        warnings.push(
          `${entry.name}: resolve required environment placeholders in the target harness before use. Credentials are never copied from global config.`,
        );
    }
  const activeRules = input.includeRules ? effectiveRules(store, project, extraStacks) : [];
  for (const rule of activeRules) {
    const findings = guidanceFindings(rule);
    if (findings.some((finding) => finding.level === 'block'))
      throw new Error(
        `Directive ${rule.name} contains possible credentials. Resolve it in Directives before setup.`,
      );
    if (findings.some((finding) => finding.level === 'review') && !input.allowReviewed)
      throw new Error(
        `Directive ${rule.name} needs review. Inspect its content and enable reviewed instructions before setup.`,
      );
  }
  const directives = activeRules.map((rule) => `### ${rule.name}\n${rule.content}`).join('\n\n');
  const rules = `## Project guidance\n\nNarrower project-specific guidance takes precedence over shared guidance when they conflict.\n\n${directives}\n\n## Active kit\n\nThe active kit is pinned in .kitfold/kit.json. Use native skill discovery and read skill instructions on demand. Never load the entire library into context.`;
  for (const provider of [...new Set(input.providers)]) {
    const spec = adapter(provider);
    const mcpFile = await projectMcpFile(projectPath, provider);
    const compatibleMcp: Record<string, Mcp> = {};
    for (const [name, definition] of Object.entries(selectedMcp)) {
      const reason = bridgeReason(definition, provider);
      if (reason) {
        const path = `.kitfold/mcp/${name}.json`;
        await add(
          path,
          Buffer.from(`${JSON.stringify(definition, null, 2)}\n`).toString('base64'),
          `Store canonical ${name} definition for the MCP bridge`,
        );
        compatibleMcp[name] = bridgeDefinition(path);
        warnings.push(
          `${spec.name} / ${name}: Rigshelf MCP bridge required. ${reason} The rigshelf command must be on your PATH.`,
        );
      } else compatibleMcp[name] = definition;
    }
    providerMcp[provider] = compatibleMcp;
    warnings.push(`${spec.name}: ${spec.note}`);
    if (!spec.skills) throw new Error(`${spec.name}: ${spec.note}`);
    for (const entry of entries.filter((entry) => entry.kind === 'skill')) {
      const files = store.files(entry.id);
      if (!files.length) throw new Error(`No snapshot available for ${entry.name}`);
      const folder = `${spec.skills}/${slug(entry.name)}`;
      const renderer = await sharedRenderer(provider, slug(entry.name));
      const skillText = portableSkill(entry.body, renderer);
      if (renderer !== provider && skillText !== portableSkill(entry.body, provider))
        warnings.push(
          `${folder} is shared with ${adapter(renderer).name}; ${entry.name} uses its portable frontmatter for ${spec.name}.`,
        );
      const outputs = files.map((file) => ({
        file,
        path: `${folder}/${file.path}`,
        content:
          file.path === 'SKILL.md' ? Buffer.from(skillText).toString('base64') : file.content,
      }));
      const states = await Promise.all(
        outputs.map((output) =>
          existingSkillFile(output.path, output.content, output.file.content),
        ),
      );
      if (states.includes('conflict')) {
        const locked = skillsLock.get(slug(entry.name));
        warnings.push(
          locked
            ? `Kept existing ${folder}: the skills CLI installed it from ${locked} (skills-lock.json). Update it with skills update, or choose replace existing files to install the library revision.`
            : `Kept existing ${folder}: it differs from the library revision of ${entry.name}. Choose replace existing files to install the library revision.`,
        );
        continue;
      }
      installedSkills.add(entry.id);
      for (const [index, output] of outputs.entries())
        await add(
          output.path,
          states[index] === 'adopt' ? output.file.content : output.content,
          `Install ${entry.name} for ${spec.name}`,
          false,
          output.file.executable,
        );
      if (
        provider !== 'claude' &&
        /(?:allowed-tools|hooks|context|agent|model):/.test(entry.body.split('---')[1] || '')
      )
        warnings.push(
          `${entry.name}: Claude-specific frontmatter omitted for ${spec.name}; instructions may still reference harness-specific tools.`,
        );
    }
    if (
      (Object.keys(selectedMcp).length ||
        Object.keys(previousKit?.managedMcp?.[provider] || {}).length) &&
      mcpFile
    ) {
      const before = await readText(await assertWritePath(projectPath, mcpFile));
      const merged = mergeMcp(
        before ?? null,
        provider,
        compatibleMcp,
        previousKit?.managedMcp?.[provider],
      );
      await add(
        mcpFile,
        Buffer.from(merged).toString('base64'),
        'Merge selected MCP servers; preserve unrelated settings',
        true,
      );
    }
    if (input.includeRules && spec.instructions) {
      const instructions = shared ?? spec.instructions;
      const before = await readText(await assertWritePath(projectPath, instructions));
      const content =
        shared || spec.instructions !== 'CLAUDE.md'
          ? rules
          : input.providers.some((value) => adapter(value).instructions === 'AGENTS.md')
            ? '@AGENTS.md'
            : (await readText(join(projectPath, 'AGENTS.md')))?.trim()
              ? `@AGENTS.md\n\n${rules}`
              : rules;
      await add(
        instructions,
        Buffer.from(managedBlock(before ?? null, content)).toString('base64'),
        'Update Rigshelf directive block; preserve authored text',
        true,
      );
    }
  }
  if (input.includeRules && input.providers.includes('codex'))
    warnings.push(
      ...(await codexGuidanceWarnings(projectPath, intended.get(shared ?? 'AGENTS.md') || '')),
    );
  const hashes: Record<string, string> = { ...previousHashes };
  for (const [path, content] of intended) hashes[path] = hash(Buffer.from(content, 'base64'));
  for (const [path, expectedHash] of Object.entries(previousHashes))
    if (
      (/^\.(?:agents|claude|codex|kiro|grok)\/skills\//.test(path) ||
        /^\.kitfold\/mcp\//.test(path)) &&
      !intended.has(path)
    ) {
      const target = await assertWritePath(projectPath, path);
      const bytes = await planFile(target);
      if (bytes) {
        if (hash(bytes) !== expectedHash)
          throw new Error(`Managed skill was locally edited: ${path}. Resolve it before removal.`);
        reserve(bytes, null);
        changes.set(path, {
          path,
          beforeHash: expectedHash,
          before: bytes.toString('base64'),
          after: null,
          reason: 'Remove a previously managed capability no longer selected',
          beforeMode: (await lstat(target)).mode & 0o777,
        });
      }
      delete hashes[path];
    }
  for (const provider of previousKit?.providers || [])
    if (!input.providers.includes(provider)) {
      const mcpFile = await projectMcpFile(projectPath, provider);
      const owned = previousKit?.managedMcp?.[provider] || {};
      if (Object.keys(owned).length && mcpFile) {
        const before = await readText(await assertWritePath(projectPath, mcpFile));
        await add(
          mcpFile,
          Buffer.from(mergeMcp(before ?? null, provider, {}, owned)).toString('base64'),
          'Remove previously managed MCP entries for deselected agent',
          true,
        );
      }
    }
  for (const change of changes.values())
    if (change.after !== null) hashes[change.path] = hash(Buffer.from(change.after, 'base64'));
  const managedMcp = providerMcp;
  const plannedEntries = entries.filter(
    (entry) => entry.kind !== 'skill' || installedSkills.has(entry.id),
  );
  const manifest = `${JSON.stringify(
    {
      schemaVersion: 1,
      providers: input.providers,
      entries: plannedEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        digest: entry.digest,
        ref: entry.upstreamRef,
      })),
      presetId: input.presetId,
      requirements: input.requirements,
      hashes,
      managedMcp,
    },
    null,
    2,
  )}\n`;
  await add(
    '.kitfold/kit.json',
    Buffer.from(manifest).toString('base64'),
    'Record pinned kit and managed file hashes',
    true,
  );
  const createdDirectories = await missingDirectories(projectPath, [...changes.values()]);
  const plan: Plan = {
    id: randomUUID(),
    projectPath,
    providers: input.providers,
    entries: plannedEntries.map((entry) => entry.id),
    createdAt: now(),
    changes: [...changes.values()],
    warnings: [...new Set(warnings)],
    status: 'planned',
    requirements: input.requirements,
    presetId: input.presetId,
    purpose: 'setup',
    rootIdentity: await rootIdentity(projectPath),
    ownershipBefore: ownership,
    ownershipAfter: JSON.parse(manifest),
    manifestHash: hash(manifest),
    requiresAdoption: !ownership,
    createdDirectories,
  };
  store.put('plan', plan);
  store.event('setup.planned', `Prepared ${plan.changes.length} file changes for ${project.name}`);
  return plan;
}

export { executePlan } from './plan-io';
