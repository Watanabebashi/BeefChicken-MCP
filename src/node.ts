import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
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
import { importEncryptionKey } from './oauthCrypto';
import toolsJson from './generated/tools.json';
import type { ToolDefinition } from './tools/executor';

const tools = toolsJson as ToolDefinition[];

const handler = createMcpHandler((ctx) => createServer({ ...ctx, tools }), { responseMode: 'json' });

export async function createNodeApp() {
  const host = process.env.HOST ?? '127.0.0.1';
  const allowedHosts = getAllowedHosts();
  const allowedOrigins = getAllowedOrigins();
  if ((host === '0.0.0.0' || host === '::') && allowedHosts === undefined) {
    throw new Error(
      'ALLOWED_HOSTS must be set when HOST is 0.0.0.0 or ::. ' +
        'Without it, DNS rebinding / Host header spoofing protection is disabled.'
    );
  }
  const app = createMcpHonoApp({ host, allowedHosts, allowedOrigins });

  const publicUrl = process.env.PUBLIC_URL;
  let authMetadataOptions: AuthMetadataOptions | undefined;
  let bearerGate: ReturnType<typeof requireBearerAuth> | undefined;
  if (publicUrl) {
    if (new URL(publicUrl).protocol !== 'https:') {
      throw new Error('PUBLIC_URL must be https when set.');
    }
    const allowedRedirectUris = getAllowedRedirectUris();
    if (allowedRedirectUris.size === 0) {
      throw new Error(
        'OAUTH_ALLOWED_REDIRECT_URIS must be set to a non-empty, comma-separated list when PUBLIC_URL is set.'
      );
    }
    const rawEncryptionKey = process.env.OAUTH_ENCRYPTION_KEY;
    if (!rawEncryptionKey) {
      throw new Error(
        'OAUTH_ENCRYPTION_KEY must be set when PUBLIC_URL is set. ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
      );
    }
    const encryptionKey = await importEncryptionKey(rawEncryptionKey);
    const resourceServerUrl = new URL('/mcp', publicUrl);
    authMetadataOptions = {
      oauthMetadata: buildAuthorizationServerMetadata(new URL(publicUrl)),
      resourceServerUrl,
    };
    const { createSqliteStores } = await import('./oauthStore');
    const stores = createSqliteStores();
    app.route('/', createOAuthRoutes(allowedRedirectUris, stores, encryptionKey));
    app.all(
      '/.well-known/oauth-authorization-server',
      (c) => oauthMetadataResponse(c.req.raw, authMetadataOptions!) ?? c.notFound()
    );
    app.all(
      '/.well-known/oauth-protected-resource/mcp',
      (c) => oauthMetadataResponse(c.req.raw, authMetadataOptions!) ?? c.notFound()
    );
    bearerGate = requireBearerAuth({
      verifier: createTokenVerifier(stores.accessTokens, encryptionKey),
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(authMetadataOptions.resourceServerUrl),
    });
  }

  app.all('/mcp', async (c: Context) => {
    const env = { API_BASE_URL: process.env.API_BASE_URL };

    if (bearerGate) {
      const gated = await bearerGate(c.req.raw);
      if (gated instanceof Response) {
        return gated;
      }
      const authInfo: ServerAuthInfo = { ...gated, env };
      return handler.fetch(c.req.raw, { authInfo });
    }

    const token = extractBearerToken(c.req.header('authorization')) ?? '';
    const authInfo: ServerAuthInfo = { token, clientId: '', scopes: [], env };
    return handler.fetch(c.req.raw, { authInfo });
  });

  return { app, host };
}

async function main() {
  const { app, host } = await createNodeApp();
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`MCP server listening on http://${host}:${info.port}/mcp`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function getAllowedHosts(): string[] | undefined {
  const raw = process.env.ALLOWED_HOSTS;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }
  return undefined;
}

function getAllowedOrigins(): string[] | undefined {
  const raw = process.env.ALLOWED_ORIGINS;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }
  return undefined;
}

function getAllowedRedirectUris(): Set<string> {
  const raw = process.env.OAUTH_ALLOWED_REDIRECT_URIS;
  if (typeof raw !== 'string' || raw.length === 0) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  );
}
