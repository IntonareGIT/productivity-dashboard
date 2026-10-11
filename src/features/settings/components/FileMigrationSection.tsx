import React, { useEffect, useState } from 'react';
import { Archive, Cloud, HardDriveDownload, Loader2, Pause, Play, X } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { toast } from '../../../stores/useToastStore';
import {
  listPendingMigrations,
  migrateFilesToCloud,
  type MigrationProgress,
  type MigrationStatus,
} from '../../ai/fileMigration';

/**
 * One-time migration: move every file blob out of IndexedDB and into
 * Cloudflare R2, so every signed-in device can reach the same object.
 *
 * Safe to re-run — a row already carrying an `r2Key` is skipped, and a blob is
 * only deleted after its upload reports success.
 */
export const FileMigrationSection: React.FC = () => {
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<MigrationStatus>('idle');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  // Refresh the pending count whenever the section mounts or the run ends.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listPendingMigrations();
      if (!cancelled) setPending(rows.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const start = async () => {
    const ac = new AbortController();
    setController(ac);
    setStatus('running');
    setProgress({ total: pending, done: 0, current: null, failed: [] });
    try {
      const result = await migrateFilesToCloud(setProgress, ac.signal);
      setProgress(result);
      setStatus(result.failed.length === 0 && result.done > 0 ? 'done' : 'idle');
      if (result.failed.length === 0 && result.done > 0) {
        toast('success', 'Migration complete', `${result.done} file(s) moved to the cloud.`);
      } else if (result.failed.length > 0) {
        toast('error', 'Migration finished with failures', `${result.failed.length} file(s) could not be moved.`);
      }
    } catch (e) {
      setStatus('idle');
      toast('error', 'Migration failed', e instanceof Error ? e.message : 'Could not start the migration.');
    } finally {
      setController(null);
    }
  };

  const stop = () => {
    controller?.abort();
    setStatus('aborted');
  };

  const done = progress?.done ?? 0;
  const total = progress?.total ?? pending;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card
      title="Migrate files to the cloud"
      subtitle="Move every stored file into Cloudflare R2 so it is reachable from every signed-in device"
    >
      <div className="space-y-4">
        <p className="text-xs text-content-secondary">
          Files you have uploaded are stored locally until this runs. After the migration each row keeps its
          name, size and type, and the bytes live in R2 under your user id — no other user can reach them.
        </p>

        {pending === 0 && status !== 'running' ? (
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <Cloud className="w-4 h-4" /> Nothing to migrate — every file is already in the cloud.
          </div>
        ) : status === 'running' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-content-secondary">
                {progress?.current ? `Uploading "${progress.current}"…` : 'Working…'}
              </span>
              <span className="font-semibold text-content-primary">
                {done} / {total} ({pct}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress?.failed && progress.failed.length > 0 && (
              <ul className="text-[11px] text-rose-500 space-y-1">
                {progress.failed.map((f) => (
                  <li key={f.id}>
                    {f.title}: {f.error}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={stop}
              className="flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl border border-border text-content-secondary hover:text-rose-500 hover:border-rose-500/40 text-xs font-semibold transition-colors"
            >
              <Pause className="w-4 h-4" /> Stop
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <span className="text-xs text-content-secondary">
              <HardDriveDownload className="w-3.5 h-3.5 inline-block mr-1" />
              {pending} file{pending === 1 ? '' : 's'} still stored locally.
            </span>
            <button
              onClick={start}
              disabled={pending === 0}
              className="flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <Play className="w-4 h-4" /> Start migration
            </button>
          </div>
        )}

        {status === 'done' && progress && (
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <Cloud className="w-4 h-4" /> Migration complete — {progress.done} file(s) moved.
          </div>
        )}
      </div>
    </Card>
  );
};