import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import packageJson from '../package.json';

const read = async (path: string) => JSON.parse(await Bun.file(path).text());

test('the agent plugin matches the released version and runs the read/plan MCP server', async () => {
  const manifest = await read('plugin/plugin.json');
  expect(manifest.name).toBe('rigshelf');
  expect(manifest.version).toBe(packageJson.version);
  const codex = (await read('plugin/mcp.json')).mcpServers.rigshelf;
  const claude = (await read('plugin/.mcp.json')).mcpServers.rigshelf;
  expect({ command: codex.command, args: codex.args }).toEqual({
    command: 'rigshelf',
    args: ['mcp'],
  });
  expect(claude).toEqual({ command: 'rigshelf', args: ['mcp'] });
});

test('both marketplaces publish the same plugin folder and the bundled skill is named for it', async () => {
  const claude = await read('.claude-plugin/marketplace.json');
  const codex = await read('.agents/plugins/marketplace.json');
  expect(claude.plugins).toEqual([
    expect.objectContaining({ name: 'rigshelf', source: './plugin' }),
  ]);
  expect(codex.plugins).toEqual([
    expect.objectContaining({ name: 'rigshelf', source: { source: 'local', path: './plugin' } }),
  ]);
  const skill = await Bun.file('plugin/skills/rigshelf/SKILL.md').text();
  const frontmatter = parseYaml(skill.split('---')[1]);
  expect(frontmatter.name).toBe('rigshelf');
  expect(frontmatter.description.length).toBeLessThanOrEqual(300);
});
