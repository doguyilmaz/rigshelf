import { type ParseError, parse as parseJsonc } from 'jsonc-parser';
import { readConfig } from './providers';

export class McpInventoryError extends Error {}
function syntaxError(text: string, format: 'json' | 'jsonc' | 'toml'): McpInventoryError {
  if (format === 'toml')
    return new McpInventoryError(
      'MCP configuration has invalid TOML syntax; previous observations retained.',
    );
  const errors: ParseError[] = [];
  parseJsonc(text, errors, {
    allowTrailingComma: format === 'jsonc',
    disallowComments: format === 'json',
  });
  const offset = errors[0]?.offset;
  if (offset === undefined)
    return new McpInventoryError(
      'MCP configuration has invalid JSON syntax; previous observations retained.',
    );
  const line = text.slice(0, offset).split('\n').length;
  const column = offset - text.lastIndexOf('\n', offset - 1);
  return new McpInventoryError(
    `MCP syntax error at line ${line}, column ${column}; previous observations retained.`,
  );
}
/** Parser diagnostics contain positions only, never source text or raw exception messages. */
export function readInventoryMcpConfig(
  text: string,
  format: 'json' | 'jsonc' | 'toml',
): Record<string, unknown> {
  if (!text.trim()) {
    if (format === 'toml') return {};
    throw new McpInventoryError(
      'Empty MCP configuration; no definitions read and previous observations retained.',
    );
  }
  try {
    if (format !== 'toml') {
      const errors: ParseError[] = [];
      const raw: unknown =
        format === 'json'
          ? JSON.parse(text)
          : parseJsonc(text, errors, { allowTrailingComma: true });
      if (errors.length) throw syntaxError(text, format);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new McpInventoryError(
          'MCP configuration must be an object; previous observations retained.',
        );
      return raw as Record<string, unknown>;
    }
    return readConfig(text, format);
  } catch (error) {
    if (error instanceof McpInventoryError) throw error;
    throw syntaxError(text, format);
  }
}
