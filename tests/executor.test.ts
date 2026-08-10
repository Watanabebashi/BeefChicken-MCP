import { describe, it, expect } from 'vitest';
import { ApiClient } from '../src/client';
import { executeTool } from '../src/tools/executor';
import type { ToolDefinition } from '../src/tools/executor';

describe('executeTool', () => {
  it('maps path params, query params, and body fields', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response('{}', { status: 200 });
    };

    const client = new ApiClient('https://api.example.com', 'key', fetchImpl);
    const tool: ToolDefinition = {
      name: 'tasks_id_put',
      description: '',
      inputSchema: {},
      endpoint: { method: 'PUT', path: '/tasks/{id}' },
      paramMapping: {
        id: { in: 'path', name: 'id' },
        date: { in: 'query', name: 'date' },
      },
      hasBody: true,
    };

    await executeTool(client, tool, { id: 123, date: '2024-01-01', title: 'Updated' });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://api.example.com/tasks/123?date=2024-01-01');
    expect(calls[0].body).toEqual({ title: 'Updated' });
  });

  it('omits undefined values from query and body', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{}', { status: 200 });
    };

    const client = new ApiClient('https://api.example.com', 'key', fetchImpl);
    const tool: ToolDefinition = {
      name: 'tasks_get',
      description: '',
      inputSchema: {},
      endpoint: { method: 'GET', path: '/tasks' },
      paramMapping: { date: { in: 'query', name: 'date' } },
      hasBody: false,
    };

    await executeTool(client, tool, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/tasks');
    expect(calls[0].body).toBeUndefined();
  });
});
