/**
 * One-time migration: move every file blob from Dexie into Cloudflare R2.
 *
 * The app used to store uploaded files as blobs in IndexedDB. That works until
 * a row is synced: Dexie Cloud offloads blobs lazily, and a blob that has been
 * offloaded is no longer available locally, so the file "disappears" on every
 * device except the one that uploaded it. Moving the bytes to R2 gives every
 * signed-in device a 5-minute presigned URL to the same object, keyed by the
 * user id so no one can reach another user's files.
 *
 * This is safe to re-run: a row already carrying an `r2Key` is skipped, and a
 * blob is only deleted AFTER its upload reports success. A failed or aborted
 * run leaves the blob in place and the row unchanged.
 *
 * "Pending" means file-kind and no r2Key yet — NOT "has a local blob". A file
 * that arrived via sync carries its row here but not its bytes (Dexie Cloud
 * only uploads blobs from the device that added them), so filtering on
 * `blob instanceof Blob` silently skipped exactly the files this migration
 * exists for. Those rows are listed, and when their bytes cannot be produced
 * they are reported as failed with a message that says what to do, instead of
 * being dropped in silence.
 */
import type { Resource } from '../../types';
import { db } from '../../db/db';
import { saveResource } from '../library/libraryRepo';
import { uploadToR2, currentUserId } from './cloudClient';
import { buildCloudKey } from './cloudKey';

export interface MigrationProgress {
  total: number; // file rows that still need an r2Key
  done: number; // rows whose upload completed
  doneBytes: number; // bytes uploaded so far, for the in-file gauge
  totalBytes: number; // bytes still to move
  current: string | null; // title of the row in flight, for the progress line
  currentPct: number; // 0..1 share of the file currently uploading
  failed: { id: string; title: string; error: string }[];
}

export type MigrationStatus = 'idle' | 'running' | 'done' | 'aborted';

/** Every file row that still needs an r2Key. */
export async function listPendingMigrations(): Promise<Resource[]> {
  const all = await db.resources.where('kind').equals('file').toArray();
  return all.filter((r) => !r.r2Key);
}

/**
 * Run the migration. `signal` lets the caller abort; the run is resumable, so
 * aborting and starting again picks up where it left off.
 *
 * Returns the final progress. Never throws: a failure is recorded in
 * `failed` and the run continues with the next file, because one bad file
 * should not block the rest.
 */
export async function migrateFilesToCloud(
  onProgress: (p: MigrationProgress) => void,
  signal?: AbortSignal,
): Promise<MigrationProgress> {
  const userId = currentUserId();
  if (!userId) {
    throw new Error('Sign in to Dexie Cloud before migrating files.');
  }

  const pending = await listPendingMigrations();
  const progress: MigrationProgress = {
    total: pending.length,
    done: 0,
    doneBytes: 0,
    totalBytes: pending.reduce((sum, r) => sum + (r.fileSize ?? 0), 0),
    current: null,
    currentPct: 0,
    failed: [],
  };

  // Lazy import keeps the R2 client out of the initial bundle until needed.
  const { loadFileBytes } = await import('../library/libraryRepo');

  for (const resource of pending) {
    if (signal?.aborted) break;

    const blob = await loadFileBytes(resource);
    if (!(blob instanceof Blob)) {
      progress.failed.push({
        id: resource.id,
        title: resource.title,
        error:
          'No bytes available on this device. Open the file once here, then re-run the migration.',
      });
      onProgress({ ...progress });
      continue;
    }

    progress.current = resource.title;
    progress.currentPct = 0;
    onProgress({ ...progress });

    try {
      // Same subject-scoped scheme as a fresh upload, so migrated files land
      // under `{userId}/{subject}/` and the bucket reads as folders. The
      // subject name is looked up once per row rather than trusted from the
      // row, because the row may not carry it.
      const subject = await db.subjects.get(resource.subjectId);
      const key = buildCloudKey(
        userId,
        resource.subjectId,
        subject?.name ?? null,
        resource.fileName ?? resource.title,
      );
      await uploadToR2(key, blob, resource.mimeType ?? undefined, (loaded, total) => {
        progress.currentPct = total > 0 ? loaded / total : 0;
        progress.doneBytes =
          pending
            .filter((r) => r.id !== resource.id)
            .reduce((sum, r) => sum + (r.fileSize ?? 0), 0) + loaded;
        onProgress({ ...progress });
      });
      // The blob is gone only once the cloud copy exists. `saveResource`
      // rewrites the row with `blob: null` and `r2Key: key`, leaving
      // every other field (subject, topic, group, tags) untouched.
      await saveResource({
        id: resource.id,
        subjectId: resource.subjectId,
        topicId: resource.topicId,
        kind: resource.kind,
        title: resource.title,
        urlOrPath: resource.urlOrPath ?? '',
        fileName: resource.fileName,
        mimeType: resource.mimeType,
        fileSize: resource.fileSize,
        r2Key: key,
        // `null` (not `undefined`) is deliberate: `saveResource` treats
        // `undefined` as "keep the existing value", so passing it would leave
        // the local blob in place and the row would keep growing. `null`
        // clears it now that the cloud copy exists.
        blob: null,
        tags: resource.tags,
        dueDate: resource.dueDate,
        completed: resource.completed,
        groupId: resource.groupId ?? null,
      });
      progress.done += 1;
      progress.doneBytes += blob.size;
    } catch (e) {
      progress.failed.push({
        id: resource.id,
        title: resource.title,
        error: e instanceof Error ? e.message : 'Upload failed.',
      });
    } finally {
      progress.current = null;
      progress.currentPct = 0;
      onProgress({ ...progress });
    }
  }

  return progress;
}