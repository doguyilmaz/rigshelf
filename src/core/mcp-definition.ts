import { type Mcp, McpSchema } from './model';
import { redact } from './safety';

export const SENSITIVE_MCP_ENV_KEY =
  /api.?key|access.?key|token|secret|password|authorization|credential|cookie|private.?key/i;
const CREDENTIAL_FLAG = /^--?[\w-]*(?:token|secret|password|key|auth|authorization|credential)s?$/i;
const INLINE_CREDENTIAL_FLAG =
  /(--?[\w-]*(?:token|secret|password|key|auth|authorization|credential)s?=)(.*)/i;
const COMMAND_CREDENTIAL =
  /((?:^|\s)--?[\w-]*(?:token|secret|password|key|auth|authorization|credential)s?(?:=|\s+))("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/gi;
const CREDENTIAL_QUERY =
  /^(?:api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token|password|secret|key|authorization|credentials?|cookie|private[_-]?key|signature|sig)$/i;
const PUBLIC_HEADER = /^(?:accept|content-type|x-region|mcp-protocol-version)$/i;
const PUBLIC_ENV =
  /^(?:NODE_ENV|BUN_ENV|MODE|LOG_LEVEL|DEBUG|PORT|TZ|LANG|LC_ALL|NO_COLOR|FORCE_COLOR|CI|MCP_TRANSPORT|MCP_PORT|MCP_HOST)$/i;
const SECRET_REFERENCE = '${RIGSHELF_SECRET}';

export function isMcpReference(value: string): boolean {
  return /^(?:Bearer )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
}

function credentialValue(value: string): string {
  return isMcpReference(value) ? value : SECRET_REFERENCE;
}

function queryKey(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function maskQueries(value: string): string {
  return value.replace(
    /([?&])([^=&#\s]+)=([^&#\s]*)/g,
    (match, separator: string, key: string, content: string) =>
      CREDENTIAL_QUERY.test(queryKey(key))
        ? `${separator}${key}=${credentialValue(content)}`
        : match,
  );
}

function credentialText(value: string): string {
  const masked = maskQueries(value).replace(
    COMMAND_CREDENTIAL,
    (_match, prefix: string, content: string) => {
      const quote = content.startsWith('"') || content.startsWith("'") ? content[0]! : '';
      const plain = quote ? content.slice(1, -1) : content;
      return `${prefix}${quote}${credentialValue(plain)}${quote}`;
    },
  );
  return redact(masked);
}

function maskArgument(value: string, previous: string | undefined): string {
  if (isMcpReference(value)) return value;
  if (CREDENTIAL_FLAG.test(previous || '')) return SECRET_REFERENCE;
  return credentialText(value).replace(
    INLINE_CREDENTIAL_FLAG,
    (_match, prefix: string, content: string) => `${prefix}${credentialValue(content)}`,
  );
}

export function maskMcpCredentials(definition: Mcp): Mcp {
  return {
    ...definition,
    command: definition.command ? credentialText(definition.command) : undefined,
    args: definition.args.map((value, index) => maskArgument(value, definition.args[index - 1])),
    url: definition.url ? credentialText(definition.url) : undefined,
    env: Object.fromEntries(
      Object.entries(definition.env).map(([key, value]) => [
        key,
        SENSITIVE_MCP_ENV_KEY.test(key) && !isMcpReference(value) ? `\${${key}}` : redact(value),
      ]),
    ),
    headers: Object.fromEntries(
      Object.entries(definition.headers).map(([key, value]) => [
        key,
        isMcpReference(value)
          ? value
          : PUBLIC_HEADER.test(key)
            ? redact(value)
            : `\${RIGSHELF_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}}`,
      ]),
    ),
  };
}

export function sanitizeMcpDefinition(definition: Mcp): Mcp {
  const safe = maskMcpCredentials(definition);
  return {
    ...safe,
    env: Object.fromEntries(
      Object.entries(safe.env).map(([key, value]) => [
        key,
        isMcpReference(value) || PUBLIC_ENV.test(key) || value.includes('${')
          ? value
          : `\${${key}}`,
      ]),
    ),
  };
}

export function checkedMcpDefinition(body: string): Mcp {
  const definition = McpSchema.strict().parse(JSON.parse(body));
  if (
    JSON.stringify(maskMcpCredentials(definition)) !== JSON.stringify(definition) ||
    redact(body) !== body
  )
    throw new Error(
      'MCP definitions must use environment placeholders for credentials. Create a reviewed replacement snapshot.',
    );
  return definition;
}

export function maskedMcpBody(body: string): string {
  try {
    const definition = McpSchema.strict().parse(JSON.parse(body));
    const safe = maskMcpCredentials(definition);
    return redact(
      JSON.stringify(safe) === JSON.stringify(definition) ? body : JSON.stringify(safe, null, 2),
    );
  } catch {
    // Malformed historical definitions remain inspectable through the bounded text masker.
  }
  return credentialText(body);
}
