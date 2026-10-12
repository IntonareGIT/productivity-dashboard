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

/** Compact human-readable byte count for the per-file gauge. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  /**
   * The last run's failures, kept after the run ends.
   *
   * The failed list only renders while `status === 'running'`, so a finished
   * run with failures would drop the reasons the moment it reported them —
   * leaving only the one-line toast. Keeping them here means the user can
   * read why each file failed and act on it, which is the whole point of a
   * partial run.
   */
  const [lastFailures, setLastFailures] = useState<{ id: string; title: string; error: string }[]>([]);
  /**
   * The last run's failures, kept after the run ends.
   *
   * The failed list only renders while `status === 'running'`, so a finished
   * run with failures would drop the reasons the moment it reported them —
   * leaving only the one-line toast. Keeping them here means the user can
   * read why each file failed and act on it, which is the whole point of a
   * partial run.
   */
  const [lastFailures, setLastFailures] = useState<{ id: string; title: string; error: string }[]>([]);

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
    setProgress({ total: pending, done: 0, doneBytes: 0, totalBytes: 0, current: null, currentPct: 0, failed: [] });
    setLastFailures([]);
    try {
      const result = await migrateFilesToCloud(setProgress, ac.signal);
      setProgress(result);
      setLastFailures(result.failed);
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
          Every file you upload is written straight to Cloudflare R2, so it is reachable from every
          signed-in device the moment it lands. This migration only exists for files that were added
          before that change and are still sitting as blobs in IndexedDB — those bytes are not synced
          and are not reachable from any other device. After the migration each row keeps its name,
          size and type, and the bytes live in R2 under your user id — no other user can reach them.
        </p>

        {pending === 0 && status !== 'running' ? (
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <Cloud className="w-4 h-4" /> Nothing to migrate — every file is already in the cloud.
          </div>
        ) : status === 'running' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-content-secondary">
                {progress?.current
                  ? `Uploading "${progress.current}"…`
                  : 'Working…'}
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
            {/* Per-file gauge: the overall bar only moves file-to-file, which
                reads as "nothing happening" on a big file. This one moves with
                the bytes actually uploaded. */}
            {progress?.current && progress.totalBytes > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-content-tertiary">
                  <span>{progress.current}</span>
                  <span>
                    {formatBytes(progress.doneBytes)} / {formatBytes(progress.totalBytes)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent/70 transition-all"
                    style={{ width: `${Math.round(progress.currentPct * 100)}%` }}
                  />
                </div>
              </div>
            )}
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

        {/* Failures from the last run, kept after it ends so the reasons are
            still readable — they only rendered while running before, which
            meant the toast was the only thing left. */}
        {lastFailures.length > 0 && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
            <p className="text-[11px] font-semibold text-rose-500 mb-1">
              {lastFailures.length} file{lastFailures.length === 1 ? '' : 's'} could not be moved:
            </p>
            <ul className="text-[11px] text-rose-500/80 space-y-0.5">
              {lastFailures.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.title}</span> — {f.error}
                </li>
              ))}
            </ul>
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