import React, { useEffect, useRef, useState } from 'react';
import { Download, HardDriveDownload, Upload } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { db } from '../../../db/db';
import { exportAllData, importAllData, BACKUP_TABLES } from '../../../db/backup';

/**
 * Data section (Phase 6): export every Dexie table to one JSON file and
 * import a backup to restore on another device (each device's IndexedDB is
 * separate — this is the primary way to move data).
 */
export const DataBackupSection: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'ok'; text: string }>({
    kind: 'info',
    text: '',
  });
  const [confirmImport, setConfirmImport] = useState(false);
  const [busy, setBusy] = useState(false);

  // Show current row counts for each table.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: Record<string, number> = {};
      for (const table of BACKUP_TABLES) {
        result[table] = await db.table(table).count();
      }
      if (!cancelled) setCounts(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleExport = async () => {
    setBusy(true);
    setStatus({ kind: 'info', text: '' });
    try {
      await exportAllData();
      setStatus({ kind: 'ok', text: 'Backup downloaded as JSON.' });
    } catch (e) {
      setStatus({
        kind: 'error',
        text: e instanceof Error ? e.message : 'Export failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Importing…' });
    try {
      const result = await importAllData(file);
      setStatus({
        kind: 'ok',
        text: `Imported ${result.total} rows. Reloading…`,
      });
      // Reload so every store (theme, pomodoro settings) re-initializes.
      window.setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setStatus({
        kind: 'error',
        text: e instanceof Error ? e.message : 'Import failed.',
      });
      setConfirmImport(false);
      setBusy(false);
    }
  };

  return (
    <Card
      title="Data & Backup"
      subtitle="Export all app data to JSON, or restore a backup on another device"
    >
      <div className="space-y-4">
        {/* Row counts */}
        {counts && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-content-tertiary">
            {BACKUP_TABLES.map((t) => (
              <span key={t}>
                {t}: <span className="font-semibold text-content-secondary">{counts[t]}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExport}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            Export all data (JSON)
          </button>

          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => {
                if (confirmImport) {
                  fileInputRef.current?.click();
                } else {
                  setConfirmImport(true);
                  setStatus({
                    kind: 'info',
                    text: 'This REPLACES all current data — click again to choose a file.',
                  });
                }
              }}
              disabled={busy}
              className={`flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl text-sm font-semibold transition-colors border disabled:opacity-60 ${
                confirmImport
                  ? 'bg-rose-600 border-rose-600 text-white'
                  : 'bg-bg-elevated/50 border-border text-content-primary hover:border-border-strong'
              }`}
            >
              <Upload className="w-4 h-4" />
              {confirmImport ? 'Confirm — replace data…' : 'Import from file'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {status.text && (
          <p
            className={`text-xs flex items-center gap-1.5 ${
              status.kind === 'error'
                ? 'text-rose-500'
                : status.kind === 'ok'
                ? 'text-emerald-500'
                : 'text-content-secondary'
            }`}
          >
            <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
            {status.text}
          </p>
        )}
      </div>
    </Card>
  );
};
