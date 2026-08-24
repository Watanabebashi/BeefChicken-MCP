import { Buffer } from 'node:buffer';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type OAuthMetadata,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import { encryptSecret, decryptSecret } from './oauthCrypto';

const AUTH_CODE_TTL_MS = 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;
const CLIENT_TTL_MS = REFRESH_TOKEN_TTL_MS;
const REFRESH_REPLAY_GRACE_MS = 30_000;
const MAX_CLIENTS = 1000;
const CSRF_COOKIE_NAME = 'oauth_csrf';
const CSRF_COOKIE_TTL_S = 600;

export interface StoredClient {
  redirectUris: string[];
  expiresAt: number;
}

export interface StoredAuthCode {
  encryptedApiKey: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

export interface StoredAccessToken {
  encryptedApiKey: string;
  clientId: string;
  expiresAt: number;
}

export interface StoredRefreshToken {
  encryptedApiKey: string;
  clientId: string;
  expiresAt: number;
  accessToken: string;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface StoredRefreshReplay {
  responseBody: TokenPairResponse;
  clientId: string;
  expiresAt: number;
}

export interface OAuthKvStore<V extends { expiresAt: number }> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  getAndDelete(key: string): Promise<V | undefined>;
  countActive(now?: number): Promise<number>;
  sweepExpired(now?: number): Promise<void>;
}

export interface OAuthStores {
  clients: OAuthKvStore<StoredClient>;
  authCodes: OAuthKvStore<StoredAuthCode>;
  accessTokens: OAuthKvStore<StoredAccessToken>;
  refreshTokens: OAuthKvStore<StoredRefreshToken>;
  refreshReplays: OAuthKvStore<StoredRefreshReplay>;
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString('base64url');
}

async function pkceMatches(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const computed = Buffer.from(digest).toString('base64url');
  return constantTimeEqual(computed, codeChallenge);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createTokenVerifier(
  accessTokens: OAuthKvStore<StoredAccessToken>,
  encryptionKey: CryptoKey
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const record = await accessTokens.get(token);
      if (!record || record.expiresAt < Date.now()) {
        await accessTokens.delete(token);
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'access token is unknown, expired, or revoked');
      }
      const apiKey = await decryptSecret(encryptionKey, record.encryptedApiKey);
      const authInfo: AuthInfo = {
        token,
        clientId: record.clientId,
        scopes: [],
        expiresAt: Math.floor(record.expiresAt / 1000),
        extra: { apiKey },
      };
      return authInfo;
    },
  };
}

export function buildAuthorizationServerMetadata(issuer: URL): OAuthMetadata {
  const base = issuer.toString().replace(/\/$/, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

export function isCleanHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export function createOAuthRoutes(
  allowedRedirectUris: ReadonlySet<string>,
  stores: OAuthStores,
  encryptionKey: CryptoKey
): Hono {
  const app = new Hono();
  const { clients, authCodes, accessTokens, refreshTokens, refreshReplays } = stores;

  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('Pragma', 'no-cache');
  });

  app.post('/register', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const rawUris = (body as { redirect_uris?: unknown }).redirect_uris;
    const redirectUris = Array.isArray(rawUris) ? rawUris.filter((u): u is string => typeof u === 'string') : [];
    if (redirectUris.length === 0 || !redirectUris.every((u) => isCleanHttpsUrl(u) && allowedRedirectUris.has(u))) {
      return c.json(
        { error: 'invalid_client_metadata', error_description: 'redirect_uris must be https and pre-approved' },
        400
      );
    }
    await Promise.all([
      authCodes.sweepExpired(),
      accessTokens.sweepExpired(),
      refreshTokens.sweepExpired(),
      clients.sweepExpired(),
    ]);
    if ((await clients.countActive()) >= MAX_CLIENTS) {
      return c.json({ error: 'temporarily_unavailable', error_description: 'client registration limit reached' }, 429);
    }
    const clientId = randomToken(16);
    await clients.set(clientId, { redirectUris, expiresAt: Date.now() + CLIENT_TTL_MS });
    return c.json(
      {
        client_id: clientId,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      201
    );
  });

  app.get('/authorize', async (c) => {
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } = c.req.query();
    if (response_type !== 'code' || !client_id || !redirect_uri || !state || !code_challenge) {
      return c.text('invalid_request', 400);
    }
    if (code_challenge_method && code_challenge_method !== 'S256') {
      return c.text('unsupported code_challenge_method (S256 only)', 400);
    }
    const client = await clients.get(client_id);
    if (
      !client ||
      client.expiresAt < Date.now() ||
      !client.redirectUris.includes(redirect_uri) ||
      !allowedRedirectUris.has(redirect_uri)
    ) {
      return c.text('invalid_client', 400);
    }
    const csrfToken = randomToken(16);
    setCookie(c, CSRF_COOKIE_NAME, csrfToken, {
      path: '/authorize',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: CSRF_COOKIE_TTL_S,
    });
    return c.html(
      renderLoginForm({
        client_id,
        redirect_uri,
        state,
        code_challenge,
        csrf_token: csrfToken,
      })
    );
  });

  app.post('/authorize', async (c) => {
    const form = await c.req.parseBody();
    const apiKey = String(form.api_key ?? '').trim();
    const clientId = String(form.client_id ?? '');
    const redirectUri = String(form.redirect_uri ?? '');
    const state = String(form.state ?? '');
    const codeChallenge = String(form.code_challenge ?? '');
    const submittedCsrfToken = String(form.csrf_token ?? '');

    const client = await clients.get(clientId);
    if (
      !client ||
      client.expiresAt < Date.now() ||
      !client.redirectUris.includes(redirectUri) ||
      !allowedRedirectUris.has(redirectUri) ||
      !codeChallenge
    ) {
      return c.text('invalid_request', 400);
    }

    const cookieCsrfToken = getCookie(c, CSRF_COOKIE_NAME);
    if (!cookieCsrfToken || !submittedCsrfToken || !constantTimeEqual(cookieCsrfToken, submittedCsrfToken)) {
      return c.text('invalid_request: missing or mismatched CSRF token', 400);
    }

    if (!apiKey) {
      return c.html(
        renderLoginForm({
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          csrf_token: submittedCsrfToken,
          error: 'APIキーを入力してください',
        }),
        400
      );
    }

    await clients.set(clientId, { ...client, expiresAt: Date.now() + CLIENT_TTL_MS });

    await authCodes.sweepExpired();
    const code = randomToken();
    await authCodes.set(code, {
      encryptedApiKey: await encryptSecret(encryptionKey, apiKey),
      clientId,
      redirectUri,
      codeChallenge,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', state);
    return c.redirect(redirect.toString(), 302);
  });

  app.post('/token', async (c) => {
    const body = await c.req.parseBody();

    if (body.grant_type === 'refresh_token') {
      const suppliedRefreshToken = String(body.refresh_token ?? '');
      const clientId = String(body.client_id ?? '');

      const replay = await refreshReplays.get(suppliedRefreshToken);
      if (replay && replay.expiresAt > Date.now()) {
        if (replay.clientId !== clientId) {
          return c.json({ error: 'invalid_grant' }, 400);
        }
        return c.json(replay.responseBody);
      }

      const record = await refreshTokens.getAndDelete(suppliedRefreshToken);
      if (!record || record.expiresAt < Date.now() || record.clientId !== clientId) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      await accessTokens.delete(record.accessToken);
      const apiKey = await decryptSecret(encryptionKey, record.encryptedApiKey);
      const tokenPair = await issueTokenPair(stores, apiKey, record.clientId, encryptionKey);
      await refreshReplays.sweepExpired();
      await refreshReplays.set(suppliedRefreshToken, {
        responseBody: tokenPair,
        clientId: record.clientId,
        expiresAt: Date.now() + REFRESH_REPLAY_GRACE_MS,
      });
      return c.json(tokenPair);
    }

    if (body.grant_type !== 'authorization_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }
    const code = String(body.code ?? '');
    const redirectUri = String(body.redirect_uri ?? '');
    const codeVerifier = String(body.code_verifier ?? '');
    const clientId = String(body.client_id ?? '');

    const record = await authCodes.getAndDelete(code);
    if (!record || record.expiresAt < Date.now()) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    if (record.redirectUri !== redirectUri || record.clientId !== clientId) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    if (!codeVerifier || !(await pkceMatches(codeVerifier, record.codeChallenge))) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    const apiKey = await decryptSecret(encryptionKey, record.encryptedApiKey);
    return c.json(await issueTokenPair(stores, apiKey, clientId, encryptionKey));
  });

  return app;
}

async function issueTokenPair(
  stores: OAuthStores,
  apiKey: string,
  clientId: string,
  encryptionKey: CryptoKey
): Promise<TokenPairResponse> {
  await Promise.all([stores.accessTokens.sweepExpired(), stores.refreshTokens.sweepExpired()]);

  const encryptedApiKey = await encryptSecret(encryptionKey, apiKey);

  const accessToken = randomToken();
  await stores.accessTokens.set(accessToken, {
    encryptedApiKey,
    clientId,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  });

  const refreshToken = randomToken();
  await stores.refreshTokens.set(refreshToken, {
    encryptedApiKey,
    clientId,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    accessToken,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  };
}

function renderLoginForm(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  csrf_token: string;
  error?: string;
}): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>MCP サーバーへの接続</title></head>
<body style="font-family: sans-serif; max-width: 420px; margin: 60px auto;">
  <h1>MCP サーバーへの接続</h1>
  <p>以下のクライアントが、あなたの対象APIキーへのアクセスを要求しています。<strong>心当たりがない場合は、APIキーを入力せずこのページを閉じてください。</strong></p>
  <dl style="border:1px solid #ccc; padding:8px 12px; border-radius:4px;">
    <dt style="font-weight:bold;">クライアントID</dt>
    <dd style="margin:0 0 8px; word-break:break-all;">${escape(params.client_id)}</dd>
    <dt style="font-weight:bold;">リダイレクト先</dt>
    <dd style="margin:0; word-break:break-all;">${escape(params.redirect_uri)}</dd>
  </dl>
  <p>入力したAPIキーは、この認可コードとして一時的に使用され、接続元のOAuthクライアントには渡りません。</p>
  ${params.error ? `<p style="color:red">${escape(params.error)}</p>` : ''}
  <form method="POST" action="/authorize">
    <input type="hidden" name="client_id" value="${escape(params.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escape(params.redirect_uri)}">
    <input type="hidden" name="state" value="${escape(params.state)}">
    <input type="hidden" name="code_challenge" value="${escape(params.code_challenge)}">
    <input type="hidden" name="csrf_token" value="${escape(params.csrf_token)}">
    <input type="password" name="api_key" placeholder="APIキー" autocomplete="off" style="width:100%; padding:8px; margin:12px 0; box-sizing:border-box;" required>
    <button type="submit" style="padding:8px 16px;">接続する</button>
  </form>
</body></html>`;
}
