import type {
  OAuthKvStore,
  OAuthStores,
  StoredAccessToken,
  StoredAuthCode,
  StoredClient,
  StoredRefreshReplay,
  StoredRefreshToken,
} from './oauth';

const schemaReadyByDb = new WeakMap<D1Database, Promise<void>>();

function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReadyByDb.get(db);
  if (!ready) {
    ready = db
      .prepare(
        'CREATE TABLE IF NOT EXISTS oauth_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (namespace, key))'
      )
      .run()
      .then(() => undefined)
      .catch((err) => {
        schemaReadyByDb.delete(db);
        throw err;
      });
    schemaReadyByDb.set(db, ready);
  }
  return ready;
}

class D1KvStore<V extends { expiresAt: number }> implements OAuthKvStore<V> {
  constructor(
    private readonly db: D1Database,
    private readonly namespace: string
  ) {}

  async get(key: string): Promise<V | undefined> {
    await ensureSchema(this.db);
    const row = await this.db
      .prepare('SELECT value FROM oauth_kv WHERE namespace = ? AND key = ?')
      .bind(this.namespace, key)
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as V) : undefined;
  }

  async set(key: string, value: V): Promise<void> {
    await ensureSchema(this.db);
    await this.db
      .prepare(
        'INSERT INTO oauth_kv (namespace, key, value, expires_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
      )
      .bind(this.namespace, key, JSON.stringify(value), value.expiresAt)
      .run();
  }

  async delete(key: string): Promise<void> {
    await ensureSchema(this.db);
    await this.db.prepare('DELETE FROM oauth_kv WHERE namespace = ? AND key = ?').bind(this.namespace, key).run();
  }

  async countActive(now = Date.now()): Promise<number> {
    await ensureSchema(this.db);
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM oauth_kv WHERE namespace = ? AND expires_at >= ?')
      .bind(this.namespace, now)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async sweepExpired(now = Date.now()): Promise<void> {
    await ensureSchema(this.db);
    await this.db
      .prepare('DELETE FROM oauth_kv WHERE namespace = ? AND expires_at < ?')
      .bind(this.namespace, now)
      .run();
  }
}

export function createD1Stores(db: D1Database): OAuthStores {
  return {
    clients: new D1KvStore<StoredClient>(db, 'clients'),
    authCodes: new D1KvStore<StoredAuthCode>(db, 'authCodes'),
    accessTokens: new D1KvStore<StoredAccessToken>(db, 'accessTokens'),
    refreshTokens: new D1KvStore<StoredRefreshToken>(db, 'refreshTokens'),
    refreshReplays: new D1KvStore<StoredRefreshReplay>(db, 'refreshReplays'),
  };
}
