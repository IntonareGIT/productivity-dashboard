/**
 * Browser extraction runner.
 * Runs queued PDF extractions in the browser, one chunk at a time.
 * Persists progress after each chunk so a refresh preserves completed chunks.
 */
import { fetchUserModels } from './modelsClient';
import { getCloudAccessToken } from './cloudAuth';
import {
  getChunkRanges,
  initNoteForExtraction,
  updateNoteChunk,
  finalizeNote,
  failNote,
  resumeNote,
} from '../library/libraryRepo';

interface RunnerCallbacks {
  onProgress?: (fileId: string, chunkIndex: number, status: string) => void;
  onComplete?: (fileId: string) => void;
  onError?: (fileId: string, reason: string) => void;
}

/**
 * Run extraction for a single note.
 * Processes chunks in order, updates status after each.
 */
export async function runExtraction(
  fileId: string,
  callbacks: RunnerCallbacks = {}
): Promise<void> {
  // Resume if already processing
  let nextIndex = await resumeNote(fileId);
  if (nextIndex < 0) {
    // All chunks done, finalize
    await finalizeNote(fileId);
    callbacks.onComplete?.(fileId);
    return;
  }

  // Get the note and model
  const { db } = await import('../../db/db');
  const note = await db.notes.get(fileId);
  if (!note || note.status !== 'processing') {
    return;
  }

  const modelId = note.modelId;
  if (!modelId) {
    await failNote(fileId, 'No model selected');
    callbacks.onError?.(fileId, 'No model selected');
    return;
  }

  // Get the model details
  const modelsResult = await fetchUserModels();
  if (modelsResult.error || !modelsResult.models) {
    await failNote(fileId, 'Could not load models');
    callbacks.onError?.(fileId, modelsResult.error?.message ?? 'Could not load models');
    return;
  }
  const model = modelsResult.models.find((m) => m.id === modelId);
  if (!model) {
    await failNote(fileId, 'Model not found');
    callbacks.onError?.(fileId, 'Model not found');
    return;
  }

  // Get the token for the API call
  const token = getCloudAccessToken();
  if (!token) {
    await failNote(fileId, 'Not signed in');
    callbacks.onError?.(fileId, 'Not signed in');
    return;
  }

  // Get the resource to find the r2Key
  const { db: db2 } = await import('../../db/db');
  const resource = await db2.resources.get(fileId);
  if (!resource?.r2Key) {
    await failNote(fileId, 'File not in cloud storage');
    callbacks.onError?.(fileId, 'File not in cloud storage');
    return;
  }

  // Process chunks starting from nextIndex
  for (let i = nextIndex; i < note.chunks.length; i++) {
    const chunk = note.chunks[i];
    if (chunk.status === 'ready') continue;

    // Update chunk to processing
    await updateNoteChunk(fileId, i, { status: 'processing', error: undefined });
    callbacks.onProgress?.(fileId, i, 'processing');

    try {
      const res = await fetch('/api/extract-chunk', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileId,
          modelId: model.id,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          r2Key: resource.r2Key,
        }),
      });

      if (!res.ok) {
        let msg = 'Extraction failed';
        if (res.status === 401) msg = 'Session expired';
        else if (res.status === 403) msg = 'Model has no key or file access denied';
        else if (res.status === 400) msg = 'Model cannot accept PDF';
        else if (res.status === 502) msg = 'Model returned empty output';
        const data = await res.json().catch(() => ({}));
        msg = data.message ?? msg;
        throw new Error(msg);
      }

      const data = await res.json();
      const markdown = data.markdown;
      if (!markdown) throw new Error('Empty output from model');

      await updateNoteChunk(fileId, i, { status: 'ready', markdown });
      callbacks.onProgress?.(fileId, i, 'ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Chunk extraction failed';
      await updateNoteChunk(fileId, i, { status: 'failed', error: msg });
      await failNote(fileId, `Chunk ${i + 1} failed: ${msg}`);
      callbacks.onError?.(fileId, `Chunk ${i + 1} failed: ${msg}`);
      return;
    }
  }

  // All chunks done, finalize
  await finalizeNote(fileId);
  callbacks.onComplete?.(fileId);
}

/**
 * Start extraction for a file. Sets status to 'processing' and begins running.
 * Returns a promise that resolves when extraction completes or fails.
 */
export async function startExtraction(fileId: string, callbacks: RunnerCallbacks = {}): Promise<void> {
  const { db } = await import('../../db/db');
  const note = await db.notes.get(fileId);
  if (!note) return;

  // Update status to processing
  await db.notes.put({ ...note, status: 'processing', updatedAt: new Date().toISOString() });

  // Run extraction
  await runExtraction(fileId, callbacks);
}