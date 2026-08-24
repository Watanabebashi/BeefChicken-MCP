import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createOAuthRoutes,
  createTokenVerifier,
  isCleanHttpsUrl,
  type OAuthKvStore,
  type OAuthStores,
  type StoredAccessToken,
  type StoredAuthCode,
  type StoredClient,
  type StoredRefreshReplay,
  type StoredRefreshToken,
} from '../src/oauth';
import { importEncryptionKey, encryptSecret, decryptSecret } from '../src/oauthCrypto';

const TEST_ENCRYPTION_KEY_B64 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

class MemoryKvStore<V extends { expiresAt: number }> implements OAuthKvStore<V> {
  private map = new Map<string, V>();

  async get(key: string): Promise<V | undefined> {
    return this.map.get(key);
  }

  async set(key: string, value: V): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getAndDelete(key: string): Promise<V | undefined> {
    const value = this.map.get(key);
    this.map.delete(key);
    return value;
  }

  async countActive(now = Date.now()): Promise<number> {
    return [...this.map.values()].filter((v) => v.expiresAt >= now).length;
  }

  async sweepExpired(now = Date.now()): Promise<void> {
    for (const [key, value] of this.map) {
      if (value.expiresAt < now) this.map.delete(key);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}

function makeStores() {
  return {
    clients: new MemoryKvStore<StoredClient>(),
    authCodes: new MemoryKvStore<StoredAuthCode>(),
    accessTokens: new MemoryKvStore<StoredAccessToken>(),
    refreshTokens: new MemoryKvStore<StoredRefreshToken>(),
    refreshReplays: new MemoryKvStore<StoredRefreshReplay>(),
  } satisfies OAuthStores;
}

const REDIRECT_URI = 'https://client.example/callback';
const ALLOWED = new Set([REDIRECT_URI]);

async function pkcePair() {
  const verifier = 'test-code-verifier-1234567890123456789012345678901234567890';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString('base64url');
  return { verifier, challenge };
}

async function registerClient(app: ReturnType<typeof createOAuthRoutes>) {
  const res = await app.request('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
  });
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

async function getAuthorizeCsrfToken(app: ReturnType<typeof createOAuthRoutes>, clientId: string, challenge: string) {
  const url = new URL('http://localhost/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('state', 'xyz');
  url.searchParams.set('code_challenge', challenge);

  const res = await app.request(url.pathname + url.search);
  expect(res.status).toBe(200);
  const setCookieHeader = res.headers.get('set-cookie') ?? '';
  const match = setCookieHeader.match(/oauth_csrf=([^;]+)/);
  if (!match) {
    throw new Error('GET /authorize did not set the oauth_csrf cookie');
  }
  return match[1];
}

async function issueAuthCode(app: ReturnType<typeof createOAuthRoutes>, clientId: string, challenge: string) {
  const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
  const form = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: 'xyz',
    code_challenge: challenge,
    api_key: 'test_api_key',
    csrf_token: csrfToken,
  });
  const res = await app.request('/authorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `oauth_csrf=${csrfToken}`,
    },
    body: form.toString(),
    redirect: 'manual',
  });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  return location.searchParams.get('code')!;
}

async function exchangeCode(
  app: ReturnType<typeof createOAuthRoutes>,
  clientId: string,
  code: string,
  verifier: string
) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    client_id: clientId,
  });
  return app.request('/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

describe('isCleanHttpsUrl', () => {
  it('accepts plain https urls', () => {
    expect(isCleanHttpsUrl('https://example.com/cb')).toBe(true);
  });

  it('rejects non-https and userinfo-bearing urls', () => {
    expect(isCleanHttpsUrl('http://example.com/cb')).toBe(false);
    expect(isCleanHttpsUrl('https://user:pass@example.com/cb')).toBe(false);
    expect(isCleanHttpsUrl('not a url')).toBe(false);
  });
});

describe('OAuth token endpoint', () => {
  let stores: ReturnType<typeof makeStores>;
  let app: ReturnType<typeof createOAuthRoutes>;
  let encryptionKey: CryptoKey;

  beforeEach(async () => {
    stores = makeStores();
    encryptionKey = await importEncryptionKey(TEST_ENCRYPTION_KEY_B64);
    app = createOAuthRoutes(ALLOWED, stores, encryptionKey);
  });

  it('rejects registration with disallowed redirect_uris', async () => {
    const res = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects registration with no redirect_uris at all', async () => {
    const res = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('rejects registration with an unparseable JSON body', async () => {
    const res = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('completes the authorization_code + PKCE flow', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const res = await exchangeCode(app, clientId, code, verifier);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it('rejects token exchange with a mismatched PKCE verifier', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const res = await exchangeCode(app, clientId, code, 'wrong-verifier');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects POST /authorize with no CSRF cookie/token at all', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'test_api_key',
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  });

  it('rejects POST /authorize when the CSRF cookie and form token mismatch', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'test_api_key',
      csrf_token: 'attacker-supplied-wrong-token',
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `oauth_csrf=${csrfToken}`,
      },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  });

  it('does not extend client TTL on GET /authorize (only on a successful login)', async () => {
    vi.useFakeTimers();
    try {
      const clientId = await registerClient(app);
      const { challenge } = await pkcePair();
      const before = await stores.clients.get(clientId);

      await getAuthorizeCsrfToken(app, clientId, challenge);
      const afterGet = await stores.clients.get(clientId);
      expect(afterGet!.expiresAt).toBe(before!.expiresAt);

      vi.advanceTimersByTime(1);
      await issueAuthCode(app, clientId, challenge);
      const afterSuccessfulLogin = await stores.clients.get(clientId);
      expect(afterSuccessfulLogin!.expiresAt).toBeGreaterThan(before!.expiresAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects POST /authorize with a completely empty form body', async () => {
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it('rejects POST /authorize for an unknown client_id', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: 'no-such-client',
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'test_api_key',
      csrf_token: csrfToken,
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `oauth_csrf=${csrfToken}` },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it("rejects POST /authorize when redirect_uri is not one of the client's registered URIs", async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://not-registered.example/callback',
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'test_api_key',
      csrf_token: csrfToken,
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `oauth_csrf=${csrfToken}` },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it('rejects POST /authorize with a missing code_challenge', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: '',
      api_key: 'test_api_key',
      csrf_token: csrfToken,
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `oauth_csrf=${csrfToken}` },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it('rejects POST /authorize for an already-expired client', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const client = await stores.clients.get(clientId);
    await stores.clients.set(clientId, { ...client!, expiresAt: Date.now() - 1000 });

    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: 'test_api_key',
      csrf_token: csrfToken,
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `oauth_csrf=${csrfToken}`,
      },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  });

  it('sets Cache-Control: no-store on /token and /authorize responses', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const tokenRes = await exchangeCode(app, clientId, code, verifier);
    expect(tokenRes.headers.get('cache-control')).toBe('no-store');

    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'xyz');
    url.searchParams.set('code_challenge', challenge);
    const authorizeRes = await app.request(url.pathname + url.search);
    expect(authorizeRes.headers.get('cache-control')).toBe('no-store');
    expect(authorizeRes.headers.get('referrer-policy')).toBe('no-referrer');
    expect(authorizeRes.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('revokes the prior access token when a refresh token is redeemed', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const firstPair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as {
      access_token: string;
      refresh_token: string;
    };

    expect(stores.accessTokens.has(firstPair.access_token)).toBe(true);

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: firstPair.refresh_token,
      client_id: clientId,
    });
    const refreshRes = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(refreshRes.status).toBe(200);
    const secondPair = (await refreshRes.json()) as { access_token: string };

    expect(secondPair.access_token).not.toBe(firstPair.access_token);
    expect(stores.accessTokens.has(firstPair.access_token)).toBe(false);
    expect(stores.accessTokens.has(secondPair.access_token)).toBe(true);
  });

  it('replays the same response for a repeated refresh_token from the same client', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const firstPair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as {
      refresh_token: string;
    };

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: firstPair.refresh_token,
      client_id: clientId,
    });
    const requestOnce = () =>
      app.request('/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

    const first = (await (await requestOnce()).json()) as { access_token: string };
    const second = (await (await requestOnce()).json()) as { access_token: string };
    expect(second.access_token).toBe(first.access_token);
  });

  it('never persists the API key in plaintext', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const pair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as {
      access_token: string;
      refresh_token: string;
    };

    const storedAccessToken = await stores.accessTokens.get(pair.access_token);
    const storedRefreshToken = await stores.refreshTokens.get(pair.refresh_token);
    expect(storedAccessToken).toBeDefined();
    expect(storedRefreshToken).toBeDefined();
    expect(storedAccessToken!.encryptedApiKey).not.toContain('test_api_key');
    expect(storedRefreshToken!.encryptedApiKey).not.toContain('test_api_key');

    await expect(decryptSecret(encryptionKey, storedAccessToken!.encryptedApiKey)).resolves.toBe('test_api_key');
    await expect(decryptSecret(encryptionKey, storedRefreshToken!.encryptedApiKey)).resolves.toBe('test_api_key');
  });

  it('rejects a refresh_token grant with the refresh_token field entirely absent', async () => {
    const clientId = await registerClient(app);
    const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a refresh_token grant with the client_id field entirely absent', async () => {
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'irrelevant-token' });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a refresh_token grant with an unknown refresh token', async () => {
    const clientId = await registerClient(app);
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'no-such-refresh-token',
      client_id: clientId,
    });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a refresh_token grant with an expired refresh token', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const pair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as { refresh_token: string };
    const record = await stores.refreshTokens.get(pair.refresh_token);
    await stores.refreshTokens.set(pair.refresh_token, { ...record!, expiresAt: Date.now() - 1000 });

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: pair.refresh_token,
      client_id: clientId,
    });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a first-time refresh_token exchange from a client_id that does not match the token record', async () => {
    const clientId = await registerClient(app);
    const otherClientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const pair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as { refresh_token: string };

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: pair.refresh_token,
      client_id: otherClientId,
    });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a replayed refresh_token presented by a different client_id', async () => {
    const clientId = await registerClient(app);
    const otherClientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const firstPair = (await (await exchangeCode(app, clientId, code, verifier)).json()) as {
      refresh_token: string;
    };

    const refreshOnce = (client: string) => {
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: firstPair.refresh_token,
        client_id: client,
      });
      return app.request('/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    };

    await refreshOnce(clientId);
    const replayFromOtherClient = await refreshOnce(otherClientId);
    expect(replayFromOtherClient.status).toBe(400);
    const body = (await replayFromOtherClient.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects registration once the active client limit is reached', async () => {
    const now = Date.now();
    for (let i = 0; i < 1000; i++) {
      await stores.clients.set(`prefilled-${i}`, { redirectUris: [REDIRECT_URI], expiresAt: now + 60_000 });
    }

    const res = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('temporarily_unavailable');
  });

  it('re-renders the login form with an error when api_key is empty', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const csrfToken = await getAuthorizeCsrfToken(app, clientId, challenge);
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state: 'xyz',
      code_challenge: challenge,
      api_key: '',
      csrf_token: csrfToken,
    });
    const res = await app.request('/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `oauth_csrf=${csrfToken}` },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('APIキーを入力してください');
  });

  it('rejects /token with an expired authorization code', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);
    const record = await stores.authCodes.get(code);
    await stores.authCodes.set(code, { ...record!, expiresAt: Date.now() - 1000 });

    const res = await exchangeCode(app, clientId, code, 'irrelevant-verifier');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects /token when redirect_uri does not match the one used to issue the code', async () => {
    const clientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://different.example/callback',
      code_verifier: verifier,
      client_id: clientId,
    });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects /token when client_id does not match the one used to issue the code', async () => {
    const clientId = await registerClient(app);
    const otherClientId = await registerClient(app);
    const { verifier, challenge } = await pkcePair();
    const code = await issueAuthCode(app, clientId, challenge);

    const res = await exchangeCode(app, otherClientId, code, verifier);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects /token for authorization_code with all identifying fields absent', async () => {
    const form = new URLSearchParams({ grant_type: 'authorization_code' });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects /token with an unsupported grant_type', async () => {
    const form = new URLSearchParams({ grant_type: 'password', username: 'a', password: 'b' });
    const res = await app.request('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unsupported_grant_type');
  });

  it('rejects GET /authorize when required parameters are missing', async () => {
    const clientId = await registerClient(app);
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    const res = await app.request(url.pathname + url.search);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it('rejects GET /authorize for an unknown client_id', async () => {
    const { challenge } = await pkcePair();
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'no-such-client');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'xyz');
    url.searchParams.set('code_challenge', challenge);
    const res = await app.request(url.pathname + url.search);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_client');
  });

  it('rejects GET /authorize with a non-code response_type', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'xyz');
    url.searchParams.set('code_challenge', challenge);
    const res = await app.request(url.pathname + url.search);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_request');
  });

  it('rejects GET /authorize with an unsupported code_challenge_method', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'xyz');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'plain');
    const res = await app.request(url.pathname + url.search);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('unsupported code_challenge_method');
  });

  it('rejects GET /authorize for an already-expired client', async () => {
    const clientId = await registerClient(app);
    const { challenge } = await pkcePair();
    const client = await stores.clients.get(clientId);
    await stores.clients.set(clientId, { ...client!, expiresAt: Date.now() - 1000 });

    const url = new URL('http://localhost/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'xyz');
    url.searchParams.set('code_challenge', challenge);
    const res = await app.request(url.pathname + url.search);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid_client');
  });
});

describe('createTokenVerifier', () => {
  let accessTokens: MemoryKvStore<StoredAccessToken>;
  let encryptionKey: CryptoKey;

  beforeEach(async () => {
    accessTokens = new MemoryKvStore<StoredAccessToken>();
    encryptionKey = await importEncryptionKey(TEST_ENCRYPTION_KEY_B64);
  });

  it('rejects an unknown token', async () => {
    const verifier = createTokenVerifier(accessTokens, encryptionKey);
    await expect(verifier.verifyAccessToken('no-such-token')).rejects.toThrow(/unknown, expired, or revoked/);
  });

  it('rejects and deletes an expired token', async () => {
    const encryptedApiKey = await encryptSecret(encryptionKey, 'expired_api_key');
    await accessTokens.set('expired-token', { encryptedApiKey, clientId: 'c1', expiresAt: Date.now() - 1000 });

    const verifier = createTokenVerifier(accessTokens, encryptionKey);
    await expect(verifier.verifyAccessToken('expired-token')).rejects.toThrow(/unknown, expired, or revoked/);
    expect(accessTokens.has('expired-token')).toBe(false);
  });

  it('resolves the decrypted API key for a valid token', async () => {
    const encryptedApiKey = await encryptSecret(encryptionKey, 'live_api_key');
    await accessTokens.set('valid-token', { encryptedApiKey, clientId: 'c1', expiresAt: Date.now() + 60_000 });

    const verifier = createTokenVerifier(accessTokens, encryptionKey);
    const authInfo = await verifier.verifyAccessToken('valid-token');
    expect(authInfo.clientId).toBe('c1');
    expect(authInfo.extra?.apiKey).toBe('live_api_key');
  });

  it('rejects (as invalid_token, not a raw crash) and deletes a token that fails to decrypt under the current key', async () => {
    const otherKey = await importEncryptionKey(
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
    );
    const encryptedUnderOtherKey = await encryptSecret(otherKey, 'live_api_key');
    await accessTokens.set('rotated-token', {
      encryptedApiKey: encryptedUnderOtherKey,
      clientId: 'c1',
      expiresAt: Date.now() + 60_000,
    });

    const verifier = createTokenVerifier(accessTokens, encryptionKey);
    await expect(verifier.verifyAccessToken('rotated-token')).rejects.toMatchObject({ code: 'invalid_token' });
    expect(accessTokens.has('rotated-token')).toBe(false);
  });
});
