import { DatabaseSync } from 'node:sqlite';
import type {
  OAuthKvStore,
  OAuthStores,
  StoredAccessToken,
  StoredAuthCode,
  StoredClient,
  StoredRefreshReplay,
  StoredRefreshToken,
} from './oauth';

function prepareStatements(db: DatabaseSync) {
  return {
    db,
    get: db.prepare('SELECT value FROM oauth_kv WHERE namespace = ? AND key = ?'),
    set: db.prepare(
      'INSERT INTO oauth_kv (namespace, key, value, expires_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
    ),
    delete: db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND key = ?'),
    getAndDelete: db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND key = ? RETURNING value'),
    countActive: db.prepare('SELECT COUNT(*) AS n FROM oauth_kv WHERE namespace = ? AND expires_at >= ?'),
    sweep: db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND expires_at < ?'),
  };
}

type Statements = ReturnType<typeof prepareStatements>;

class SqliteKvStore<V extends { expiresAt: number }> implements OAuthKvStore<V> {
  constructor(
    private readonly namespace: string,
    private readonly stmts: Statements
  ) {}

  async get(key: string): Promise<V | undefined> {
    const row = this.stmts.get.get(this.namespace, key) as { value: string } | null | undefined;
    return row?.value != null ? (JSON.parse(row.value) as V) : undefined;
  }

  async set(key: string, value: V): Promise<void> {
    this.stmts.set.run(this.namespace, key, JSON.stringify(value), value.expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.stmts.delete.run(this.namespace, key);
  }

  async getAndDelete(key: string): Promise<V | undefined> {
    const row = this.stmts.getAndDelete.get(this.namespace, key) as { value: string } | null | undefined;
    return row?.value != null ? (JSON.parse(row.value) as V) : undefined;
  }

  async countActive(now = Date.now()): Promise<number> {
    const row = this.stmts.countActive.get(this.namespace, now) as { n: number };
    return row.n;
  }

  async sweepExpired(now = Date.now()): Promise<void> {
    this.stmts.sweep.run(this.namespace, now);
  }
}

export function createSqliteStores(dbPath: string = process.env.OAUTH_DB_PATH ?? 'oauth-state.db'): OAuthStores {
  const db = new DatabaseSync(dbPath);
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

  const stmts = prepareStatements(db);

  return {
    clients: new SqliteKvStore<StoredClient>('clients', stmts),
    authCodes: new SqliteKvStore<StoredAuthCode>('authCodes', stmts),
    accessTokens: new SqliteKvStore<StoredAccessToken>('accessTokens', stmts),
    refreshTokens: new SqliteKvStore<StoredRefreshToken>('refreshTokens', stmts),
    refreshReplays: new SqliteKvStore<StoredRefreshReplay>('refreshReplays', stmts),
  };
}
