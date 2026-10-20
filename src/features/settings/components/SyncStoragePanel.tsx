import React, { useState, useCallback } from 'react';
import { db } from '../../../db/db';
import { SyncAccountPanel, useCloudAccount } from './SyncAccountPanel';
import { measureStorage } from '../../library/libraryRepo';
import { checkR2Object } from '../../../features/ai/cloudClient';
import { CheckCircle, AlertCircle, Loader2, Trash2, Copy } from 'lucide-react';
import { CloudApiError } from '../../../features/ai/cloudClient';

interface ResourceInfo {
  id: string;
  title: string;
  size: number;
  r2Key: string | null;
  r2Exists: boolean;
  group: 'a' | 'b' | 'c';
}

interface ScanResult {
  groups: {
    a: ResourceInfo[];
    b: ResourceInfo[];
    c: ResourceInfo[];
  };
  totals: { a: number; b: number; c: number };
  tableSizes: Record<string, number>;
  totalBytes: number;
  notesBreakdown?: { totalMarkdown: number; totalChunks: number; count: number };
}

interface SyncErrorDetail {
  status: number;
  body: string;
}

const GROUP_LABELS = {
  a: 'Local blob + confirmed R2 object (safe to remove)',
  b: 'Local blob + r2Key but R2 object missing (upload first)',
  c: 'Local blob with no r2Key (upload first)',
} as const;

const GROUP_COLORS = {
  a: 'text-emerald-500',
  b: 'text-amber-500',
  c: 'text-rose-500',
} as const;

const GROUP_BG = {
  a: 'bg-emerald-500/10 border-emerald-500/20',
  b: 'bg-amber-500/10 border-amber-500/20',
  c: 'bg-rose-500/10 border-rose-500/20',
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ResourceTable({ resources, group }: { resources: ResourceInfo[]; group: 'a' | 'b' | 'c' }) {
  if (resources.length === 0) return null;
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-content-tertiary border-b border-border/30">
            <th className="pb-2 pr-4">Title</th>
            <th className="pb-2 pr-4 text-right">Size</th>
            <th className="pb-2 pr-4">R2 Key</th>
            <th className="pb-2 pr-4 text-center">R2 Exists</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.id} className="border-b border-border/20 hover:bg-bg-elevated/30">
              <td className="py-2 pr-4 truncate max-w-xs" title={r.title}>{r.title}</td>
              <td className="py-2 pr-4 text-right font-mono text-[11px]">
                {(r.size / 1024 / 1024).toFixed(2)} MB
              </td>
              <td className="py-2 pr-4 text-[11px] font-mono truncate max-w-xs text-content-tertiary">
                {r.r2Key ?? '—'}
              </td>
              <td className="py-2 pr-4 text-center">
                {r.r2Exists ? (
                  <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500 mx-auto" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const StoragePanel: React.FC = () => {
  const { state } = useCloudAccount();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState<string>('');
  const [errorDetail, setErrorDetail] = useState<SyncErrorDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [clearResult, setClearResult] = useState<{ before: number; after: number; count: number } | null>(null);

  const scan = useCallback(async () => {
    setScanStatus('scanning');
    setScanMessage('Scan started.');
    setErrorDetail(null);

    if (!state.signedIn) {
      setScanStatus('error');
      setScanMessage('Not signed in. Sign in under Sync first.');
      return;
    }

    setScanning(true);
    setResult(null);
    setScanProgress({ current: 0, total: 0 });

    try {
      // Get all resources with blob
      const { db } = await import('../../../db/db');
      const resources = await db.resources.toArray();
      const withBlob = resources.filter(r => r.blob && r.blob instanceof Blob);

      setScanProgress({ current: 0, total: withBlob.length });

      if (withBlob.length === 0) {
        setScanStatus('done');
        setScanMessage('Scan finished: 0 files checked.');
        setResult({ groups: { a: [], b: [], c: [] }, totals: { a: 0, b: 0, c: 0 }, tableSizes: {}, totalBytes: 0 });
        return;
      }

      const groups = { a: [], b: [], c: [] } as { a: ResourceInfo[]; b: ResourceInfo[]; c: ResourceInfo[] };
      let totalBytesA = 0, totalBytesB = 0, totalBytesC = 0;

      for (let i = 0; i < withBlob.length; i++) {
        const resource = withBlob[i];
        const size = resource.blob.size;
        const title = resource.title;
        const r2Key = resource.r2Key;

        let group: 'a' | 'b' | 'c' = 'c';
        let r2Exists = false;

        if (resource.r2Key) {
          try {
            const exists = await checkR2Object(resource.r2Key);
            if (exists) {
              group = 'a';
              r2Exists = true;
            } else {
              group = 'b';
            }
          } catch (e) {
            if (e instanceof CloudApiError) {
              setErrorDetail({ status: e.status, body: e.message });
            }
            group = 'b';
          }
        }

        const info: ResourceInfo = { id: resource.id, title: title, size, r2Key: resource.r2Key, r2Exists, group };
        groups[group].push(info);

        if (group === 'a') totalBytesA += size;
        else if (group === 'b') totalBytesB += size;
        else totalBytesC += size;

        setScanProgress({ current: i + 1, total: withBlob.length });
      }

      // Measure table sizes
      const storage = await measureStorage();

      const result: ScanResult = {
        groups,
        totals: { a: totalBytesA, b: totalBytesB, c: totalBytesC },
        tableSizes: storage.tables,
        totalBytes: storage.totalBytes,
        notesBreakdown: storage.notesBreakdown,
      };

      setResult(result);
      setScanStatus('done');
      setScanMessage(`Scan finished: ${withBlob.length} files checked.`);
    } catch (e) {
      console.error('Scan failed:', e);
      setScanStatus('error');
      setScanMessage('Scan failed.');
      if (e instanceof CloudApiError) {
        setErrorDetail({ status: e.status, body: e.message });
        setScanMessage(`Scan failed: HTTP ${e.status}.`);
      }
    } finally {
      setScanning(false);
    }
  }, [state.signedIn]);

  return (
    <div className="space-y-4">
      {/* Sync error detail (Dexie Cloud sync failures + scan HTTP errors) */}
      {(state.errorMessage || errorDetail) && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="text-xs font-semibold text-rose-500">
              Sync error
              {errorDetail ? ` (HTTP ${errorDetail.status})` : state.diagnostics.loggedIn ? ' (403)' : ' (401)'}
            </span>
          </div>
          <div className="text-[11px] text-content-secondary font-mono bg-bg-surface/50 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap">
            {errorDetail ? errorDetail.body : state.errorMessage}
          </div>
          <button
            onClick={() => {
              const status = errorDetail ? errorDetail.status : (state.diagnostics.loggedIn ? 403 : 401);
              const body = errorDetail ? errorDetail.body : (state.errorMessage ?? '');
              const sanitized = body
                .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer <token>')
                .replace(/(r2Key|r2_key|key)["']?\s*[:=]\s*["'][^"']*["']/gi, 'key: <redacted>');
              navigator.clipboard.writeText(`Status: ${status}\nBody: ${sanitized}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-bg-elevated border border-border rounded-lg hover:bg-bg-surface transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? 'Copied!' : 'Copy error details'}
          </button>
        </div>
      )}

      {/* Storage scan */}
      <details className="space-y-4">
        <summary className="cursor-pointer select-none flex items-center justify-between">
          <span className="text-sm font-semibold text-content-primary flex items-center gap-2">
            <span>Storage and cloud copies</span>
            {scanning && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          <button
            onClick={scan}
            disabled={scanning || !state.signedIn}
            className={`w-full ${scanning ? 'bg-accent/50' : 'bg-accent'} hover:bg-accent-hover text-white text-sm font-semibold px-4 min-h-[44px] rounded-xl transition-colors disabled:opacity-40`}
          >
            {scanning ? (
              <>
                <Loader2 className="w-4 h-4 inline animate-spin mr-2" />
                Scanning…
              </>
            ) : (
              'Scan local files and cloud copies'
            )}
          </button>

          {!scanning && !state.signedIn && (
            <span className="text-xs text-rose-500">Disabled: sign in under Sync first.</span>
          )}

          {scanMessage && (
            <div className={`text-xs font-mono rounded p-2 ${scanStatus === 'error' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/40' : 'bg-bg-surface/50 text-content-secondary border border-bg-surface/50'}`}>
              {scanMessage}
            </div>
          )}

          {scanning && (
            <div className="text-xs text-content-secondary font-mono">
              Checked {scanProgress.current} of {scanProgress.total} blobs
              {scanProgress.total > 0 && (
                <span className="ml-2 inline-block w-24 bg-bg-surface rounded-full h-1.5 align-middle">
                  <span
                    className="block bg-accent h-1.5 rounded-full transition-all"
                    style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                  />
                </span>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Totals */}
              <div className="grid grid-cols-3 gap-2">
                <div className={`rounded-xl border p-3 ${GROUP_BG.a}`}>
                  <div className="text-[11px] font-semibold text-emerald-500">Group (a) — Safe to remove</div>
                  <div className="text-xl font-mono text-emerald-500">{result.groups.a.length} files</div>
                  <div className="text-sm text-emerald-500/80">{formatBytes(result.totals.a)}</div>
                </div>
                <div className={`rounded-xl border p-3 ${GROUP_BG.b}`}>
                  <div className="text-[11px] font-semibold text-amber-500">Group (b) — Upload first</div>
                  <div className="text-xl font-mono text-amber-500">{result.groups.b.length} files</div>
                  <div className="text-sm text-amber-500/80">{formatBytes(result.totals.b)}</div>
                </div>
                <div className={`rounded-xl border p-3 ${GROUP_BG.c}`}>
                  <div className="text-[11px] font-semibold text-rose-500">Group (c) — Upload first</div>
                  <div className="text-xl font-mono text-rose-500">{result.groups.c.length} files</div>
                  <div className="text-sm text-rose-500/80">{formatBytes(result.totals.c)}</div>
                </div>
              </div>

              {/* Tables */}
              <div className="space-y-4">
                {(['a', 'b', 'c'] as const).map((group) => (
                  <details key={group} className={`rounded-xl border ${GROUP_BG[group]}`}>
                    <summary className="cursor-pointer select-none p-3 flex items-center justify-between">
                      <span className={`font-semibold ${GROUP_COLORS[group]}`}>
                        {GROUP_LABELS[group]}
                      </span>
                      <span className="text-sm font-mono text-content-tertiary">
                        {result.groups[group].length} files · {formatBytes(result.totals[group])}
                      </span>
                    </summary>
                    <ResourceTable resources={result.groups[group]} group={group} />
                  </details>
                ))}
              </div>

              {/* Table sizes */}
              <details className="rounded-xl border border-border/30 bg-bg-elevated/30">
                <summary className="cursor-pointer select-none p-3 font-semibold text-content-primary">Table sizes</summary>
                <div className="px-3 pb-3 space-y-1">
                  {Object.entries(result.tableSizes)
                    .filter(([, size]) => size > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([table, size]) => (
                      <div key={table} className="flex justify-between text-sm px-3 py-1 font-mono text-[11px]">
                        <span className="text-content-secondary">{table}</span>
                        <span className="text-content-primary">{formatBytes(size)}</span>
                      </div>
                    ))}
                  <div className="border-t border-border/30 pt-2 flex justify-between text-sm font-semibold font-mono">
                    <span>Total</span>
                    <span>{formatBytes(result.totalBytes)}</span>
                  </div>
                </div>
              </details>

              {/* Notes breakdown */}
              {result.notesBreakdown && (
                <details className="rounded-xl border border-border/30 bg-bg-elevated/30">
                  <summary className="cursor-pointer select-none p-3 font-semibold text-content-primary">Notes breakdown</summary>
                  <div className="px-3 pb-3 space-y-1 text-sm font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-content-secondary">Joined markdown</span>
                      <span className="text-content-primary">{formatBytes(result.notesBreakdown.totalMarkdown)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-content-secondary">Chunk text (to be cleared)</span>
                      <span className="text-content-primary">{formatBytes(result.notesBreakdown.totalChunks)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-content-secondary">Notes count</span>
                      <span className="text-content-primary">{result.notesBreakdown.count}</span>
                    </div>
                  </div>
                </details>
              )}

              {/* Remove button (enabled once scan finishes; confirmation only, no mutation yet) */}
              {result && result.groups.a.length > 0 && (
                confirmRemove ? (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-2">
                    <p className="text-xs font-semibold text-content-primary">
                      Remove {result.groups.a.length} local copies for group (a)?
                    </p>
                    <p className="text-[11px] text-content-secondary">
                      These blobs are confirmed to have a matching R2 object, so the cloud
                      copy is safe. The exact list that would be removed:
                    </p>
                    <ul className="text-[11px] font-mono text-content-secondary bg-bg-surface/50 rounded p-2 max-h-28 overflow-auto space-y-0.5">
                      {result.groups.a.map((r) => (
                        <li key={r.id} className="truncate" title={r.title}>
                          {r.title} — {(r.size / 1024 / 1024).toFixed(2)} MB — {r.r2Key ?? '—'}
                        </li>
                      ))}
                    </ul>
<p className="text-[11px] text-content-secondary">
                       Clearing local copies…
                     </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={async () => {
                          const before = await measureStorage();
                          for (const r of result.groups.a) {
                            const row = await db.resources.get(r.id);
                            if (row) await db.resources.put({ ...row, blob: null });
                          }
                          const after = await measureStorage();
                          setClearResult({ before: before.totalBytes, after: after.totalBytes, count: result.groups.a.length });
                          setConfirmRemove(false);
                          setResult(null);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Confirm remove
                      </button>
                      <button
                        onClick={() => setConfirmRemove(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-bg-elevated border border-border rounded-lg hover:bg-bg-surface transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(true)}
                    className="w-full bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold px-4 min-h-[44px] rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4 inline mr-2" />
                    Remove local copies for group (a) — {result.groups.a.length} files, {formatBytes(result.totals.a)}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
};

// Re-export the hooks
export { useCloudAccount } from './useCloudAccount';
export { SyncAccountPanel } from './SyncAccountPanel';
export { SyncSettings } from './SyncSettings';
