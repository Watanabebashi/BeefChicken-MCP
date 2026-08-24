import type { ApiClient } from '../client';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  endpoint: { method: string; path: string };
  paramMapping: Record<string, { in: string; name: string }>;
  hasBody: boolean;
}

export async function executeTool(
  client: ApiClient,
  tool: ToolDefinition,
  input: Record<string, unknown>
): Promise<unknown> {
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, unknown> = {};
  const bodyFields: [string, unknown][] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    const mapping = tool.paramMapping[key];
    if (mapping) {
      if (mapping.in === 'path') {
        pathParams[mapping.name] = String(value);
      } else if (mapping.in === 'query') {
        queryParams[mapping.name] = value;
      }
    } else {
      bodyFields.push([key, value]);
    }
  }

  if (!tool.hasBody && bodyFields.length > 0) {
    throw new Error(
      `Tool "${tool.name}" does not accept a request body, but received unexpected field(s): ` +
        bodyFields.map(([key]) => key).join(', ')
    );
  }

  let path = tool.endpoint.path;
  for (const [key, value] of Object.entries(pathParams)) {
    path = path.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  const unresolvedPlaceholder = path.match(/\{[^}]*\}/);
  if (unresolvedPlaceholder) {
    throw new Error(
      `Tool "${tool.name}" is missing required path parameter "${unresolvedPlaceholder[0]}" for ${tool.endpoint.path}`
    );
  }

  const body = bodyFields.length > 0 ? Object.fromEntries(bodyFields) : undefined;

  return client.request(tool.endpoint.method, path, { query: queryParams, body });
}
