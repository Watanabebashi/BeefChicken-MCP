import { describe, it, expect } from 'vitest';
import { ApiError, ApiClient } from '../src/client';

describe('ApiClient', () => {
  it('sends Authorization header and query params', async () => {
    const requests: Request[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    const result = await client.request('GET', '/api/blocks', { query: { date: '2024-01-01' } });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.headers.get('Authorization')).toBe('Bearer test_key');
    expect(req.url).toBe('https://api.example.com/api/blocks?date=2024-01-01');
    expect(result).toEqual({ ok: true });
  });

  it('appends an array query param once per item under the same key', async () => {
    const requests: Request[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    await client.request('GET', '/api/blocks', { query: { tag: ['work', 'urgent'] } });

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].url);
    expect(url.searchParams.getAll('tag')).toEqual(['work', 'urgent']);
  });

  it('sends JSON body for POST requests', async () => {
    const requests: Request[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    await client.request('POST', '/api/blocks', { body: { title: 'Work', date: '2024-01-01' } });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(await req.json()).toEqual({ title: 'Work', date: '2024-01-01' });
  });

  it('handles 204 No Content responses', async () => {
    const fetchImpl = async (): Promise<Response> => new Response(null, { status: 204 });
    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    const result = await client.request('DELETE', '/api/blocks/1');
    expect(result).toBeNull();
  });

  it('refuses to request an absolute-URL path that would escape the base origin', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('{}', { status: 200 });
    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    await expect(client.request('GET', 'https://attacker.example/steal')).rejects.toThrow(/cross-origin/);
  });

  it('refuses to request a protocol-relative path that would escape the base origin', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('{}', { status: 200 });
    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    await expect(client.request('GET', '//attacker.example/steal')).rejects.toThrow(/cross-origin/);
  });

  it('throws an ApiError on non-ok responses without leaking the response body', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: 'bad request', internal_debug_info: 'sensitive' }), { status: 400 });
    const client = new ApiClient('https://api.example.com', 'test_key', fetchImpl);
    const error = await client.request('GET', '/api/blocks').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as Error).message).not.toContain('sensitive');
  });
});
