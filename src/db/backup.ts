import type { Table } from 'dexie';
import { format } from 'date-fns';
import JSZip from 'jszip';
import { db } from './db';

/** Minimal shape of a resource row, used only to type the zip export loop. */
interface ResourceRow {
  id: string;
  kind: string;
  fileName?: string | null;
  blob?: Blob | null;
}

/** Every table in the Dexie schema (v10) — must match PROJECT.md. */
export const BACKUP_TABLES = [
  'subjects',
  'topics',
  'resources',
  'resourceGroups',
  'assessments',
  'calendarEvents',
  'weeklySchedules',
  'shiftOverrides',
  'pomodoroSessions',
  'themeStatusMap',
  'appSettings',
  'aiProviders',
  'chatSessions',
  'chatMessages',
  'uiState',
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

/**
 * Serialize every table and trigger a ZIP download. The JSON payload is
 * written at the archive root; every file blob is written alongside it under
 * `files/`, named `{resourceId}-{originalName}` so the row can be found again.
 *
 * Blobs are NOT included in the JSON — the row keeps `blob: undefined` and the
 * raw bytes live in the zip instead, which keeps the JSON portable and the
 * archive self-contained for re-import.
 */
export async function exportAllDataZip(): Promise<void> {
  const data: Record<string, unknown[]> = {};
  const zip = new JSZip();
  const filesFolder = zip.folder('files')!;
  for (const table of BACKUP_TABLES) {
    const rows = await (db.table(table) as Table).toArray();
    if (table === 'resources') {
      data[table] = (rows as Record<string, unknown>[]).map((r) => {
        const { blob: _blob, ...rest } = r;
        void _blob;
        // Remember where the raw file ended up in the zip, so re-import can
        // find it again without guessing.
        if (rest.kind === 'file' && rest.fileName) {
          rest.blobFileName = `${rest.id}-${rest.fileName}`;
        }
        return rest;
      });
      for (const r of rows as ResourceRow[]) {
        if (r.kind === 'file' && r.blob instanceof Blob && r.fileName) {
          filesFolder.file(`${r.id}-${r.fileName}`, r.blob);
        }
      }
    } else if (table === 'aiProviders') {
      data[table] = (rows as Record<string, unknown>[]).map((r) => ({ ...r, apiKey: '' }));
    } else {
      data[table] = rows;
    }
  }
  const payload: BackupPayload = {
    app: 'personal-productivity-dashboard',
    schemaVersion: 7,
    exportedAt: new Date().toISOString(),
    data,
  };
  zip.file('backup.json', JSON.stringify(payload, null, 2));
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      // Export is a one-shot user action; progress is a courtesy, not a contract.
      void meta;
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `productivity-backup-${format(new Date(), 'yyyy-MM-dd')}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Serialize every table and trigger a JSON file download. Blobs stripped. */
export async function exportAllData(): Promise<void> {
  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const rows = await (db.table(table) as Table).toArray();
    if (table === 'resources') {
      data[table] = (rows as Record<string, unknown>[]).map((r) => ({ ...r, blob: undefined }));
    } else if (table === 'aiProviders') {
      // API keys never leave the device in a JSON backup — re-enter on restore.
      data[table] = (rows as Record<string, unknown>[]).map((r) => ({ ...r, apiKey: '' }));
    } else {
      data[table] = rows;
    }
  }
  const payload: BackupPayload = {
    app: 'personal-productivity-dashboard',
    schemaVersion: 7,
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
      const raw = knownKeys.includes(table) ? (data[table] as unknown[]) : [];
      let rows = raw;
      if (table === 'resources' && Array.isArray(raw)) {
        rows = (raw as Record<string, unknown>[]).map((r) => {
          if (r && typeof r === 'object' && 'blob' in r) {
            const { blob: _drop, ...rest } = r;
            void _drop;
            return rest;
          }
          return r;
        });
      }
      if (table === 'aiProviders' && Array.isArray(raw)) {
        // Keys are stripped on export; keep the local device's keys intact on
        // import by forcing an empty key for rows coming from the file.
        rows = (raw as Record<string, unknown>[]).map((r) =>
          r && typeof r === 'object' ? { ...r, apiKey: '' } : r
        );
      }
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
