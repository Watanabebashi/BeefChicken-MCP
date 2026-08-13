import { describe, it, expect } from 'vitest';
import app from '../src/index';
import { createFakeD1Database } from './helpers/fakeD1';

const TEST_BASE_URL = 'https://api.example.com';
const PUBLIC_URL = 'https://mcp.example.com';
const REDIRECT_URI = 'https://client.example/callback';

async function importTestEncryptionKey(): Promise<string> {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

async function pkcePair() {
  const verifier = 'test-code-verifier-1234567890123456789012345678901234567890';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString('base64url');
  return { verifier, challenge };
}

describe('Workers entrypoint (index.ts)', () => {
  it('serves /mcp with a raw bearer token when PUBLIC_URL is unset', async () => {
    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer test_key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      { API_BASE_URL: TEST_BASE_URL }
    );
    expect(response.status).toBe(200);
  });

  it('reports misconfiguration on /mcp when PUBLIC_URL is set without OAUTH_DB/OAUTH_ENCRYPTION_KEY', async () => {
    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      { PUBLIC_URL }
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('OAUTH_DB');
  });

  it('reports misconfiguration on the OAuth metadata endpoint when misconfigured', async () => {
    const response = await app.request('/.well-known/oauth-authorization-server', {}, { PUBLIC_URL });
    expect(response.status).toBe(500);
  });

  it('returns 404 for the OAuth metadata endpoints when PUBLIC_URL is entirely unset', async () => {
    const authServerRes = await app.request('/.well-known/oauth-authorization-server', {}, {});
    expect(authServerRes.status).toBe(404);
    const protectedResourceRes = await app.request('/.well-known/oauth-protected-resource/mcp', {}, {});
    expect(protectedResourceRes.status).toBe(404);
  });

  it('returns 404 for /register when PUBLIC_URL is unset', async () => {
    const response = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      {}
    );
    expect(response.status).toBe(404);
  });

  it('serves /mcp with an empty token when no Authorization header is sent and PUBLIC_URL is unset', async () => {
    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      { API_BASE_URL: TEST_BASE_URL }
    );
    expect(response.status).toBe(200);
  });

  it('reports server misconfiguration on /register when OAUTH_ENCRYPTION_KEY is malformed', async () => {
    const env = {
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: 'not-valid-base64!!!',
      OAUTH_DB: createFakeD1Database(),
    };
    const response = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      env
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Server misconfiguration');
  });

  it('reports a 500 on /register when PUBLIC_URL is not https', async () => {
    const env = {
      PUBLIC_URL: 'http://mcp.example.com',
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };
    const response = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      env
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('must be https');
  });

  it('reports a 500 on /register when OAUTH_ALLOWED_REDIRECT_URIS is not configured', async () => {
    const env = {
      PUBLIC_URL,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };
    const response = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      env
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('OAUTH_ALLOWED_REDIRECT_URIS is not configured');
  });

  it('wires up the D1-backed OAuth routes when fully configured', async () => {
    const env = {
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };

    const response = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      env
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { client_id: string };
    expect(body.client_id).toBeTruthy();
  });

  it('returns OAuth authorization server metadata when fully configured', async () => {
    const env = {
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };

    const response = await app.request('/.well-known/oauth-authorization-server', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { issuer: string };
    expect(body.issuer).toBe(PUBLIC_URL);
  });

  it('rejects /mcp without a bearer token when OAuth is fully configured', async () => {
    const env = {
      API_BASE_URL: TEST_BASE_URL,
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };

    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      env
    );
    expect(response.status).toBe(401);
  });

  it('returns protected-resource metadata when fully configured', async () => {
    const env = {
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };

    const response = await app.request('/.well-known/oauth-protected-resource/mcp', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://mcp.example.com/mcp');
    expect(body.authorization_servers).toContain(PUBLIC_URL);
  });

  it('reports misconfiguration on the protected-resource metadata endpoint when misconfigured', async () => {
    const response = await app.request('/.well-known/oauth-protected-resource/mcp', {}, { PUBLIC_URL });
    expect(response.status).toBe(500);
  });

  it('reports server misconfiguration on /mcp when OAUTH_ENCRYPTION_KEY is malformed', async () => {
    const env = {
      API_BASE_URL: TEST_BASE_URL,
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: 'not-valid-base64!!!',
      OAUTH_DB: createFakeD1Database(),
    };

    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer whatever',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      env
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Server misconfiguration');
  });

  it('completes the full OAuth flow and successfully calls /mcp with the issued access token', async () => {
    const env = {
      API_BASE_URL: TEST_BASE_URL,
      PUBLIC_URL,
      OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT_URI,
      OAUTH_ENCRYPTION_KEY: await importTestEncryptionKey(),
      OAUTH_DB: createFakeD1Database(),
    };

    const registerRes = await app.request(
      '/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      },
      env
    );
    const { client_id } = (await registerRes.json()) as { client_id: string };

    const { verifier, challenge } = await pkcePair();

    const authorizeUrl = new URL('http://localhost/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client_id);
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authorizeUrl.searchParams.set('state', 'xyz');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    const getAuthRes = await app.request(authorizeUrl.pathname + authorizeUrl.search, {}, env);
    expect(getAuthRes.status).toBe(200);
    const setCookie = getAuthRes.headers.get('set-cookie') ?? '';
    const csrfToken = setCookie.match(/oauth_csrf=([^;]+)/)?.[1];
    expect(csrfToken).toBeTruthy();

    const form = new URLSearchParams({
      client_id,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'real_target_api_key',
      csrf_token: csrfToken!,
    });
    const postAuthRes = await app.request(
      '/authorize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `oauth_csrf=${csrfToken}` },
        body: form.toString(),
        redirect: 'manual',
      },
      env
    );
    expect(postAuthRes.status).toBe(302);
    const location = new URL(postAuthRes.headers.get('location')!);
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      client_id,
    });
    const tokenRes = await app.request(
      '/token',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenForm.toString() },
      env
    );
    expect(tokenRes.status).toBe(200);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    const mcpRes = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
      env
    );
    expect(mcpRes.status).toBe(200);
    const mcpBody = await mcpRes.text();
    expect(mcpBody).toContain('tasks_get');
  });
});
