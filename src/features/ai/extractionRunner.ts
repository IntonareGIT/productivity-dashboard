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
import { toast } from '../../stores/useToastStore';

interface RunnerCallbacks {
  onProgress?: (fileId: string, chunkIndex: number, status: string) => void;
  onRetry?: (fileId: string, chunkIndex: number, attempt: number, maxAttempts: number, waitMs: number) => void;
  onComplete?: (fileId: string) => void;
  onError?: (fileId: string, reason: string) => void;
  isCancelled?: () => boolean;
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_WAITS_MS = [15_000, 45_000, 90_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run extraction for a single note.
 * Processes chunks in order, updates status after each.
 */
export async function runExtraction(
  fileId: string,
  callbacks: RunnerCallbacks = {}
): Promise<void> {
  console.log('[extract] runExtraction started', { fileId });
  // Resume if already processing
  let nextIndex = await resumeNote(fileId);
  if (nextIndex < 0) {
    // All chunks done, finalize
    console.log('[extract] all chunks done, finalizing', { fileId });
    await finalizeNote(fileId);
    callbacks.onComplete?.(fileId);
    return;
  }

  // Get the note and model
  const { db } = await import('../../db/db');
  const note = await db.notes.get(fileId);
  if (!note || note.status !== 'processing') {
    console.log('[extract] note not processing, aborting', { fileId, status: note?.status });
    return;
  }

  const modelId = note.modelId;
  if (!modelId) {
    console.log('[extract] no modelId on note', { fileId });
    await failNote(fileId, 'No model selected');
    toast('error', 'Extraction failed', 'No model selected');
    callbacks.onError?.(fileId, 'No model selected');
    return;
  }

  // Get the model details
  const modelsResult = await fetchUserModels();
  if (modelsResult.error || !modelsResult.models) {
    console.log('[extract] could not load models', { fileId, error: modelsResult.error });
    await failNote(fileId, 'Could not load models');
    toast('error', 'Extraction failed', 'Could not load models');
    callbacks.onError?.(fileId, modelsResult.error?.message ?? 'Could not load models');
    return;
  }
  const model = modelsResult.models.find((m) => m.id === modelId);
  if (!model) {
    console.log('[extract] model not found', { fileId, modelId });
    await failNote(fileId, 'Model not found');
    toast('error', 'Extraction failed', 'Model not found');
    callbacks.onError?.(fileId, 'Model not found');
    return;
  }

  // Get the token for the API call
  const token = getCloudAccessToken();
  if (!token) {
    console.log('[extract] no cloud token', { fileId });
    await failNote(fileId, 'Not signed in');
    toast('error', 'Extraction failed', 'Not signed in. Sign in again from Settings → Sync.');
    callbacks.onError?.(fileId, 'Not signed in');
    return;
  }

  // Get the resource to find the r2Key
  const { db: db2 } = await import('../../db/db');
  const resource = await db2.resources.get(fileId);
  if (!resource?.r2Key) {
    console.log('[extract] no r2Key on resource', { fileId });
    await failNote(fileId, 'File not in cloud storage');
    toast('error', 'Extraction failed', 'File not in cloud storage');
    callbacks.onError?.(fileId, 'File not in cloud storage');
    return;
  }

  toast('info', 'Extraction started', resource.title);
  console.log('[extract] processing chunks', { fileId, totalChunks: note.chunks.length, startingAt: nextIndex });

  // Process chunks starting from nextIndex
  for (let i = nextIndex; i < note.chunks.length; i++) {
    const chunk = note.chunks[i];
    if (chunk.status === 'ready') continue;

    // Update chunk to processing
    await updateNoteChunk(fileId, i, { status: 'processing', error: undefined });
    callbacks.onProgress?.(fileId, i, 'processing');

    try {
      let res: Response;
      let lastError = '';
      let attempts = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (callbacks.isCancelled?.()) {
          throw new Error('Cancelled');
        }
        attempts = attempt + 1;
        console.log('[extract] calling /api/extract-chunk', { fileId, chunkIndex: i, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, attempt });
        res = await fetch('/api/extract-chunk', {
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

        if (res.ok) break;

        const data = await res.json().catch(() => ({}));
        lastError = data.message ?? 'Extraction failed';
        console.log('[extract] chunk attempt failed', { fileId, chunkIndex: i, status: res.status, attempt, msg: lastError });

        if (!TRANSIENT_STATUSES.has(res.status)) {
          throw new Error(lastError);
        }
        if (attempt < MAX_ATTEMPTS) {
          const waitMs = RETRY_WAITS_MS[attempt - 1];
          callbacks.onRetry?.(fileId, i, attempts, MAX_ATTEMPTS, waitMs);
          callbacks.onProgress?.(fileId, i, `Model busy. Retrying chunk ${i + 1} of ${note.chunks.length} in ${waitMs / 1000} s (attempt ${attempts} of ${MAX_ATTEMPTS}).`);
          // Sleep in small increments so cancellation is responsive
          const end = Date.now() + waitMs;
          while (Date.now() < end) {
            if (callbacks.isCancelled?.()) {
              throw new Error('Cancelled');
            }
            await sleep(Math.min(1000, end - Date.now()));
          }
        }
      }

      if (!res.ok) {
        throw new Error(lastError);
      }

      const data = await res.json();
      const markdown = data.markdown;
      if (!markdown) {
        console.log('[extract] empty output from model', { fileId, chunkIndex: i });
        throw new Error('Empty output from model');
      }

      console.log('[extract] chunk succeeded', { fileId, chunkIndex: i, markdownLength: markdown.length });
      await updateNoteChunk(fileId, i, { status: 'ready', markdown });
      callbacks.onProgress?.(fileId, i, 'ready');
    } catch (e) {
      if (e instanceof Error && e.message === 'Cancelled') {
        console.log('[extract] chunk cancelled', { fileId, chunkIndex: i });
        await updateNoteChunk(fileId, i, { status: 'failed', error: 'Cancelled' });
        callbacks.onError?.(fileId, `Chunk ${i + 1} cancelled`);
        return;
      }
      const msg = e instanceof Error ? e.message : 'Chunk extraction failed';
      console.log('[extract] chunk error', { fileId, chunkIndex: i, error: msg });
      await updateNoteChunk(fileId, i, { status: 'failed', error: msg });
      await failNote(fileId, `Chunk ${i + 1} failed: ${msg}`);
      toast('error', 'Extraction failed', msg);
      callbacks.onError?.(fileId, `Chunk ${i + 1} failed: ${msg}`);
      return;
    }
  }

  // All chunks done, finalize
  console.log('[extract] all chunks completed, finalizing', { fileId });
  await finalizeNote(fileId);
  
  // Check if finalizeNote failed (it calls failNote internally)
  const finalNote = await db.notes.get(fileId);
  if (finalNote?.status === 'failed') {
    console.log('[extract] finalizeNote failed', { fileId, error: finalNote.lastError });
    toast('error', 'Extraction failed', finalNote.lastError);
    callbacks.onError?.(fileId, finalNote.lastError ?? 'Extraction failed');
    return;
  }
  
  toast('success', 'Extraction complete', 'Markdown ready');
  callbacks.onComplete?.(fileId);
}

/**
 * Start extraction for a file. Sets status to 'processing' and begins running.
 * Returns a promise that resolves when extraction completes or fails.
 */
export async function startExtraction(fileId: string, callbacks: RunnerCallbacks = {}): Promise<void> {
  console.log('[extract] startExtraction called', { fileId });
  const { db } = await import('../../db/db');
  const note = await db.notes.get(fileId);
  if (!note) {
    console.log('[extract] no note found for', fileId);
    return;
  }

  // Update status to processing
  await db.notes.put({ ...note, status: 'processing', updatedAt: new Date().toISOString() });

  // Run extraction
  await runExtraction(fileId, callbacks);
}