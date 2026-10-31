// Web fallback is in-memory only. Durable identity data is intentionally
// supported on Android through offlineQueue.native.ts with SQLCipher.
import type { CachedHistoryScan, PendingScan } from "./offlineQueue.types";

const pending = new Map<string, PendingScan>();
const history = new Map<string, { rows: Map<string, CachedHistoryScan>; count: number }>();

function historyKey(eventId: string, operatorId: string) { return `${eventId}:${operatorId}`; }

export async function getCachedOperatorHistory(eventId: string, operatorId: string): Promise<{ rows: CachedHistoryScan[]; count: number }> {
  const cached = history.get(historyKey(eventId, operatorId));
  return cached ? { rows: [...cached.rows.values()], count: cached.count } : { rows: [], count: 0 };
}

export async function saveCachedOperatorHistory(eventId: string, operatorId: string, rows: CachedHistoryScan[], count?: number): Promise<void> {
  const key = historyKey(eventId, operatorId);
  const cached = history.get(key) ?? { rows: new Map<string, CachedHistoryScan>(), count: 0 };
  for (const row of rows) cached.rows.set(row.id, row);
  if (count !== undefined) cached.count = count;
  history.set(key, cached);
}

export async function listPendingScans(): Promise<PendingScan[]> {
  return [...pending.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function enqueuePendingScan(item: PendingScan): Promise<void> {
  if (!pending.has(item.idempotency_key)) pending.set(item.idempotency_key, item);
}

export async function removePendingScan(idempotencyKey: string): Promise<void> {
  pending.delete(idempotencyKey);
}

export async function incrementPendingAttempts(idempotencyKey: string): Promise<void> {
  const item = pending.get(idempotencyKey);
  if (item) pending.set(idempotencyKey, { ...item, attempts: item.attempts + 1 });
}
