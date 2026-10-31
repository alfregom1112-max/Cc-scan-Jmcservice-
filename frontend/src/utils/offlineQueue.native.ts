import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";

import type { CachedHistoryScan, PendingScan } from "./offlineQueue.types";

const DATABASE_NAME = "jmservicetec_offline.db";
const KEY_NAME = "jmservicetec_offline_db_key_v1";
const LEGACY_QUEUE_KEY = "cs_offline_queue";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) databasePromise = openDatabase();
  try {
    return await databasePromise;
  } catch (error) {
    databasePromise = null;
    throw error;
  }
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(KEY_NAME, key);
  }

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(`PRAGMA key = '${key}';`);
  const cipher = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version;");
  if (!cipher?.cipher_version) {
    await db.closeAsync();
    throw new Error("SQLite cifrado no está activo. Recompila Android con SQLCipher habilitado.");
  }
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pending_scans (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pending_scans_created_idx ON pending_scans(created_at);
    CREATE TABLE IF NOT EXISTS operator_history_cache (
      event_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      scan_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, operator_id, scan_id)
    );
    CREATE TABLE IF NOT EXISTS operator_history_meta (
      event_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      total_count INTEGER NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, operator_id)
    );
  `);
  await migrateLegacyQueue(db);
  return db;
}

export async function getCachedOperatorHistory(eventId: string, operatorId: string): Promise<{ rows: CachedHistoryScan[]; count: number }> {
  const db = await database();
  const [cachedRows, meta] = await Promise.all([
    db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM operator_history_cache WHERE event_id = ? AND operator_id = ? ORDER BY cached_at DESC",
      eventId, operatorId,
    ),
    db.getFirstAsync<{ total_count: number }>(
      "SELECT total_count FROM operator_history_meta WHERE event_id = ? AND operator_id = ?",
      eventId, operatorId,
    ),
  ]);
  return {
    rows: cachedRows.map((row) => JSON.parse(row.payload) as CachedHistoryScan),
    count: meta?.total_count ?? cachedRows.length,
  };
}

export async function saveCachedOperatorHistory(eventId: string, operatorId: string, rows: CachedHistoryScan[], count?: number): Promise<void> {
  if (!rows.length && count === undefined) return;
  const db = await database();
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(
        "INSERT INTO operator_history_cache (event_id,operator_id,scan_id,payload,cached_at) VALUES (?,?,?,?,?) ON CONFLICT(event_id,operator_id,scan_id) DO UPDATE SET payload=excluded.payload,cached_at=excluded.cached_at",
        eventId, operatorId, row.id, JSON.stringify(row), Date.now(),
      );
    }
    if (count !== undefined) {
      await db.runAsync(
        "INSERT INTO operator_history_meta (event_id,operator_id,total_count,cached_at) VALUES (?,?,?,?) ON CONFLICT(event_id,operator_id) DO UPDATE SET total_count=excluded.total_count,cached_at=excluded.cached_at",
        eventId, operatorId, count, Date.now(),
      );
    }
  });
}

async function migrateLegacyQueue(db: SQLite.SQLiteDatabase): Promise<void> {
  const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
  if (!raw) return;
  let oldItems: PendingScan[];
  try {
    oldItems = JSON.parse(raw) as PendingScan[];
    if (!Array.isArray(oldItems)) throw new Error("Cola anterior inválida");
  } catch {
    // Keep unreadable legacy data untouched for recovery; never discard silently.
    throw new Error("La cola offline anterior no se pudo leer; se conserva sin modificar.");
  }

  await db.withTransactionAsync(async () => {
    for (const item of oldItems) {
      if (!item?.idempotency_key || !item.cedula || !item.evento_id) continue;
      await db.runAsync(
        "INSERT OR IGNORE INTO pending_scans (idempotency_key,payload,attempts,created_at) VALUES (?,?,?,?)",
        item.idempotency_key,
        JSON.stringify(item),
        Number(item.attempts) || 0,
        Number(item.timestamp) || Date.now(),
      );
    }
  });
  await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
}

export async function listPendingScans(): Promise<PendingScan[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ payload: string; attempts: number }>(
    "SELECT payload, attempts FROM pending_scans ORDER BY created_at ASC",
  );
  return rows.map((row) => ({ ...JSON.parse(row.payload), attempts: row.attempts } as PendingScan));
}

export async function enqueuePendingScan(item: PendingScan): Promise<void> {
  const db = await database();
  await db.runAsync(
    "INSERT OR IGNORE INTO pending_scans (idempotency_key,payload,attempts,created_at) VALUES (?,?,?,?)",
    item.idempotency_key,
    JSON.stringify(item),
    item.attempts || 0,
    item.timestamp,
  );
}

export async function removePendingScan(idempotencyKey: string): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM pending_scans WHERE idempotency_key = ?", idempotencyKey);
}

export async function incrementPendingAttempts(idempotencyKey: string): Promise<void> {
  const db = await database();
  await db.runAsync("UPDATE pending_scans SET attempts = attempts + 1 WHERE idempotency_key = ?", idempotencyKey);
}
