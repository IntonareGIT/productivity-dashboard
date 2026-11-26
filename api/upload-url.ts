/**
 * /api/upload-url — presigned R2 upload URL (a Vercel serverless function).
 *
 * The browser calls this BEFORE uploading a file, then PUTs the bytes
 * directly to the signed URL — file data never passes through Vercel.
 *
 * Security, in order:
 *   1. The Dexie Cloud access token in `Authorization: Bearer <token>` is
 *      verified exactly like in /api/ai (GET /token/validate, 200
 *      { valid: true } or 401). The verified `sub` claim IS the userId.
 *   2. The object key is FORCED under `{userId}/...`. A client-supplied key
 *      outside that prefix is rejected; one already inside it is kept, and a
 *      bare filename is prefixed. There is no path by which a user can mint a
 *      upload URL for another user's prefix.
 *   3. The URL is a PUT presign expiring after 5 minutes (300 s).
 *
 * Request:  POST { key: "<desired path or filename>", contentType?: "<mime>" }
 * Response: 200  { url, key, expiresIn }      — PUT the file bytes to `url`
 *           400  { error }                     — bad key / missing R2 config
 *           401  { error: 'unauthorized' }     — bad or missing Dexie token
 *           503  { error: 'not_configured' }   — R2 env vars missing
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  json,
  readBearer,
  requestOrigin,
  setCors,
  unauthorized,
  verifyDexieToken,
  type ApiRequest,
  type ApiResponse,
} from './_dexie.js';

export const maxDuration = 30;

/** R2's S3-compatible endpoint, derived from the account id (never logged). */
function endpoint(): string {
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function r2(): S3Client | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: endpoint(),
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Force the final key under the caller's own prefix. Rejects '..' segments
 * and absolute paths so `../../x` can never escape `{userId}/`.
 */
function scopeKey(userId: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^\/+/, '');
  if (!trimmed) return null;
  const segs = trimmed.split('/').filter((s) => s && s !== '.');
  if (segs.some((s) => s === '..')) return null;
  const scoped = segs[0] === userId ? segs.join('/') : [userId, ...segs].join('/');
  return scoped;
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

  // 1: same Dexie verification as /api/ai — 401 on anything unverified.
  const user = await verifyDexieToken(readBearer(req), requestOrigin(req));
  if (!user) {
    unauthorized(res);
    return;
  }

  const client = r2();
  const bucket = (process.env.R2_BUCKET ?? '').trim();
  if (!client || !bucket) {
    json(res, 503, {
      error: 'not_configured',
      message: 'R2 storage is not configured on this deployment.',
    });
    return;
  }

  // Vercel pre-parses JSON bodies; the string branch is the fallback.
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  // 2 + 3: user-scoped key, 5-minute PUT presign.
  const key = scopeKey(user.userId, payload.key);
  if (!key) {
    json(res, 400, {
      error: 'bad_request',
      message: 'A "key" (filename or path) is required and must not contain "..".',
    });
    return;
  }
  const contentType =
    typeof payload.contentType === 'string' && payload.contentType.trim()
      ? payload.contentType.trim().slice(0, 127)
      : 'application/octet-stream';

  try {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    );
    json(res, 200, { url, key, expiresIn: 300 });
  } catch {
    json(res, 502, {
      error: 'sign_failed',
      message: 'Could not create the upload URL. Try again shortly.',
    });
  }
}
