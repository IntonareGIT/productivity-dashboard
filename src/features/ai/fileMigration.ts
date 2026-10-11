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
 */
import type { Resource } from '../../types';
import { db } from '../../db/db';
import { saveResource } from '../library/libraryRepo';
import { uploadToR2, currentUserId } from './cloudClient';

export interface MigrationProgress {
  total: number; // rows that still have a blob to move
  done: number; // rows whose upload completed
  current: string | null; // title of the row in flight, for the progress line
  failed: { id: string; title: string; error: string }[];
}

export type MigrationStatus = 'idle' | 'running' | 'done' | 'aborted';

/** Every file row that still holds its bytes locally. */
export async function listPendingMigrations(): Promise<Resource[]> {
  const all = await db.resources.where('kind').equals('file').toArray();
  return all.filter((r) => r.blob instanceof Blob);
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
    current: null,
    failed: [],
  };

  for (const resource of pending) {
    if (signal?.aborted) break;
    const blob = resource.blob;
    if (!(blob instanceof Blob)) continue;

    progress.current = resource.title;
    onProgress({ ...progress });

    try {
      const key = `${userId}/${resource.id}-${resource.fileName ?? resource.title}`;
      await uploadToR2(key, blob, resource.mimeType ?? undefined);
      // The blob is gone only once the cloud copy exists. `saveResource`
      // rewrites the row with `blob: undefined` and `r2Key: key`, leaving
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
        blob: undefined,
        tags: resource.tags,
        dueDate: resource.dueDate,
        completed: resource.completed,
        groupId: resource.groupId ?? null,
      });
      progress.done += 1;
    } catch (e) {
      progress.failed.push({
        id: resource.id,
        title: resource.title,
        error: e instanceof Error ? e.message : 'Upload failed.',
      });
    } finally {
      progress.current = null;
      onProgress({ ...progress });
    }
  }

  return progress;
}