import * as SQLite from 'expo-sqlite';
import type { SyncState } from '../core/types.ts';

const dbPromise = SQLite.openDatabaseAsync('simplify-track.db');

export async function loadState(fallbackBaseUrl: string): Promise<SyncState> {
  const db = await dbPromise;
  await db.execAsync('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_state WHERE key = 'snapshot'");
  if (!row) return { records: [], syncToken: null, lastSyncedAt: null, accounts: [], baseUrl: fallbackBaseUrl };
  try {
    const parsed = JSON.parse(row.value) as Partial<SyncState>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      syncToken: typeof parsed.syncToken === 'string' ? parsed.syncToken : null,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : fallbackBaseUrl,
    };
  } catch {
    return { records: [], syncToken: null, lastSyncedAt: null, accounts: [], baseUrl: fallbackBaseUrl };
  }
}

export async function commitState(state: SyncState): Promise<void> {
  const db = await dbPromise;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "INSERT INTO app_state (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(state),
    );
  });
}
