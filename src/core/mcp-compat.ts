import type { Mcp, Provider } from './model';

export function bridgeReason(definition: Mcp, provider: Provider): string | undefined {
  const filters = definition.allowedTools !== undefined || Boolean(definition.deniedTools?.length);
  if (
    filters &&
    !['codex', 'antigravity'].includes(provider) &&
    !(provider === 'kiro' && definition.allowedTools === undefined)
  )
    return 'Preserve the server’s tool allow/deny rules.';
  if (definition.transport === 'sse' && !['claude', 'opencode'].includes(provider))
    return 'Preserve SSE transport without pretending it is Streamable HTTP.';
  if (!['codex', 'antigravity'].includes(provider) && definition.cwd)
    return 'Preserve the local server working directory.';
  if (provider === 'antigravity' && JSON.stringify(definition).includes('${'))
    return 'Resolve environment placeholders without relying on undocumented interpolation.';
  if (provider === 'codex') {
    if (
      [definition.command, definition.url, definition.cwd, ...definition.args].some((value) =>
        value?.includes('${'),
      )
    )
      return 'Resolve placeholders in command, arguments, URL or working directory.';
    for (const [name, value] of Object.entries(definition.env))
      if (value.includes('${') && value !== `\${${name}}`)
        return 'Preserve renamed or composed environment references.';
    for (const [name, value] of Object.entries(definition.headers))
      if (
        value.includes('${') &&
        !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) &&
        !(
          name.toLowerCase() === 'authorization' &&
          /^Bearer \$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)
        )
      )
        return 'Resolve a composed HTTP header from the runtime environment.';
  }
}

export function bridgeDefinition(path: string): Mcp {
  return {
    transport: 'stdio',
    command: 'rigshelf',
    args: ['mcp-proxy', '--file', path],
    env: {},
    headers: {},
  };
}

export function referencedEnvironment(definition: Mcp): string[] {
  const fields =
    definition.transport === 'stdio'
      ? [
          definition.command || '',
          definition.cwd || '',
          ...definition.args,
          ...Object.values(definition.env),
        ]
      : [definition.url || '', ...Object.values(definition.headers)];
  return [
    ...new Set(
      [...fields.join('\n').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]),
    ),
  ];
}

function expandEnvironment(value: string, environment: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const replacement = environment[name];
    if (replacement === undefined)
      throw new Error(`Required environment variable is missing: ${name}`);
    return replacement;
  });
}

export function resolveDefinition(
  input: Mcp,
  environment: Record<string, string | undefined>,
): Mcp {
  const expand = (value: string) => {
    const result = expandEnvironment(value, environment);
    if (result.includes('${'))
      throw new Error('An environment value contains an unresolved placeholder.');
    return result;
  };
  const local = input.transport === 'stdio';
  const url = !local && input.url ? expand(input.url) : undefined;
  if (url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error('Resolved MCP endpoints must use HTTP(S) without embedded credentials.');
  }
  return {
    ...input,
    command: local && input.command ? expand(input.command) : undefined,
    url,
    cwd: local && input.cwd ? expand(input.cwd) : undefined,
    args: local ? input.args.map(expand) : [],
    env: Object.fromEntries(
      (local ? Object.entries(input.env) : []).map(([name, value]) => [name, expand(value)]),
    ),
    headers: Object.fromEntries(
      (!local ? Object.entries(input.headers) : []).map(([name, value]) => [name, expand(value)]),
    ),
  };
}
