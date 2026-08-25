import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  createMcpHandler,
  requireBearerAuth,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  type AuthMetadataOptions,
} from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { createServer, type ServerAuthInfo } from './server';
import { createOAuthRoutes, createTokenVerifier, buildAuthorizationServerMetadata } from './oauth';
import { createD1Stores } from './oauthStoreD1';
import { importEncryptionKey } from './oauthCrypto';
import { extractBearerToken, parseCommaSeparatedEnv } from './httpEnv';
import toolsJson from './generated/tools.json';
import type { ToolDefinition } from './tools/executor';

const tools = toolsJson as ToolDefinition[];

interface Env {
  API_BASE_URL?: string;
  MCP_SERVER_NAME?: string;
  MCP_SERVER_DESCRIPTION?: string;
  PUBLIC_URL?: string;
  OAUTH_ALLOWED_REDIRECT_URIS?: string;
  OAUTH_ENCRYPTION_KEY?: string;
  OAUTH_DB?: D1Database;
}

const handler = createMcpHandler((ctx) => createServer({ ...ctx, tools }), { responseMode: 'json' });
const app = createMcpHonoApp({ host: '0.0.0.0' });

const encryptionKeyCache = new Map<string, Promise<CryptoKey>>();
function getEncryptionKey(raw: string): Promise<CryptoKey> {
  let cached = encryptionKeyCache.get(raw);
  if (!cached) {
    cached = importEncryptionKey(raw);
    encryptionKeyCache.set(raw, cached);
  }
  return cached;
}

function getAllowedRedirectUris(raw: string | undefined): Set<string> {
  return new Set(parseCommaSeparatedEnv(raw));
}

function isMisconfigured(env: Env): boolean {
  return Boolean(env.PUBLIC_URL) && (!env.OAUTH_DB || !env.OAUTH_ENCRYPTION_KEY);
}

function buildAuthMetadataOptions(env: Env): AuthMetadataOptions | undefined {
  if (!env.PUBLIC_URL || !env.OAUTH_DB) {
    return undefined;
  }
  return {
    oauthMetadata: buildAuthorizationServerMetadata(new URL(env.PUBLIC_URL)),
    resourceServerUrl: new URL('/mcp', env.PUBLIC_URL),
  };
}

const MISCONFIGURED_MESSAGE = 'PUBLIC_URL is set but OAUTH_DB binding and/or OAUTH_ENCRYPTION_KEY is missing';

app.all('/.well-known/oauth-authorization-server', (c: Context) => {
  const env = c.env as Env;
  if (isMisconfigured(env)) {
    return c.text(MISCONFIGURED_MESSAGE, 500);
  }
  const options = buildAuthMetadataOptions(env);
  return options ? (oauthMetadataResponse(c.req.raw, options) ?? c.notFound()) : c.notFound();
});

app.all('/.well-known/oauth-protected-resource/mcp', (c: Context) => {
  const env = c.env as Env;
  if (isMisconfigured(env)) {
    return c.text(MISCONFIGURED_MESSAGE, 500);
  }
  const options = buildAuthMetadataOptions(env);
  return options ? (oauthMetadataResponse(c.req.raw, options) ?? c.notFound()) : c.notFound();
});

app.all('/register', (c: Context) => routeToOAuthApp(c));
app.all('/authorize', (c: Context) => routeToOAuthApp(c));
app.all('/token', (c: Context) => routeToOAuthApp(c));

async function routeToOAuthApp(c: Context): Promise<Response> {
  const env = c.env as Env;
  if (!env.PUBLIC_URL || !env.OAUTH_DB || !env.OAUTH_ENCRYPTION_KEY) {
    return c.notFound();
  }
  if (new URL(env.PUBLIC_URL).protocol !== 'https:') {
    return c.text('PUBLIC_URL must be https', 500);
  }
  const allowedRedirectUris = getAllowedRedirectUris(env.OAUTH_ALLOWED_REDIRECT_URIS);
  if (allowedRedirectUris.size === 0) {
    return c.text('OAUTH_ALLOWED_REDIRECT_URIS is not configured', 500);
  }
  let encryptionKey: CryptoKey;
  try {
    encryptionKey = await getEncryptionKey(env.OAUTH_ENCRYPTION_KEY);
  } catch (err) {
    console.error('OAUTH_ENCRYPTION_KEY is invalid:', err instanceof Error ? err.message : err);
    return c.text('Server misconfiguration', 500);
  }
  const oauthApp = createOAuthRoutes(allowedRedirectUris, createD1Stores(env.OAUTH_DB), encryptionKey);
  return oauthApp.fetch(c.req.raw);
}

app.all('/mcp', async (c: Context) => {
  const env = c.env as Env;
  if (isMisconfigured(env)) {
    return c.text(MISCONFIGURED_MESSAGE, 500);
  }
  const apiEnv = {
    API_BASE_URL: env.API_BASE_URL,
    MCP_SERVER_NAME: env.MCP_SERVER_NAME,
    MCP_SERVER_DESCRIPTION: env.MCP_SERVER_DESCRIPTION,
  };
  const authMetadataOptions = buildAuthMetadataOptions(env);

  if (authMetadataOptions && env.OAUTH_DB && env.OAUTH_ENCRYPTION_KEY) {
    let encryptionKey: CryptoKey;
    try {
      encryptionKey = await getEncryptionKey(env.OAUTH_ENCRYPTION_KEY);
    } catch (err) {
      console.error('OAUTH_ENCRYPTION_KEY is invalid:', err instanceof Error ? err.message : err);
      return c.text('Server misconfiguration', 500);
    }
    const stores = createD1Stores(env.OAUTH_DB);
    const gate = requireBearerAuth({
      verifier: createTokenVerifier(stores.accessTokens, encryptionKey),
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(authMetadataOptions.resourceServerUrl),
    });
    const gated = await gate(c.req.raw);
    if (gated instanceof Response) {
      return gated;
    }
    const authInfo: ServerAuthInfo = { ...gated, env: apiEnv };
    return handler.fetch(c.req.raw, { authInfo });
  }

  const token = extractBearerToken(c.req.header('authorization')) ?? '';
  const authInfo: ServerAuthInfo = { token, clientId: '', scopes: [], env: apiEnv };
  return handler.fetch(c.req.raw, { authInfo });
});

export default app;
