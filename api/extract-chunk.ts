/**
 * /api/extract-chunk — extract one page range from a user's PDF.
 *
 * POST { fileId, modelId, pageStart, pageEnd }
 * -> { markdown, pageStart, pageEnd }
 *
 * Auth: Dexie Cloud token via Authorization header.
 * 401 if missing/invalid. 403 if file belongs to another user or model has no key.
 * 400 if model lacks acceptsPdf. 502 on empty model output or provider error.
 */
import type { ApiRequest, ApiResponse, VerifiedUser } from '../lib/server/dexie.js';
import { json, readBearer, verifyDexieToken, unauthorized, setCors } from '../lib/server/dexie.js';
import { getModel } from '../lib/server/models.js';
import { downloadFromR2Server } from '../lib/server/cloudClient.js';
import { extractChunk, type ExtractChunkError } from '../lib/server/extractChunk.js';

function badInput(res: ApiResponse, message: string): void {
  json(res, 400, { error: 'bad_request', message });
}

function serverError(res: ApiResponse, message: string): void {
  json(res, 503, { error: 'service_unavailable', message });
}

async function getUser(req: ApiRequest): Promise<VerifiedUser | null> {
  const token = readBearer(req);
  if (!token) return null;
  const origin = req.headers?.origin ?? undefined;
  return verifyDexieToken(token, origin ?? null);
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  const user = await getUser(req);
  if (!user) {
    unauthorized(res);
    return;
  }
  const { userId } = user;

  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const parsed = body as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    badInput(res, 'JSON body required');
    return;
  }

  const fileId = typeof parsed.fileId === 'string' ? parsed.fileId.trim() : '';
  const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
  const pageStart = Number(parsed.pageStart);
  const pageEnd = Number(parsed.pageEnd);

  if (!fileId || !modelId || !Number.isInteger(pageStart) || !Number.isInteger(pageEnd)) {
    badInput(res, 'fileId, modelId, pageStart, pageEnd are required');
    return;
  }
  if (pageStart < 1 || pageEnd < pageStart) {
    badInput(res, 'Invalid page range');
    return;
  }

  // Load the model and verify it belongs to this user
  const model = await getModel(userId, modelId);
  if (!model) {
    badInput(res, 'Model not found');
    return;
  }
  if (!model.capabilities.acceptsPdf) {
    json(res, 400, { error: 'model_cannot_accept_pdf', message: 'This model does not accept PDFs.' });
    return;
  }

  // Load the resource to get its r2Key and verify ownership
  // We need to access Dexie - but this is a serverless function.
  // The resource row is in the user's Dexie Cloud DB, not accessible here.
  // We'll rely on the R2 key prefix check instead: the r2Key must start with the user's ID.
  // The resource's r2Key is not available here without a DB call.
  // For now, we'll download from R2 and verify the key prefix.
  // The actual ownership check happens at the R2 level via the key prefix.

  // We need the r2Key from the resource. Since we can't query Dexie from here,
  // we'll need to pass the r2Key from the client, or we need a different approach.
  // For now, let's require the r2Key in the request.
  // Actually, the client can pass the r2Key since it has the resource row.

  const r2Key = typeof parsed.r2Key === 'string' ? parsed.r2Key.trim() : '';
  if (!r2Key) {
    badInput(res, 'r2Key is required');
    return;
  }

  // Verify the r2Key belongs to this user (prefix check)
  const expectedPrefix = `${userId}/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    json(res, 403, { error: 'forbidden', message: 'File does not belong to you.' });
    return;
  }

  // Download PDF from R2
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await downloadFromR2Server(r2Key);
  } catch {
    json(res, 503, { error: 'r2_unavailable', message: 'Could not download file from storage.' });
    return;
  }

  // Extract the chunk
  try {
    const result = await extractChunk(pdfBytes, model, pageStart, pageEnd, userId);
    json(res, 200, result);
  } catch (e) {
    const err = e as ExtractChunkError;
    if (err && typeof err === 'object' && 'status' in err) {
      if (err.error === 'no_key') {
        json(res, 403, { error: 'no_key', message: 'Model has no API key saved.' });
        return;
      }
      if (err.error === 'empty_output') {
        json(res, 502, { error: 'empty_output', message: 'Model returned empty output.' });
        return;
      }
      json(res, err.status ?? 502, { error: 'extraction_failed', message: err.error ?? 'Extraction failed.' });
      return;
    }
    json(res, 502, { error: 'extraction_failed', message: 'Extraction failed.' });
  }
}