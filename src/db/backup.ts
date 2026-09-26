import type { Table } from 'dexie';
import { format } from 'date-fns';
import { db } from './db';

/** Every table in the Dexie schema (v3) — must match PROJECT.md. */
export const BACKUP_TABLES = [
  'subjects',
  'resources',
  'calendarEvents',
  'weeklySchedules',
  'shiftOverrides',
  'pomodoroSessions',
  'themeStatusMap',
  'appSettings',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupPayload {
  app: 'personal-productivity-dashboard';
  schemaVersion: number;
  exportedAt: string; // ISO 8601
  data: Record<string, unknown[]>;
}

export interface ImportResult {
  counts: Record<string, number>;
  total: number;
}

/** Serialize every table and trigger a JSON file download. */
export async function exportAllData(): Promise<void> {
  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    data[table] = await (db.table(table) as Table).toArray();
  }
  const payload: BackupPayload = {
    app: 'personal-productivity-dashboard',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `productivity-backup-${format(new Date(), 'yyyy-MM-dd')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Restore from a backup file. REPLACES all data: every known table is
 * cleared first, then the file's rows are written back (validated as arrays).
 */
export async function importAllData(file: File): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const container = parsed as Partial<BackupPayload> & Record<string, unknown>;
  const data =
    container && typeof container === 'object' && container.data
      ? (container.data as Record<string, unknown>)
      : container;

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Unrecognized backup format.');
  }

  const knownKeys = BACKUP_TABLES.filter((t) => t in data);
  if (knownKeys.length === 0) {
    throw new Error('No recognisable tables found in that file.');
  }
  for (const key of knownKeys) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Table "${key}" is not an array — backup looks corrupt.`);
    }
  }

  const counts: Record<string, number> = {};
  await db.transaction('rw', [...BACKUP_TABLES], async () => {
    for (const table of BACKUP_TABLES) {
      const rows = knownKeys.includes(table) ? (data[table] as unknown[]) : [];
      await (db.table(table) as Table).clear();
      if (rows.length > 0) {
        await (db.table(table) as Table).bulkPut(rows);
      }
      counts[table] = rows.length;
    }
  });

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { counts, total };
}
