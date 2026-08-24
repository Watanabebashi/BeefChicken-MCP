interface FakeRow {
  value: string;
  expiresAt: number;
}

export function createFakeD1Database(options?: { failCreateTableTimes?: number }): D1Database {
  const table = new Map<string, FakeRow>();
  let remainingCreateTableFailures = options?.failCreateTableTimes ?? 0;

  function prepare(sql: string) {
    let boundArgs: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return statement;
      },
      async run() {
        if (sql.startsWith('CREATE TABLE')) {
          if (remainingCreateTableFailures > 0) {
            remainingCreateTableFailures--;
            throw new Error('simulated D1 schema creation failure');
          }
          return { success: true };
        }
        if (sql.startsWith('INSERT INTO')) {
          const [namespace, key, value, expiresAt] = boundArgs as [string, string, string, number];
          table.set(`${namespace}:${key}`, { value, expiresAt });
          return { success: true };
        }
        if (sql.startsWith('DELETE FROM oauth_kv WHERE namespace = ? AND key = ?')) {
          const [namespace, key] = boundArgs as [string, string];
          table.delete(`${namespace}:${key}`);
          return { success: true };
        }
        if (sql.startsWith('DELETE FROM oauth_kv WHERE namespace = ? AND expires_at < ?')) {
          const [namespace, before] = boundArgs as [string, number];
          for (const [mapKey, row] of table) {
            if (mapKey.startsWith(`${namespace}:`) && row.expiresAt < before) {
              table.delete(mapKey);
            }
          }
          return { success: true };
        }
        return { success: true };
      },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith('DELETE FROM oauth_kv WHERE namespace = ? AND key = ? RETURNING value')) {
          const [namespace, key] = boundArgs as [string, string];
          const mapKey = `${namespace}:${key}`;
          const row = table.get(mapKey);
          table.delete(mapKey);
          return (row ? { value: row.value } : null) as T | null;
        }
        if (sql.startsWith('SELECT value FROM')) {
          const [namespace, key] = boundArgs as [string, string];
          const row = table.get(`${namespace}:${key}`);
          return (row ? { value: row.value } : null) as T | null;
        }
        if (sql.startsWith('SELECT COUNT(*)')) {
          const [namespace, since] = boundArgs as [string, number];
          let n = 0;
          for (const [mapKey, row] of table) {
            if (mapKey.startsWith(`${namespace}:`) && row.expiresAt >= since) {
              n++;
            }
          }
          return { n } as T;
        }
        return null;
      },
    };
    return statement;
  }

  return { prepare } as unknown as D1Database;
}
