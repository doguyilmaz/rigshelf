import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser';
import type { Mcp, Provider } from './model';

export interface Adapter {
  id: Provider;
  name: string;
  skills: string | null;
  instructions: string | null;
  mcpFile: string | null;
  mcpKey: string;
  format: 'json' | 'toml';
  note: string;
  docs: string;
}
export const adapters: Adapter[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    skills: '.claude/skills',
    instructions: 'CLAUDE.md',
    mcpFile: '.mcp.json',
    mcpKey: 'mcpServers',
    format: 'json',
    note: 'Project MCP servers may require approval. Restart or reload the session after setup.',
    docs: 'https://code.claude.com/docs/en/skills',
  },
  {
    id: 'codex',
    name: 'Codex',
    skills: '.agents/skills',
    instructions: 'AGENTS.md',
    mcpFile: '.codex/config.toml',
    mcpKey: 'mcp_servers',
    format: 'toml',
    note: 'Project configuration loads only in a trusted project. Start a new session after setup.',
    docs: 'https://developers.openai.com/codex/mcp/',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    skills: '.kiro/skills',
    instructions: 'AGENTS.md',
    mcpFile: '.kiro/settings/mcp.json',
    mcpKey: 'mcpServers',
    format: 'json',
    note: 'Uses project skills and shared AGENTS.md. Custom Kiro agents may need explicit resources. No automatic tool permissions are granted.',
    docs: 'https://kiro.dev/docs/configuration/',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    skills: '.agents/skills',
    instructions: 'AGENTS.md',
    mcpFile: 'opencode.json',
    mcpKey: 'mcp',
    format: 'json',
    note: 'Shared Agent Skills discovery; MCP converted to OpenCode local/remote definitions.',
    docs: 'https://opencode.ai/docs/mcp-servers/',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    skills: '.agents/skills',
    instructions: 'AGENTS.md',
    mcpFile: '.agents/mcp_config.json',
    mcpKey: 'mcpServers',
    format: 'json',
    note: 'Targets the current workspace format. Run /skills reload or start a new conversation.',
    docs: 'https://antigravity.google/docs/customization-discovery?tab=cli',
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    skills: '.grok/skills',
    instructions: 'AGENTS.md',
    mcpFile: '.grok/config.toml',
    mcpKey: 'mcp_servers',
    format: 'toml',
    note: 'Targets the official Grok CLI. In T3, choose the underlying harness; the selected model alone does not determine file discovery.',
    docs: 'https://docs.x.ai/build/features/skills-plugins-marketplaces',
  },
];
export function adapter(id: Provider): Adapter {
  return adapters.find((value) => value.id === id)!;
}
export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function readConfig(
  text: string,
  format: Adapter['format'] | 'jsonc',
): Record<string, unknown> {
  if (format !== 'jsonc') return object(format === 'toml' ? parseToml(text) : JSON.parse(text));
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length)
    throw new Error('Invalid JSONC configuration. Resolve its syntax before setup.');
  return object(value);
}

const openCodeValue = (value: string): string =>
  value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '{env:$1}');
const canonicalValue = (value: string): string =>
  value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, '\u0024{$1}');
const stringMap = (input: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(object(input))
      .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
      .map(([name, value]) => [name, canonicalValue(value)]),
  );

export function renderMcp(mcp: Mcp, provider: Provider): Record<string, unknown> {
  const filters = mcp.allowedTools !== undefined || Boolean(mcp.deniedTools?.length);
  if (
    filters &&
    !['codex', 'antigravity'].includes(provider) &&
    !(provider === 'kiro' && mcp.allowedTools === undefined)
  )
    throw new Error('This tool filter requires the Rigshelf MCP bridge.');
  if (mcp.cwd && provider === 'opencode')
    throw new Error(
      'OpenCode adapter cannot preserve an MCP working directory. Use a wrapper command with an explicit working directory.',
    );
  if (provider === 'opencode')
    return mcp.transport === 'stdio'
      ? {
          type: 'local',
          command: [openCodeValue(mcp.command!), ...mcp.args.map(openCodeValue)],
          ...(Object.keys(mcp.env).length
            ? {
                environment: Object.fromEntries(
                  Object.entries(mcp.env).map(([name, value]) => [name, openCodeValue(value)]),
                ),
              }
            : {}),
          enabled: true,
        }
      : {
          type: 'remote',
          url: openCodeValue(mcp.url!),
          ...(Object.keys(mcp.headers).length
            ? {
                headers: Object.fromEntries(
                  Object.entries(mcp.headers).map(([name, value]) => [name, openCodeValue(value)]),
                ),
              }
            : {}),
          enabled: true,
        };
  if (provider === 'codex') {
    if (mcp.transport === 'sse')
      throw new Error(
        'Codex adapter does not translate SSE to HTTP. Use a supported HTTP endpoint.',
      );
    const env: Record<string, string> = {};
    const envVars: string[] = [];
    for (const [name, value] of Object.entries(mcp.env)) {
      const variable = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
      if (variable) {
        if (variable[1] !== name)
          throw new Error(
            `Codex cannot rename inherited environment variable ${variable[1]} to ${name}.`,
          );
        envVars.push(name);
      } else if (value.includes('${'))
        throw new Error('Codex environment values cannot contain interpolated placeholders.');
      else env[name] = value;
    }
    const headers: Record<string, string> = {};
    const envHeaders: Record<string, string> = {};
    let bearerToken: string | undefined;
    for (const [name, value] of Object.entries(mcp.headers)) {
      const variable = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
      const bearer =
        name.toLowerCase() === 'authorization'
          ? value.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
          : undefined;
      if (bearer) bearerToken = bearer[1];
      else if (variable) envHeaders[name] = variable[1];
      else if (value.includes('${'))
        throw new Error('Codex headers need a whole-value environment placeholder.');
      else headers[name] = value;
    }
    return mcp.transport === 'stdio'
      ? {
          command: mcp.command,
          args: mcp.args,
          ...(mcp.cwd ? { cwd: mcp.cwd } : {}),
          ...(Object.keys(env).length ? { env } : {}),
          ...(envVars.length ? { env_vars: envVars } : {}),
          ...(mcp.allowedTools !== undefined ? { enabled_tools: mcp.allowedTools } : {}),
          ...(mcp.deniedTools?.length ? { disabled_tools: mcp.deniedTools } : {}),
        }
      : {
          url: mcp.url,
          ...(Object.keys(headers).length ? { http_headers: headers } : {}),
          ...(Object.keys(envHeaders).length ? { env_http_headers: envHeaders } : {}),
          ...(bearerToken ? { bearer_token_env_var: bearerToken } : {}),
          ...(mcp.allowedTools !== undefined ? { enabled_tools: mcp.allowedTools } : {}),
          ...(mcp.deniedTools?.length ? { disabled_tools: mcp.deniedTools } : {}),
        };
  }
  if (provider === 'grok')
    return mcp.transport === 'stdio'
      ? {
          command: mcp.command,
          args: mcp.args,
          ...(mcp.cwd ? { cwd: mcp.cwd } : {}),
          ...(Object.keys(mcp.env).length ? { env: mcp.env } : {}),
        }
      : { url: mcp.url, ...(Object.keys(mcp.headers).length ? { headers: mcp.headers } : {}) };
  if (mcp.transport === 'stdio')
    return {
      command: mcp.command,
      args: mcp.args,
      ...(mcp.cwd ? { cwd: mcp.cwd } : {}),
      ...(Object.keys(mcp.env).length ? { env: mcp.env } : {}),
      ...(provider === 'antigravity' && mcp.allowedTools !== undefined
        ? { enabledTools: mcp.allowedTools }
        : {}),
      ...(mcp.deniedTools?.length ? { disabledTools: mcp.deniedTools } : {}),
    };
  const urlKey = provider === 'antigravity' ? 'serverUrl' : 'url';
  return {
    ...(provider === 'claude' ? { type: mcp.transport } : {}),
    [urlKey]: mcp.url,
    ...(Object.keys(mcp.headers).length ? { headers: mcp.headers } : {}),
    ...(provider === 'antigravity' && mcp.allowedTools !== undefined
      ? { enabledTools: mcp.allowedTools }
      : {}),
    ...(mcp.deniedTools?.length ? { disabledTools: mcp.deniedTools } : {}),
  };
}

export function mergeMcp(
  before: string | null,
  provider: Provider,
  selected: Record<string, Mcp>,
  previouslyManaged: Record<string, Mcp> = {},
): string {
  const spec = adapter(provider);
  const config = before ? readConfig(before, provider === 'opencode' ? 'jsonc' : spec.format) : {};
  const servers = { ...object(config[spec.mcpKey]) };
  for (const [name, previous] of Object.entries(previouslyManaged))
    if (!(name in selected) && name in servers) {
      if (!isDeepStrictEqual(servers[name], renderMcp(previous, provider)))
        throw new Error(`Managed MCP '${name}' was locally edited. Resolve it before removal.`);
      delete servers[name];
    }
  for (const [name, mcp] of Object.entries(selected)) {
    const rendered = renderMcp(mcp, provider);
    if (
      name in servers &&
      !isDeepStrictEqual(servers[name], rendered) &&
      (!previouslyManaged[name] ||
        !isDeepStrictEqual(servers[name], renderMcp(previouslyManaged[name], provider)))
    )
      throw new Error(
        `MCP '${name}' already exists with different settings in ${spec.mcpFile}. Resolve the conflict first.`,
      );
    servers[name] = rendered;
  }
  config[spec.mcpKey] = servers;
  if (provider === 'opencode' && before) {
    let output = before;
    const previous = object(readConfig(before, 'jsonc')[spec.mcpKey]);
    for (const name of new Set([...Object.keys(previous), ...Object.keys(servers)])) {
      if (isDeepStrictEqual(previous[name], servers[name])) continue;
      output = applyEdits(
        output,
        modify(output, [spec.mcpKey, name], servers[name], {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    }
    return output;
  }
  return spec.format === 'toml'
    ? stringifyToml(config as Parameters<typeof stringifyToml>[0])
    : `${JSON.stringify(config, null, 2)}\n`;
}

export function canonicalMcp(raw: unknown): Mcp | undefined {
  const input = object(raw);
  if (
    (input.environment_id !== undefined && input.environment_id !== 'local') ||
    input.http_headers_helper !== undefined ||
    input.oauth !== undefined ||
    input.authProviderType !== undefined ||
    (input.auth !== undefined && input.auth !== 'oauth')
  )
    throw new Error(
      'This MCP uses native execution or authentication features that cannot be imported portably. Keep its native configuration.',
    );
  if (
    input.type !== undefined &&
    !['local', 'remote', 'stdio', 'http', 'sse'].includes(String(input.type))
  )
    throw new Error('Unsupported native MCP transport. Keep the native configuration.');
  const environmentNames = (Array.isArray(input.env_vars) ? input.env_vars : []).map(
    (value: unknown) => {
      if (typeof value === 'string') return value;
      const reference = object(value);
      if (typeof reference.name === 'string' && reference.source === 'local') return reference.name;
      throw new Error(
        'Remote or unknown MCP environment references cannot be imported as local variables. Keep the native configuration.',
      );
    },
  );
  const command = Array.isArray(input.command) ? input.command : undefined;
  const url = input.url || input.serverUrl;
  const allowed = input.allowedTools ?? input.enabledTools ?? input.enabled_tools;
  const denied = input.deniedTools ?? input.disabledTools ?? input.disabled_tools;
  const filters = {
    ...(Array.isArray(allowed)
      ? { allowedTools: allowed.filter((value): value is string => typeof value === 'string') }
      : {}),
    ...(Array.isArray(denied)
      ? { deniedTools: denied.filter((value): value is string => typeof value === 'string') }
      : {}),
  };
  if (typeof url === 'string') {
    const headers = stringMap(input.headers || input.http_headers);
    for (const [name, variable] of Object.entries(object(input.env_http_headers)))
      if (typeof variable === 'string') headers[name] = `\${${variable}}`;
    if (typeof input.bearer_token_env_var === 'string')
      headers.Authorization = `Bearer \${${input.bearer_token_env_var}}`;
    return {
      transport: input.type === 'sse' ? 'sse' : 'http',
      url: canonicalValue(url),
      args: [],
      env: {},
      headers,
      ...filters,
    };
  }
  if (typeof input.command === 'string' || (command && typeof command[0] === 'string'))
    return {
      transport: 'stdio',
      command: canonicalValue(command ? String(command[0]) : String(input.command)),
      args: command
        ? command.slice(1).map((value) => canonicalValue(String(value)))
        : Array.isArray(input.args)
          ? input.args.map((value) => canonicalValue(String(value)))
          : [],
      env: {
        ...stringMap(input.env || input.environment),
        ...Object.fromEntries(environmentNames.map((name) => [name, `\${${name}}`])),
      },
      headers: {},
      ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}),
      ...filters,
    };
}
