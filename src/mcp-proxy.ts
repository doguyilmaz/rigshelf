import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { brand } from './core/brand';
import { readText } from './core/detect';
import { referencedEnvironment, resolveDefinition } from './core/mcp-compat';
import { type Mcp, McpSchema } from './core/model';
import { safeRelative } from './core/safety';

const forwardedEnvironment = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'COMSPEC',
  'PATHEXT',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
];

async function findDefinition(path: string): Promise<{ definition: Mcp; projectRoot: string }> {
  if (isAbsolute(path))
    return {
      definition: McpSchema.parse(JSON.parse((await readText(path)) || '{}')),
      projectRoot: process.cwd(),
    };
  safeRelative(path);
  let current = process.cwd();
  while (true) {
    const text = await readText(join(current, path));
    if (text !== undefined)
      return { definition: McpSchema.parse(JSON.parse(text)), projectRoot: current };
    const parent = dirname(current);
    if (parent === current)
      throw new Error('MCP bridge definition was not found in this project or its parents.');
    current = parent;
  }
}

export function toolAllowed(definition: Mcp, name: string): boolean {
  return (
    !definition.deniedTools?.includes(name) &&
    (definition.allowedTools === undefined || definition.allowedTools.includes(name))
  );
}

export async function serveProxy(path: string): Promise<void> {
  const { definition, projectRoot } = await findDefinition(path);
  const expanded = resolveDefinition(definition, process.env);
  const environment: Record<string, string> = {};
  for (const name of [...forwardedEnvironment, ...referencedEnvironment(definition)])
    if (process.env[name] !== undefined) environment[name] = process.env[name]!;
  Object.assign(environment, expanded.env);
  const transport =
    expanded.transport === 'stdio'
      ? new StdioClientTransport({
          command: expanded.command!,
          args: expanded.args,
          env: environment,
          cwd: expanded.cwd ? resolve(projectRoot, expanded.cwd) : projectRoot,
          stderr: 'inherit',
        })
      : expanded.transport === 'sse'
        ? new SSEClientTransport(new URL(expanded.url!), {
            requestInit: { headers: expanded.headers },
            eventSourceInit: {
              fetch: (url, init) =>
                fetch(url, {
                  ...init,
                  headers: {
                    ...expanded.headers,
                    ...Object.fromEntries(new Headers(init?.headers).entries()),
                  },
                }),
            },
          })
        : new StreamableHTTPClientTransport(new URL(expanded.url!), {
            requestInit: { headers: expanded.headers },
          });
  const client = new Client({ name: `${brand.slug}-mcp-bridge`, version: '0.1.0' });
  await client.connect(transport);
  const capabilities = client.getServerCapabilities() || {};
  const server = new Server(
    { name: `${brand.slug}-mcp-bridge`, version: '0.1.0' },
    {
      capabilities: {
        ...(capabilities.tools ? { tools: {} } : {}),
        ...(capabilities.resources ? { resources: {} } : {}),
        ...(capabilities.prompts ? { prompts: {} } : {}),
      },
    },
  );
  registerHandlers(server, client, definition);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([client.close(), server.close()]);
  };
  server.onclose = () => {
    void close();
  };
  client.onclose = () => {
    void close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await close();
    throw error;
  }
}

function registerHandlers(server: Server, client: Client, definition: Mcp): void {
  const capabilities = client.getServerCapabilities() || {};
  if (capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const result = await client.listTools(request.params);
      return {
        ...result,
        tools: result.tools.filter((tool) => toolAllowed(definition, tool.name)),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!toolAllowed(definition, request.params.name))
        throw new McpError(
          ErrorCode.InvalidParams,
          'Tool is outside this MCP definition’s allowed set.',
        );
      return client.callTool(request.params);
    });
  }
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, async (request) =>
      client.listResources(request.params),
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) =>
      client.listResourceTemplates(request.params),
    );
    server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      client.readResource(request.params),
    );
  }
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async (request) =>
      client.listPrompts(request.params),
    );
    server.setRequestHandler(GetPromptRequestSchema, async (request) =>
      client.getPrompt(request.params),
    );
  }
}
