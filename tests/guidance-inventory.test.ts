import { afterEach, expect, test } from 'bun:test';
import { mkdir, rename, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { documentChoices } from '../src/core/document-index';
import { documentPlan, projectDocument } from '../src/core/documents';
import { projectAiContexts } from '../src/core/guidance-inventory';
import { memoryProjectPaths } from '../src/core/memory-locations';
import { scan } from '../src/core/scanner';
import { fixture } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const data = await fixture();
  cleanups.push(data.cleanup);
  await Bun.write(join(data.project, 'package.json'), '{}');
  return data;
}
async function write(path: string, text = 'Project guidance, not session history.') {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, text);
}
const skill =
  '---\nname: focused-guide\ndescription: Use this guide for focused work.\n---\n\nRead the relevant code first.\n';

test('ignored AI directories and nested guidance are inventoried while dependencies and transcripts are excluded', async () => {
  const data = await setup();
  await write(join(data.project, '.gitignore'), '*');
  for (const path of [
    '.claude/rules/team.md',
    '.kiro/steering/mobile.md',
    '.cursor/rules/ui.mdc',
    'packages/mobile/AGENTS.md',
    '.aims/memory/MEMORY.md',
  ])
    await write(join(data.project, path));
  await write(join(data.project, 'packages/mobile/.agents/skills/focused/SKILL.md'), skill);
  await write(
    join(data.project, 'examples/server/.mcp.json'),
    JSON.stringify({ mcpServers: { focused: { command: 'example-server' } } }),
  );
  for (const path of [
    'node_modules/package/AGENTS.md',
    'Pods/Library/CLAUDE.md',
    '.git/AGENTS.md',
    '.claude/sessions/MEMORY.md',
  ])
    await write(join(data.project, path), 'DO NOT INVENTORY THIS TRANSCRIPT OR DEPENDENCY');
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const project = data.store.projects()[0]!;
  expect(project.documents).toContain('.claude/rules/team.md');
  expect(project.documents).toContain('packages/mobile/AGENTS.md');
  expect(project.documents).toContain('.aims/memory/MEMORY.md');
  expect(project.documentLocations).toHaveLength(5);
  expect(
    data.store
      .entries()
      .filter((entry) => entry.kind === 'skill')
      .map((entry) => entry.name),
  ).toEqual(['focused-guide']);
  expect(
    data.store.installations().some((item) => item.path.includes('examples/server/.mcp.json')),
  ).toBe(true);
  expect(JSON.stringify(project)).not.toContain('node_modules');
  expect(JSON.stringify(project)).not.toContain('sessions');
});

test('Claude project memory matches its full directory identity, not another project with the same name', async () => {
  const data = await setup();
  const key = data.project.replace(/[^a-zA-Z0-9]/g, '-');
  const other = join(data.root, 'different-parent', 'project').replace(/[^a-zA-Z0-9]/g, '-');
  await write(join(data.home, '.claude/projects', key, 'memory/MEMORY.md'));
  await write(join(data.home, '.claude/projects', key, 'memory/feedback.md'));
  await write(join(data.home, '.claude/projects', other, 'memory/wrong-project.md'));
  await write(join(data.home, '.claude/projects', key, 'conversation.jsonl'), 'DO NOT COLLECT');
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const files = data.store.projects()[0]!.documentLocations!;
  expect(files.map((file) => file.path).sort()).toEqual(['MEMORY.md', 'feedback.md']);
  expect(files.every((file) => file.scope === 'user-project' && file.readOnly)).toBe(true);
});

test('aims profiles add private AI roots and deduplicate shared memory/skill aliases without reading account data', async () => {
  const data = await setup();
  const profile = join(data.home, '.aims/profiles/claude/work');
  const codex = join(data.home, '.aims/profiles/codex/work');
  const key = data.project.replace(/[^a-zA-Z0-9]/g, '-');
  await write(join(data.home, '.claude/skills/focused/SKILL.md'), skill);
  await write(join(data.home, '.claude/projects', key, 'memory/MEMORY.md'));
  await mkdir(profile, { recursive: true });
  await symlink(join(data.home, '.claude/skills'), join(profile, 'skills'));
  await symlink(join(data.home, '.claude/projects'), join(profile, 'projects'));
  await write(join(codex, 'rules/team.rules'));
  await write(join(codex, 'auth.json'), 'INVALID JSON: ACCOUNT AUTH MUST NOT BE READ');
  await write(join(profile, '.credentials.json'), 'INVALID JSON: CREDENTIALS MUST NOT BE READ');
  await write(join(data.home, '.aims/sessions/AGENTS.md'), 'DO NOT COLLECT SESSION CONTENT');
  const result = await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(result.skipped).toHaveLength(0);
  expect(data.store.installations().filter((item) => item.provider === 'claude')).toHaveLength(1);
  const files = data.store.projects()[0]!.documentLocations!;
  expect(files.filter((file) => file.scope === 'user-project')).toHaveLength(1);
  expect(files.find((file) => file.scope === 'user-project')?.aliases).toHaveLength(1);
  expect(files.some((file) => file.sourcePath === join(codex, 'rules/team.rules'))).toBe(true);
  expect(JSON.stringify(data.store.entries())).not.toContain('ACCOUNT AUTH');
});

test('external memory is lazy, redacted and read-only, and replacement locations require a rescan', async () => {
  const data = await setup();
  const key = data.project.replace(/[^a-zA-Z0-9]/g, '-');
  const memory = join(data.home, '.claude/projects', key, 'memory/MEMORY.md');
  await write(memory, 'Use the shared project conventions.\nAPI_TOKEN="dummy-sensitive-token"');
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects()[0]!;
  const file = project.documentLocations![0]!;
  expect(JSON.stringify(project)).not.toContain('dummy-sensitive-token');
  const document = await projectDocument(data.store, {
    projectId: project.id,
    documentId: file.id,
  });
  expect(document.readOnly).toBe(true);
  expect(document.redacted).toBe(true);
  expect(document.content).not.toContain('dummy-sensitive-token');
  await expect(
    documentPlan(data.store, {
      projectId: project.id,
      documentId: file.id,
      digest: document.digest,
      content: 'Changed',
    }),
  ).rejects.toThrow('read-only');
  await expect(
    projectDocument(data.store, { projectId: project.id, path: memory }),
  ).rejects.toThrow('inventory');
  await rename(dirname(memory), `${dirname(memory)}-previous`);
  await write(memory, 'A replacement directory must not inherit the old read reference.');
  // The directory path is unchanged; the referenced file path is still the same. Replacing the file
  // alone is allowed for a fresh read, while replacing the inventoried root is refused below.
  const root = file.root;
  await rename(root, `${root}-previous`);
  await mkdir(root, { recursive: true });
  await expect(
    projectDocument(data.store, { projectId: project.id, documentId: file.id }),
  ).rejects.toThrow('changed');
});

test('symlinks cannot turn guidance or skill discovery into credential, transcript or dependency reads', async () => {
  const data = await setup();
  await write(join(data.home, '.claude/auth.json'), 'dummy auth store');
  await write(join(data.home, '.claude/sessions/history.md'), 'dummy conversation');
  await write(join(data.project, 'node_modules/package/skills/secret/SKILL.md'), skill);
  await mkdir(join(data.project, '.claude/rules'), { recursive: true });
  await mkdir(join(data.project, '.agents'), { recursive: true });
  await symlink(
    join(data.home, '.claude/auth.json'),
    join(data.project, '.claude/rules/auth-copy.md'),
  );
  await symlink(
    join(data.home, '.claude/sessions'),
    join(data.project, '.claude/rules/transcript-link'),
  );
  await symlink(
    join(data.project, 'node_modules/package/skills'),
    join(data.project, '.agents/skills'),
  );
  const result = await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(data.store.entries()).toHaveLength(0);
  expect(data.store.projects()[0]!.documentLocations).toHaveLength(0);
  expect(result.skipped.length).toBeGreaterThanOrEqual(3);
});

test('a nested project referenced by user-level MCP gets its own local AI inventory within selected roots', async () => {
  const data = await setup();
  const nested = join(data.project, 'examples/child');
  await write(join(nested, 'AGENTS.md'));
  await write(join(nested, '.agents/skills/focused/SKILL.md'), skill);
  await write(
    join(data.home, '.claude.json'),
    JSON.stringify({
      projects: { [nested]: { mcpServers: { echo: { command: 'example-server' } } } },
    }),
  );
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects().find((item) => item.path === nested)!;
  expect(project.discovery).toBe('files');
  expect(project.documents).toContain('AGENTS.md');
  expect(
    data.store
      .installations()
      .some((item) => item.projectId === project.id && item.path.endsWith('/focused')),
  ).toBe(true);
});

test('MCP references cannot follow a symlinked parent outside selected roots', async () => {
  const data = await setup();
  const outside = join(data.root, 'outside');
  await write(join(outside, 'child/AGENTS.md'), 'Unselected external guidance.');
  await write(join(outside, 'child/.agents/skills/focused/SKILL.md'), skill);
  await symlink(outside, join(data.project, 'linked-parent'));
  const referenced = join(data.project, 'linked-parent/child');
  await write(
    join(data.home, '.claude.json'),
    JSON.stringify({
      projects: { [referenced]: { mcpServers: { echo: { command: 'example-server' } } } },
    }),
  );
  const result = await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects().find((item) => item.path === referenced)!;
  expect(project.discovery).toBe('configuration');
  expect(project.documents).toEqual([]);
  expect(data.store.entries().some((entry) => entry.kind === 'skill')).toBe(false);
  expect(result.skipped.some((note) => note.includes('outside selected roots excluded'))).toBe(
    true,
  );
  await expect(
    projectDocument(data.store, { projectId: project.id, path: 'AGENTS.md' }),
  ).rejects.toThrow('not part of this project inventory');
});

test('retained alias inventory cannot bypass project-root checks by claiming global scope', async () => {
  const data = await setup();
  const outside = join(data.root, 'outside-retained');
  await write(join(outside, 'child/package.json'), '{}');
  await write(join(outside, 'child/AGENTS.md'), 'Keep this external fixture private.');
  await symlink(outside, join(data.project, 'retained-alias'));
  const reference = join(data.project, 'retained-alias/child');
  await scan(data.store, { roots: [reference], globals: false, home: data.home });
  const project = data.store.projects().find((item) => item.path === reference)!;
  const location = project.documentLocations!.find((file) => file.path === 'AGENTS.md')!;
  expect(location.scope).toBe('global');
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.get<typeof project>('project', project.id)?.documentLocations).toContainEqual(
    location,
  );
  await expect(
    projectDocument(data.store, { projectId: project.id, documentId: location.id }),
  ).rejects.toThrow('Use the resolved path');
  expect(await Bun.file(join(outside, 'child/AGENTS.md')).text()).toBe(
    'Keep this external fixture private.',
  );
});

test('trusted user memory overrides and project-local overrides are found, while repository-selected external directories are reported without reading', async () => {
  const data = await setup();
  const custom = join(data.root, 'my-memory');
  await write(join(custom, 'user-note.md'));
  await write(
    join(data.home, '.claude/settings.json'),
    JSON.stringify({ autoMemoryDirectory: custom, env: { TOKEN: 'do-not-store' } }),
  );
  await write(
    join(data.project, '.claude/settings.local.json'),
    JSON.stringify({ autoMemoryDirectory: join(data.project, '.notes') }),
  );
  await write(join(data.project, '.notes/project-note.md'));
  const outside = join(data.root, 'unapproved');
  await write(join(outside, 'private-note.md'));
  await write(
    join(data.project, '.claude/settings.json'),
    JSON.stringify({ autoMemoryDirectory: outside }),
  );
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const project = data.store.projects()[0]!;
  expect(
    project.documentLocations!.some((file) => file.sourcePath === join(custom, 'user-note.md')),
  ).toBe(true);
  expect(project.documentLocations!.some((file) => file.path === '.notes/project-note.md')).toBe(
    true,
  );
  expect(project.documentLocations!.some((file) => file.path.includes('private-note'))).toBe(false);
  expect(
    project.inventoryWarnings!.some((warning) => warning.includes('outside the inspected')),
  ).toBe(true);
  expect(JSON.stringify(project)).not.toContain('do-not-store');
});

test('worktrees and repository subdirectories share only a verified main-repository memory key', async () => {
  const data = await setup();
  const main = join(data.root, 'main-repo');
  const gitdir = join(main, '.git/worktrees/current');
  await write(join(data.project, '.git'), `gitdir: ${gitdir}\n`);
  await write(join(gitdir, 'gitdir'), `${join(data.project, '.git')}\n`);
  const nested = join(data.project, 'packages/child');
  await mkdir(nested, { recursive: true });
  expect(await memoryProjectPaths(nested)).toContain(main);
  await write(join(gitdir, 'gitdir'), '/unrelated/repo/.git\n');
  expect(await memoryProjectPaths(nested)).not.toContain(main);
});

test('a global-only rescan preserves legacy project-relative document choices', async () => {
  const data = await setup();
  await write(join(data.project, 'AGENTS.md'));
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  const project = data.store.projects()[0]!;
  delete project.documentLocations;
  data.store.put('project', project);
  await write(join(data.home, '.codex/AGENTS.md'));
  await scan(data.store, { roots: [], globals: true, home: data.home });
  const choices = documentChoices(data.store.projects()[0]!);
  expect(choices.filter((file) => file.scope === 'project').map((file) => file.path)).toContain(
    'AGENTS.md',
  );
  expect(choices.some((file) => file.scope === 'global')).toBe(true);
});

test('project-only refreshes retain previously inspected external and global guidance', async () => {
  const data = await setup();
  const key = data.project.replace(/[^a-zA-Z0-9]/g, '-');
  await write(join(data.project, 'AGENTS.md'));
  await write(join(data.home, '.claude/projects', key, 'memory/MEMORY.md'));
  await write(join(data.home, '.codex/AGENTS.md'));
  await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  const before = data.store.projects()[0]!.documentLocations!;
  await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.projects()[0]!.documentLocations).toEqual(before);
  await scan(data.store, { roots: [], globals: false, home: data.home });
  expect(data.store.projects()[0]!.documentLocations).toEqual(before);
});

test('explicit Claude config roots support a bounded memory-directory name without following a path override', async () => {
  const data = await setup();
  const config = join(data.home, 'custom-claude');
  await write(join(config, 'projects/custom-worktree/memory/team.md'));
  await write(join(config, 'skills/focused/SKILL.md'), skill);
  const options = {
    roots: [data.project],
    globals: true,
    home: data.home,
    environment: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: 'custom-worktree' },
  };
  await scan(data.store, options);
  expect(data.store.projects()[0]!.documentLocations!.map((file) => file.path)).toEqual([
    'team.md',
  ]);
  expect(data.store.entries().map((entry) => entry.name)).toEqual(['focused-guide']);
  await scan(data.store, {
    ...options,
    environment: { ...options.environment, CLAUDE_CODE_PROJECT_DIR_NAME: '../custom-worktree' },
  });
  expect(data.store.projects()[0]!.documentLocations).toHaveLength(0);
});

test('settings and MCP aliases cannot inspect private runtime or unrelated external targets', async () => {
  const data = await setup();
  await write(join(data.home, '.claude/sessions/current/settings.json'), 'DO NOT PARSE');
  await symlink(
    join(data.home, '.claude/sessions/current/settings.json'),
    join(data.home, '.claude/settings.json'),
  );
  await write(
    join(data.root, 'unapproved/.mcp.json'),
    JSON.stringify({ mcpServers: { excluded: { command: 'do-not-import' } } }),
  );
  await symlink(join(data.root, 'unapproved/.mcp.json'), join(data.project, '.mcp.json'));
  const result = await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(data.store.entries()).toHaveLength(0);
  expect(
    result.skipped.some((warning) => warning.includes('External settings link excluded')),
  ).toBe(true);
  expect(
    result.skipped.some((warning) =>
      warning.includes('Non-configuration or private target excluded'),
    ),
  ).toBe(true);
  expect(result.skipped.some((warning) => warning.includes('could not be read'))).toBe(false);
});

test('shared global skill roots never make session or account-store aliases eligible for import', async () => {
  const data = await setup();
  const runtime = join(data.home, '.claude/sessions/current');
  const account = join(data.home, '.ssh');
  await write(join(runtime, 'SKILL.md'), skill);
  await write(join(account, 'SKILL.md'), skill);
  await symlink(runtime, join(data.home, '.claude/skills'));
  await mkdir(join(data.home, '.codex'), { recursive: true });
  await symlink(account, join(data.home, '.codex/skills'));
  const result = await scan(data.store, { roots: [data.project], globals: true, home: data.home });
  expect(data.store.entries()).toHaveLength(0);
  expect(
    result.skipped.filter(
      (warning) =>
        warning.includes('skill target excluded') || warning.includes('skill link excluded'),
    ).length,
  ).toBeGreaterThanOrEqual(2);
});

test('large source trees report their discovery bound once instead of flooding partial-inventory diagnostics', async () => {
  const data = await setup();
  for (let start = 0; start < 4100; start += 50)
    await Promise.all(
      Array.from({ length: 50 }, (_, offset) =>
        mkdir(join(data.project, `source-${start + offset}`)),
      ),
    );
  const result = await projectAiContexts(data.project);
  expect(result.paths).toEqual([data.project]);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain('inventory is partial');
});

test('one invalid MCP definition does not hide the remaining servers or expose its raw credentials', async () => {
  const data = await setup();
  await write(
    join(data.project, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        invalid: { url: 'https://fixture:dummy-private-password@example.invalid/mcp' },
        valid: { command: 'fixture-server', env: { API_TOKEN: 'dummy-private-token' } },
      },
    }),
  );
  const result = await scan(data.store, { roots: [data.project], globals: false, home: data.home });
  expect(data.store.entries().map((entry) => entry.name)).toEqual(['valid']);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0]).toContain('other servers in this file were still inspected');
  expect(JSON.stringify(result)).not.toContain('dummy-private-password');
  expect(data.store.entry(data.store.entries()[0]!.id)!.mcp!.env.API_TOKEN).toBe('${API_TOKEN}');
});
