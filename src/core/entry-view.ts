import { maskedMcpBody } from './mcp-definition';
import type { Entry } from './model';

export function entryMetadata(entry: Omit<Entry, 'body'>): Omit<Entry, 'body' | 'mcp'> {
  const { mcp: _definition, ...metadata } = entry;
  return metadata;
}

export function entryView(entry: Entry): Omit<Entry, 'mcp'> {
  return {
    ...entryMetadata(entry),
    body: entry.kind === 'mcp' ? maskedMcpBody(entry.body) : entry.body,
  };
}
