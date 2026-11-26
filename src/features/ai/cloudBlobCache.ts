/**
 * Cache for R2 blobs, so opening the same file twice in one session does not
 * re-download it.
 *
 * The viewer fetches a presigned URL on demand because a file row carries no
 * bytes locally. That is correct — it keeps IndexedDB small — but it means
 * every open is a network round trip, and re-opening the same PDF in the same
 * session is a needless wait. This module answers that:
 *
 *   - an in-memory Map holds blobs for the life of the tab (instant re-open);
 *   - a small IndexedDB table (`cloudBlobCache`) persists them across reloads
 *     on the same device, keyed by r2Key.
 *
 * Nothing here is synced: it is a local convenience cache, and it is cleared
 * automatically when a row is deleted or the migration overwrites it. A failed
 * fetch is never cached, so a transient network error still retries next time.
 *
 * A separate `knownCloudKeys` set records every r2Key this device has ever
 * assigned — including ones whose row was later deleted. The blob cache alone
 * cannot detect orphans, because it only ever holds files that were previewed
 * here; a file deleted on the site and never opened on this device would be
 * invisible to it. The ledger is what makes "files in R2 with no row here"
 * actually detectable.
 */

import { db } from '../../db/db';

const memory = new Map<string, Blob>();
const knownKeys = new Set<string>();

/** Remember a blob for this r2Key, in memory and on disk. */
export async function cacheCloudBlob(key: string, blob: Blob): Promise<void> {
  memory.set(key, blob);
  try {
    await db.cloudBlobCache.put({ key, blob, cachedAt: Date.now() });
  } catch {
    // The disk cache is best-effort: a full IndexedDB is not worth failing an
    // open over. The in-memory copy still serves the rest of the session.
  }
}

/** Look up a cached blob. Memory first (no await), then disk. */
export async function getCachedCloudBlob(key: string): Promise<Blob | null> {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory;
  try {
    const row = await db.cloudBlobCache.get(key);
    if (row?.blob instanceof Blob) {
      memory.set(key, row.blob);
      return row.blob;
    }
  } catch {
    // Best-effort; fall through to a fresh fetch.
  }
  return null;
}

/** Drop a cached blob — called when the row is deleted or re-migrated. */
export function forgetCloudBlob(key: string): void {
  memory.delete(key);
  db.cloudBlobCache.delete(key).catch(() => {});
}

/* ---------------- Known-key ledger ---------------- */

/**
 * Every r2Key this device has ever written to a resource row. Kept in its own
 * table so orphan detection does not depend on the blob cache, which only
 * ever holds files previewed here.
 */
export async function recordCloudKey(key: string): Promise<void> {
  knownKeys.add(key);
  try {
    await db.knownCloudKeys.put({ key, recordedAt: Date.now() });
  } catch {
    // Best-effort; the in-memory set still serves this session.
  }
}

export async function forgetCloudKey(key: string): Promise<void> {
  knownKeys.delete(key);
  try {
    await db.knownCloudKeys.delete(key);
  } catch {
    // Best-effort.
  }
}

/** Every key this device knows about, in recorded order. */
export async function listKnownCloudKeys(): Promise<string[]> {
  try {
    const rows = await db.knownCloudKeys.toArray();
    return rows.map((r) => r.key);
  } catch {
    return [...knownKeys];
  }
}