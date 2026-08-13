import { describe, it, expect } from 'vitest';
import { createSqliteStores } from '../src/oauthStore';

describe('createSqliteStores', () => {
  it('returns undefined for a missing key', async () => {
    const stores = createSqliteStores(':memory:');
    expect(await stores.accessTokens.get('missing')).toBeUndefined();
  });

  it('round-trips a value through set/get', async () => {
    const stores = createSqliteStores(':memory:');
    const expiresAt = Date.now() + 60_000;
    await stores.clients.set('c1', { redirectUris: ['https://example.com/cb'], expiresAt });
    expect(await stores.clients.get('c1')).toEqual({ redirectUris: ['https://example.com/cb'], expiresAt });
  });

  it('upserts on repeated set calls for the same key', async () => {
    const stores = createSqliteStores(':memory:');
    const expiresAt = Date.now() + 60_000;
    await stores.accessTokens.set('tok', { encryptedApiKey: 'a', clientId: 'c', expiresAt });
    await stores.accessTokens.set('tok', { encryptedApiKey: 'b', clientId: 'c', expiresAt });
    expect(await stores.accessTokens.get('tok')).toEqual({ encryptedApiKey: 'b', clientId: 'c', expiresAt });
  });

  it('deletes a key', async () => {
    const stores = createSqliteStores(':memory:');
    await stores.authCodes.set('code1', {
      encryptedApiKey: 'x',
      clientId: 'c',
      redirectUri: 'https://example.com/cb',
      codeChallenge: 'y',
      expiresAt: Date.now() + 1000,
    });
    await stores.authCodes.delete('code1');
    expect(await stores.authCodes.get('code1')).toBeUndefined();
  });

  it('counts only active (non-expired) entries', async () => {
    const stores = createSqliteStores(':memory:');
    const now = Date.now();
    await stores.refreshTokens.set('active', {
      encryptedApiKey: 'a',
      clientId: 'c',
      expiresAt: now + 60_000,
      accessToken: 'at',
    });
    await stores.refreshTokens.set('expired', {
      encryptedApiKey: 'a',
      clientId: 'c',
      expiresAt: now - 60_000,
      accessToken: 'at',
    });
    expect(await stores.refreshTokens.countActive(now)).toBe(1);
  });

  it('sweeps expired entries without touching active ones', async () => {
    const stores = createSqliteStores(':memory:');
    const now = Date.now();
    const responseBody = { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' as const, expires_in: 60 };
    await stores.refreshReplays.set('active', { responseBody, clientId: 'c', expiresAt: now + 60_000 });
    await stores.refreshReplays.set('expired', { responseBody, clientId: 'c', expiresAt: now - 60_000 });

    await stores.refreshReplays.sweepExpired(now);

    expect(await stores.refreshReplays.get('active')).toBeDefined();
    expect(await stores.refreshReplays.get('expired')).toBeUndefined();
  });

  it('isolates namespaces so the same key does not collide across stores', async () => {
    const stores = createSqliteStores(':memory:');
    const expiresAt = Date.now() + 60_000;
    await stores.accessTokens.set('dup', { encryptedApiKey: 'access', clientId: 'c', expiresAt });
    await stores.refreshTokens.set('dup', { encryptedApiKey: 'refresh', clientId: 'c', expiresAt, accessToken: 'at' });

    expect((await stores.accessTokens.get('dup'))?.encryptedApiKey).toBe('access');
    expect((await stores.refreshTokens.get('dup'))?.encryptedApiKey).toBe('refresh');
  });

  it('falls back to OAUTH_DB_PATH when no path argument is given', () => {
    const previous = process.env.OAUTH_DB_PATH;
    process.env.OAUTH_DB_PATH = ':memory:';
    try {
      expect(() => createSqliteStores()).not.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.OAUTH_DB_PATH;
      } else {
        process.env.OAUTH_DB_PATH = previous;
      }
    }
  });
});
