export type ScanDiagnosticCategory = 'incomplete' | 'unreadable' | 'empty' | 'excluded';
export interface ScanDiagnostic {
  category: ScanDiagnosticCategory;
  code:
    | 'plugin-limit'
    | 'project-limit'
    | 'limit'
    | 'mcp-empty'
    | 'mcp-syntax'
    | 'unreadable'
    | 'excluded';
  path?: string;
  detail: string;
  line?: number;
  column?: number;
}
/** Legacy string receipts remain readable; this view never changes the recorded scan. */
export function scanDiagnostics(messages: string[]): ScanDiagnostic[] {
  return [...new Set(messages)].map((message) => {
    const index = message.lastIndexOf(': ');
    const hasPath = index > 0 && /^(?:\/|~[/\\]|[A-Z]:[/\\])/.test(message);
    const path = hasPath ? message.slice(0, index) : undefined;
    const detail = hasPath ? message.slice(index + 2) : message;
    if (/^Empty MCP configuration/.test(detail))
      return { category: 'empty', code: 'mcp-empty', path, detail };
    const syntax = /MCP syntax error at line (\d+), column (\d+)/.exec(detail);
    if (syntax || /MCP configuration has invalid .* syntax/.test(detail))
      return {
        category: 'unreadable',
        code: 'mcp-syntax',
        path,
        detail,
        line: syntax ? Number(syntax[1]) : undefined,
        column: syntax ? Number(syntax[2]) : undefined,
      };
    if (
      /invalid|unavailable|could not|unsupported|not rediscovered|must be an object/i.test(detail)
    )
      return { category: 'unreadable', code: 'unreadable', path, detail };
    if (/excluded/i.test(detail)) return { category: 'excluded', code: 'excluded', path, detail };
    return {
      category: 'incomplete',
      code: /Plugin discovery limit/.test(detail)
        ? 'plugin-limit'
        : /AI directory discovery limit|Nested AI discovery depth/.test(detail)
          ? 'project-limit'
          : 'limit',
      path,
      detail,
    };
  });
}
