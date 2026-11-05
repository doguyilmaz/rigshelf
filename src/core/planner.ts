import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectProject, readText } from './detect';
import { guidanceFindings } from './guidance';
import { readKit } from './kit';
import { bridgeDefinition, bridgeReason } from './mcp-compat';
import { type Change, type Mcp, type Plan, type SetupRequest, SetupSchema } from './model';
import { ownedProject, rootIdentity } from './ownership';
import { MAX_PLAN_BYTES, MAX_PLAN_CHANGES, planFile } from './plan-limits';
import { projectMcpFile } from './project-config';
import { adapter, mergeMcp } from './providers';
import { effectiveRules, presetChain } from './recommend';
import { assertWritePath, checkedProject, hash, now, slug } from './safety';
import { skillOutputPath } from './skill-paths';
import type { Store } from './store';

const START = '<!-- kitfold:begin -->';
const END = '<!-- kitfold:end -->';
export function managedBlock(before: string | null, content: string): string {
  const block = `${START}\n${content.trim()}\n${END}`;
  if (!before) return `${block}\n`;
  const start = before.indexOf(START),
    end = before.indexOf(END);
  if (
    start < 0 !== end < 0 ||
    (end >= 0 && end < start) ||
    before.indexOf(START, start + START.length) >= 0
  )
    throw new Error('Malformed or duplicate Kitfold directive markers.');
  return start < 0
    ? `${before.trimEnd()}\n\n${block}\n`
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
        `Existing file differs: ${path}. Kitfold will not overwrite an unmanaged or locally modified skill.`,
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
    if (entry.mcp) {
      const name = slug(entry.name);
      if (selectedMcp[name] && JSON.stringify(selectedMcp[name]) !== JSON.stringify(entry.mcp))
        throw new Error(`Select one MCP variant for ${name}.`);
      selectedMcp[name] = entry.mcp;
      if (/\$\{/.test(JSON.stringify(entry.mcp)))
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
          `${spec.name} / ${name}: Kitfold MCP bridge required. ${reason} The kitfold command must be on your PATH.`,
        );
      } else compatibleMcp[name] = definition;
    }
    providerMcp[provider] = compatibleMcp;
    warnings.push(`${spec.name}: ${spec.note}`);
    if (!spec.skills) throw new Error(`${spec.name}: ${spec.note}`);
    for (const entry of entries.filter((entry) => entry.kind === 'skill')) {
      const files = store.files(entry.id);
      if (!files.length) throw new Error(`No snapshot available for ${entry.name}`);
      for (const file of files) {
        const content =
          file.path === 'SKILL.md'
            ? Buffer.from(portableSkill(entry.body, provider)).toString('base64')
            : file.content;
        await add(
          `${spec.skills}/${slug(entry.name)}/${file.path}`,
          content,
          `Install ${entry.name} for ${spec.name}`,
          false,
          file.executable,
        );
      }
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
      const before = await readText(await assertWritePath(projectPath, spec.instructions));
      const content =
        spec.instructions === 'CLAUDE.md' &&
        input.providers.some((value) =>
          ['codex', 'opencode', 'antigravity', 'grok', 'kiro'].includes(value),
        )
          ? '@AGENTS.md'
          : rules;
      await add(
        spec.instructions,
        Buffer.from(managedBlock(before ?? null, content)).toString('base64'),
        'Update Kitfold directive block; preserve authored text',
        true,
      );
    }
  }
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
  const manifest = `${JSON.stringify(
    {
      schemaVersion: 1,
      providers: input.providers,
      entries: entries.map((entry) => ({
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
  const plan: Plan = {
    id: randomUUID(),
    projectPath,
    providers: input.providers,
    entries: entries.map((entry) => entry.id),
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
  };
  store.put('plan', plan);
  store.event('setup.planned', `Prepared ${plan.changes.length} file changes for ${project.name}`);
  return plan;
}

export { executePlan } from './plan-io';
