import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createNodeApp } from '../src/node';

async function pkcePair() {
  const verifier = 'test-code-verifier-1234567890123456789012345678901234567890';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString('base64url');
  return { verifier, challenge };
}

const ENV_KEYS = [
  'HOST',
  'ALLOWED_HOSTS',
  'ALLOWED_ORIGINS',
  'PUBLIC_URL',
  'OAUTH_ALLOWED_REDIRECT_URIS',
  'OAUTH_ENCRYPTION_KEY',
  'OAUTH_DB_PATH',
  'API_BASE_URL',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe('createNodeApp', () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it('does not require ALLOWED_HOSTS for the default localhost HOST', async () => {
    await expect(createNodeApp()).resolves.toBeDefined();
  });

  it('throws when HOST is 0.0.0.0 without ALLOWED_HOSTS', async () => {
    process.env.HOST = '0.0.0.0';
    await expect(createNodeApp()).rejects.toThrow(/ALLOWED_HOSTS must be set/);
  });

  it('throws when PUBLIC_URL is not https', async () => {
    process.env.PUBLIC_URL = 'http://example.com';
    await expect(createNodeApp()).rejects.toThrow(/must be https/);
  });

  it('throws when PUBLIC_URL is set but OAUTH_ALLOWED_REDIRECT_URIS is empty', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    await expect(createNodeApp()).rejects.toThrow(/OAUTH_ALLOWED_REDIRECT_URIS/);
  });

  it('throws when PUBLIC_URL is set but OAUTH_ENCRYPTION_KEY is missing', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    await expect(createNodeApp()).rejects.toThrow(/OAUTH_ENCRYPTION_KEY must be set/);
  });

  it('serves /mcp with a raw bearer token when PUBLIC_URL is unset', async () => {
    const { app } = await createNodeApp();
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer test_key',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(200);
  });

  it('allows a request whose Origin matches ALLOWED_ORIGINS', async () => {
    process.env.ALLOWED_ORIGINS = 'allowed.example.com';
    const { app } = await createNodeApp();
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        origin: 'https://allowed.example.com',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer test_key',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(200);
  });

  it('rejects a request whose Origin is not in ALLOWED_ORIGINS', async () => {
    process.env.ALLOWED_ORIGINS = 'allowed.example.com';
    const { app } = await createNodeApp();
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        origin: 'https://evil.example.com',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer test_key',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(403);
  });

  it('wires up the OAuth routes and SQLite store when PUBLIC_URL is set', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    process.env.OAUTH_ENCRYPTION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    process.env.OAUTH_DB_PATH = ':memory:';

    const { app } = await createNodeApp();
    const response = await app.request('/register', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://client.example/callback'] }),
    });
    expect(response.status).toBe(201);
  });

  it('rejects /mcp without a bearer token when PUBLIC_URL (OAuth) is set', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    process.env.OAUTH_ENCRYPTION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    process.env.OAUTH_DB_PATH = ':memory:';

    const { app } = await createNodeApp();
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('returns protected-resource metadata when PUBLIC_URL is set', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    process.env.OAUTH_ENCRYPTION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    process.env.OAUTH_DB_PATH = ':memory:';

    const { app } = await createNodeApp();
    const response = await app.request('/.well-known/oauth-protected-resource/mcp', { headers: { host: '127.0.0.1' } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://example.com/mcp');
    expect(body.authorization_servers).toContain('https://example.com');
  });

  it('rejects a malformed OAUTH_ENCRYPTION_KEY at startup', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    process.env.OAUTH_ENCRYPTION_KEY = 'not-valid-base64!!!';

    await expect(createNodeApp()).rejects.toThrow();
  });

  it('completes the full OAuth flow and successfully calls /mcp with the issued access token', async () => {
    process.env.PUBLIC_URL = 'https://example.com';
    process.env.OAUTH_ALLOWED_REDIRECT_URIS = 'https://client.example/callback';
    process.env.OAUTH_ENCRYPTION_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    process.env.OAUTH_DB_PATH = ':memory:';
    process.env.API_BASE_URL = 'https://api.example.com';

    const { app } = await createNodeApp();
    const redirectUri = 'https://client.example/callback';

    const registerRes = await app.request('/register', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    });
    const { client_id } = (await registerRes.json()) as { client_id: string };

    const { verifier, challenge } = await pkcePair();

    const authorizeUrl = new URL('http://127.0.0.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', 'xyz');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    const getAuthRes = await app.request(authorizeUrl.pathname + authorizeUrl.search, {
      headers: { host: '127.0.0.1' },
    });
    expect(getAuthRes.status).toBe(200);
    const setCookie = getAuthRes.headers.get('set-cookie') ?? '';
    const csrfToken = setCookie.match(/oauth_csrf=([^;]+)/)?.[1];
    expect(csrfToken).toBeTruthy();

    const form = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'real_target_api_key',
      csrf_token: csrfToken!,
    });
    const postAuthRes = await app.request('/authorize', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `oauth_csrf=${csrfToken}`,
      },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(postAuthRes.status).toBe(302);
    const location = new URL(postAuthRes.headers.get('location')!);
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id,
    });
    const tokenRes = await app.request('/token', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    expect(tokenRes.status).toBe(200);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    const mcpRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpBody = await mcpRes.text();
    expect(mcpBody).toContain('tasks_get');
  });
});
