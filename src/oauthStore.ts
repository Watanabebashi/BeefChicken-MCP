import { DatabaseSync } from 'node:sqlite';
import type { OAuthKvStore, OAuthStores, StoredAccessToken, StoredAuthCode, StoredClient, StoredRefreshReplay, StoredRefreshToken } from './oauth';

const db = new DatabaseSync(process.env.OAUTH_DB_PATH ?? 'oauth-state.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_kv (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS oauth_kv_expiry ON oauth_kv (namespace, expires_at)');

const getStmt = db.prepare('SELECT value FROM oauth_kv WHERE namespace = ? AND key = ?');
const setStmt = db.prepare(
  'INSERT INTO oauth_kv (namespace, key, value, expires_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
);
const deleteStmt = db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND key = ?');
const countActiveStmt = db.prepare('SELECT COUNT(*) AS n FROM oauth_kv WHERE namespace = ? AND expires_at >= ?');
const sweepStmt = db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND expires_at < ?');

class SqliteKvStore<V extends { expiresAt: number }> implements OAuthKvStore<V> {
  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<V | undefined> {
    const row = getStmt.get(this.namespace, key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as V) : undefined;
  }

  async set(key: string, value: V): Promise<void> {
    setStmt.run(this.namespace, key, JSON.stringify(value), value.expiresAt);
  }

  async delete(key: string): Promise<void> {
    deleteStmt.run(this.namespace, key);
  }

  async countActive(now = Date.now()): Promise<number> {
    const row = countActiveStmt.get(this.namespace, now) as { n: number };
    return row.n;
  }

  async sweepExpired(now = Date.now()): Promise<void> {
    sweepStmt.run(this.namespace, now);
  }
}

export function createSqliteStores(): OAuthStores {
  return {
    clients: new SqliteKvStore<StoredClient>('clients'),
    authCodes: new SqliteKvStore<StoredAuthCode>('authCodes'),
    accessTokens: new SqliteKvStore<StoredAccessToken>('accessTokens'),
    refreshTokens: new SqliteKvStore<StoredRefreshToken>('refreshTokens'),
    refreshReplays: new SqliteKvStore<StoredRefreshReplay>('refreshReplays'),
  };
}
