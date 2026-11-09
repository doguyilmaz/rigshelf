import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (process.env.RIGSHELF_TEST_START_MARKER)
  await Bun.write(process.env.RIGSHELF_TEST_START_MARKER, 'started');

const server = new McpServer({ name: 'rigshelf-test-server', version: '1.0.0' });
server.tool(
  'echo',
  'Echo dummy data and environment visibility for a local fixture.',
  { message: z.string() },
  async ({ message }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          message,
          token: process.env.TOKEN || '',
          ambient: process.env.RIGSHELF_UNDECLARED_SECRET || '',
        }),
      },
    ],
  }),
);
server.tool('admin', 'Must not be exposed by a filtered bridge.', {}, async () => ({
  content: [{ type: 'text' as const, text: 'not allowed' }],
}));
await server.connect(new StdioServerTransport());
