import { fromJsonSchema, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { ApiError, ApiClient } from './client';
import { executeTool } from './tools/executor';
import type { ToolDefinition } from './tools/executor';
import { logToolCall } from './logging';

const DEFAULT_SERVER_NAME = 'beefchicken-mcp';
const DEFAULT_SERVER_DESCRIPTION = 'MCP server generated from an OpenAPI specification';

export interface ServerAuthInfo extends AuthInfo {
  env?: Record<string, string | undefined>;
}

export interface FactoryContext {
  authInfo?: ServerAuthInfo;
  fetchImpl?: typeof fetch;
  tools: ToolDefinition[];
}

export function createServer({ authInfo, fetchImpl, tools }: FactoryContext): McpServer {
  const baseUrl = readEnv('API_BASE_URL', authInfo?.env);
  const apiKey = (authInfo?.extra?.apiKey as string | undefined) ?? authInfo?.token;
  const client = apiKey && baseUrl ? new ApiClient(baseUrl, apiKey, fetchImpl) : null;

  const server = new McpServer({
    name: readEnv('MCP_SERVER_NAME', authInfo?.env) ?? DEFAULT_SERVER_NAME,
    version: '0.1.1',
    description: readEnv('MCP_SERVER_DESCRIPTION', authInfo?.env) ?? DEFAULT_SERVER_DESCRIPTION,
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
      },
      async (input) => {
        if (!client) {
          logToolCall({ tool: tool.name, authenticated: Boolean(apiKey), ok: false, durationMs: 0 });
          return {
            content: [
              {
                type: 'text',
                text: !apiKey
                  ? 'API key is required. Provide it via the Authorization header.'
                  : 'Server misconfiguration: API_BASE_URL is not set.',
              },
            ],
            isError: true,
          };
        }
        const startedAt = Date.now();
        try {
          const result = await executeTool(client, tool, input as Record<string, unknown>);
          logToolCall({ tool: tool.name, authenticated: true, ok: true, durationMs: Date.now() - startedAt });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          logToolCall({
            tool: tool.name,
            authenticated: true,
            ok: false,
            httpStatus: error instanceof ApiError ? error.status : undefined,
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      }
    );
  }

  return server;
}

function readEnv(name: string, env?: Record<string, string | undefined>): string | undefined {
  return env?.[name] ?? (typeof process !== 'undefined' ? process.env[name] : undefined);
}
