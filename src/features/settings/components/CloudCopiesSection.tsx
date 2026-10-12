import React, { useEffect, useState } from 'react';
import { Cloud, HardDriveDownload, Loader2, Trash2 } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { toast } from '../../../stores/useToastStore';
import { db } from '../../../db/db';
import { deleteCloudObject } from '../../ai/cloudClient';
import { forgetCloudBlob } from '../../ai/cloudBlobCache';
import { useCloudReAdd } from '../../../stores/useCloudReAddStore';

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
 */
export const CloudCopiesSection: React.FC = () => {
  const requestReAdd = useCloudReAdd((s) => s.requestReAdd);
  const [orphans, setOrphans] = useState<{ key: string; cachedAt: number }[]>([]);
  const [working, setWorking] = useState(false);

  const refresh = async () => {
    try {
      const cached = await db.cloudBlobCache.toArray();
      const existing = await db.resources.toArray();
      const existingKeys = new Set(existing.map((r) => r.r2Key).filter(Boolean) as string[]);
      setOrphans(cached.filter((row) => !existingKeys.has(row.key)));
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
      forgetCloudBlob(key);
      await db.cloudBlobCache.delete(key);
      toast('success', 'Deleted from the cloud', 'The copy in Cloudflare R2 is gone.');
    } catch (e) {
      toast('error', 'Could not delete from the cloud', e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setWorking(false);
      void refresh();
    }
  };

  const reAdd = (key: string) => {
    requestReAdd(key);
    toast('info', 'Go re-add the file', 'Open the library, pick a subject, and the file will be pre-filled for you.');
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
          {orphans.map((o) => (
            <div key={o.key} className="flex items-center gap-2 rounded-xl border border-border bg-bg-elevated/40 p-2.5">
              <Cloud className="w-4 h-4 text-content-tertiary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono text-content-primary truncate">{o.key}</p>
              </div>
              <button
                onClick={() => reAdd(o.key)}
                disabled={working}
                className="flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-lg text-xs font-semibold text-accent hover:bg-accent-subtle transition-colors disabled:opacity-60"
              >
                <HardDriveDownload className="w-3.5 h-3.5" /> Re-add
              </button>
              <button
                onClick={() => fullyDelete(o.key)}
                disabled={working}
                className="flex items-center gap-1.5 px-2.5 min-h-[40px] rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          ))}
          {working && (
            <div className="flex items-center gap-2 text-xs text-content-secondary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
            </div>
          )}
        </div>
      )}
    </Card>
  );
};