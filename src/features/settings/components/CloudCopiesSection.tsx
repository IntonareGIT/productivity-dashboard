import React, { useEffect, useState } from 'react';
import { Cloud, HardDriveDownload, Loader2, Trash2 } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { toast } from '../../../stores/useToastStore';
import { db } from '../../../db/db';
import { deleteCloudObject } from '../../ai/cloudClient';
import { forgetCloudBlob } from '../../ai/cloudBlobCache';
import { ResourceModal } from '../../library/components/ResourceModal';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Subject } from '../../../types';

/**
 * Orphaned cloud copies: files that live in R2 but have no row in this
 * device's database.
 *
 * Deleting a resource removes the local row by default and leaves the cloud
 * copy behind, so a file that was deleted here can still exist on the server.
 * That is intentional — it is what lets a re-add later pull the same bytes —
 * but it also means the cloud grows without bound. This section lists every
 * orphan and offers the two actions the user actually wants:
 *
 *   - fully delete it from R2 (the object is gone for everyone)
 *   - re-add it to the library (the row comes back; the bytes are already there)
 *
 * The list is derived from the r2Keys the local cache has seen, filtered
 * against the rows that actually exist. It is not a directory listing of the
 * bucket, so it only ever shows files this device knows about.
 *
 * Re-add opens the add-resource modal right here, in this section, rather
 * than handing a key off to the library. The library is a separate screen, so
 * a cross-screen handoff would be lost whenever the user navigated away — and
 * the bytes are already cached locally, so the modal previews instantly.
 */
export const CloudCopiesSection: React.FC = () => {
  const [orphans, setOrphans] = useState<{ key: string; cachedAt: number }[]>([]);
  const [working, setWorking] = useState(false);
  /** Which orphan the user picked to re-add. */
  const [reAddKey, setReAddKey] = useState<string | null>(null);
  /** Which subject the user picked for the re-add. */
  const [reAddSubjectId, setReAddSubjectId] = useState<string | null>(null);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];

  const refresh = async () => {
    try {
      // The ledger, not the blob cache: the cache only holds files previewed
      // here, so a file deleted on the site and never opened on this device
      // would be invisible to it. The ledger records every r2Key this device
      // has ever written, including ones whose row was later deleted.
      const { listKnownCloudKeys } = await import('../../ai/cloudBlobCache');
      const keys = await listKnownCloudKeys();
      const existing = await db.resources.toArray();
      const existingKeys = new Set(existing.map((r) => r.r2Key).filter(Boolean) as string[]);
      setOrphans(keys.filter((k) => !existingKeys.has(k)).map((key) => ({ key, cachedAt: 0 })));
    } catch {
      setOrphans([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const fullyDelete = async (key: string) => {
    setWorking(true);
    try {
      await deleteCloudObject(key);
      // The blob cache, the blob-cache row, and the ledger entry all go
      // together: the ledger is what makes orphan detection work, so it only
      // makes sense to drop it once the cloud copy is actually gone.
      forgetCloudBlob(key);
      const { forgetCloudKey } = await import('../../ai/cloudBlobCache');
      await forgetCloudKey(key);
      toast('success', 'Deleted from the cloud', 'The copy in Cloudflare R2 is gone.');
    } catch (e) {
      toast('error', 'Could not delete from the cloud', e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setWorking(false);
      void refresh();
    }
  };

  const reAdd = (key: string) => {
    // Open the add-resource modal right here, in this section, rather than
    // handing a key off to the library. The library is a separate screen, so
    // a cross-screen handoff would be lost whenever the user navigated away —
    // and the bytes are already cached locally, so the modal previews instantly.
    setReAddKey(key);
    setReAddSubjectId(null);
  };

  return (
    <Card title="Cloud copies" subtitle="Files in R2 with no row in your library">
      <p className="text-xs text-content-secondary mb-3">
        Deleting a resource here removes the row but keeps its cloud copy, so a file can be re-added
        later. Anything listed below has no row on this device anymore.
      </p>
      {orphans.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-500">
          <Cloud className="w-4 h-4" /> No orphaned cloud copies.
        </div>
      ) : (
        <div className="space-y-2">
          {orphans.map((o) => {
            const picking = reAddKey === o.key;
            return (
              <div key={o.key} className="flex items-center gap-2 rounded-xl border border-border bg-bg-elevated/40 p-2.5">
                <Cloud className="w-4 h-4 text-content-tertiary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-content-primary truncate">{o.key}</p>
                  {picking && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-content-tertiary">Put it in:</span>
                      <select
                        value={reAddSubjectId ?? ''}
                        onChange={(e) => setReAddSubjectId(e.target.value || null)}
                        className="flex-1 min-w-0 bg-bg-elevated border border-border rounded-lg px-2 py-1 text-xs text-content-primary outline-none focus:border-accent"
                      >
                        <option value="">Select a subject…</option>
                        {subjects.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => { setReAddKey(null); setReAddSubjectId(null); }}
                        className="px-2 min-h-[36px] rounded-lg text-xs text-content-secondary hover:text-content-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {picking ? (
                  <span className="text-[11px] text-content-tertiary">Pick a subject above</span>
                ) : (
                  <button
                    onClick={() => reAdd(o.key)}
                    disabled={working}
                    className="flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-lg text-xs font-semibold text-accent hover:bg-accent-subtle transition-colors disabled:opacity-60"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5" /> Re-add
                  </button>
                )}
                <button
                  onClick={() => fullyDelete(o.key)}
                  disabled={working}
                  className="flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            );
          })}
          {working && (
            <div className="flex items-center gap-2 text-xs text-content-secondary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
            </div>
          )}
        </div>
      )}
      {reAddKey && reAddSubjectId && (
        <ResourceModal
          subjectId={reAddSubjectId}
          cloudKey={reAddKey}
          onClose={() => { setReAddKey(null); setReAddSubjectId(null); }}
        />
      )}
    </Card>
  );
};