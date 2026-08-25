import { describe, it, expect } from 'vitest';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer, type ServerAuthInfo } from '../src/server';
import toolsJson from '../src/generated/tools.json';
import type { ToolDefinition } from '../src/tools/executor';
import packageJson from '../package.json';

const TEST_BASE_URL = 'https://api.example.com';
const tools = toolsJson as ToolDefinition[];

function makeHandler(fetchImpl?: typeof fetch) {
  return createMcpHandler((ctx) => createServer({ authInfo: ctx.authInfo as ServerAuthInfo, fetchImpl, tools }), {
    responseMode: 'json',
  });
}

async function post(handler: ReturnType<typeof makeHandler>, body: object, token?: string) {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const authInfo: ServerAuthInfo | undefined = token
    ? { token, clientId: '', scopes: [], env: { API_BASE_URL: TEST_BASE_URL } }
    : undefined;
  return handler.fetch(request, authInfo ? { authInfo } : undefined);
}

function parseSse(text: string): unknown {
  const lines = text.split('\n');
  const dataLine = lines.find((line) => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error('No data line in SSE response');
  }
  return JSON.parse(dataLine.slice('data: '.length));
}

describe('MCP server', () => {
  it('reports the server version from package.json instead of a hardcoded value', async () => {
    const handler = makeHandler();
    const response = await post(
      handler,
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      },
      'test_key'
    );
    expect(response.status).toBe(200);
    const payload = parseSse(await response.text()) as { result: { serverInfo: { version: string } } };
    expect(payload.result.serverInfo.version).toBe(packageJson.version);
  });

  it('lists tools', async () => {
    const handler = makeHandler();
    const response = await post(handler, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'test_key');
    expect(response.status).toBe(200);
    const payload = parseSse(await response.text()) as { result: { tools: Array<{ name: string }> } };
    expect(payload.result.tools.some((tool) => tool.name === 'tasks_get')).toBe(true);
  });

  it('calls tasks_get and forwards query params to the target API', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init: init ?? {} });
      return new Response(JSON.stringify([{ id: 1, title: 'Work' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const handler = makeHandler(fetchImpl);
    const response = await post(
      handler,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'tasks_get', arguments: { completed: false } },
      },
      'test_key'
    );

    expect(response.status).toBe(200);
    const payload = parseSse(await response.text()) as { result: { content: Array<{ text: string }> } };
    expect(payload.result.content[0].text).toContain('Work');
    expect(requests[0].url).toBe(`${TEST_BASE_URL}/tasks?completed=false`);
  });

  it('calls tasks_post with body fields', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ id: 1, title: 'Work' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const handler = makeHandler(fetchImpl);
    const response = await post(
      handler,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'tasks_post', arguments: { title: 'Work' } },
      },
      'test_key'
    );

    expect(response.status).toBe(200);
    const payload = parseSse(await response.text()) as { result: { content: Array<{ text: string }> } };
    expect(payload.result.content[0].text).toContain('Work');
    expect(requests[0].url).toBe(`${TEST_BASE_URL}/tasks`);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ title: 'Work' });
  });

  it('lists tools without an API key but rejects tool calls', async () => {
    const handler = makeHandler();
    const listResponse = await post(handler, { jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(listResponse.status).toBe(200);

    const callResponse = await post(handler, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'tasks_get', arguments: { completed: false } },
    });
    expect(callResponse.status).toBe(200);
    const payload = parseSse(await callResponse.text()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('API key is required');
  });

  it('rejects unauthenticated tool calls even when DEFAULT_API_KEY is set on the server process', async () => {
    const previous = process.env.DEFAULT_API_KEY;
    process.env.DEFAULT_API_KEY = 'operator_key';
    try {
      const handler = makeHandler();
      const callResponse = await post(handler, {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'tasks_get', arguments: { completed: false } },
      });
      expect(callResponse.status).toBe(200);
      const payload = parseSse(await callResponse.text()) as {
        result: { isError: boolean; content: Array<{ text: string }> };
      };
      expect(payload.result.isError).toBe(true);
      expect(payload.result.content[0].text).toContain('API key is required');
    } finally {
      if (previous === undefined) {
        delete process.env.DEFAULT_API_KEY;
      } else {
        process.env.DEFAULT_API_KEY = previous;
      }
    }
  });

  it('reports misconfiguration when API_BASE_URL is missing but an API key is present', async () => {
    const handler = makeHandler();
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'tasks_get', arguments: { completed: false } },
      }),
    });
    const authInfo: ServerAuthInfo = { token: 'test_key', clientId: '', scopes: [] };
    const response = await handler.fetch(request, { authInfo });
    expect(response.status).toBe(200);
    const payload = parseSse(await response.text()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('API_BASE_URL is not set');
  });
});
