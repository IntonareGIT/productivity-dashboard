/**
 * /api/download-url — presigned R2 download URL (a Vercel serverless function).
 *
 * The browser calls this when OPENING a file, then fetches or navigates to
 * the signed URL — file bytes never pass through Vercel.
 *
 * Security, in order:
 *   1. The Dexie Cloud access token in `Authorization: Bearer <token>` is
 *      verified exactly like in /api/ai (GET /token/validate, 200
 *      { valid: true } or 401). The verified `sub` claim IS the userId.
 *   2. The requested key must ALREADY start with `{userId}/`. Any key
 *      outside the caller's own prefix is rejected with 403 — this is what
 *      stops users from opening each other's files.
 *   3. The URL is a GET presign expiring after 5 minutes (300 s).
 *
 * Request:  GET /api/download-url?key={userId}/...   (preferred)
 *           POST { key }                              (same rules)
 * Response: 200  { url, key, expiresIn }
 *           400  { error }                  — missing key
 *           401  { error: 'unauthorized' }  — bad or missing Dexie token
 *           403  { error: 'forbidden' }     — key outside the caller's prefix
 *           503  { error: 'not_configured' }— R2 env vars missing
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
 * The requested key is ONLY accepted when it is already inside the caller's
 * own `{userId}/` prefix — no auto-prefixing here, so a key for another
 * user's file can never be "fixed up" into something signable.
 */
function ownKey(userId: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().replace(/^\/+/, '');
  if (!key || key.includes('..')) return null;
  return key === userId || key.startsWith(`${userId}/`) ? key : null;
}

/** Read `key` from the query string (GET) or the JSON body (POST). */
function readKey(req: ApiRequest): unknown {
  if (req.method === 'GET') {
    const url = typeof req.url === 'string' ? req.url : '';
    const q = url.indexOf('?');
    if (q >= 0) {
      try {
        return new URL(url.slice(q), 'http://localhost').searchParams.get('key');
      } catch {
        return null;
      }
    }
    return null;
  }
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object'
    ? (body as Record<string, unknown>).key
    : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    json(res, 405, { error: 'method_not_allowed', message: 'Use GET or POST.' });
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

  const rawKey = readKey(req);
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    json(res, 400, { error: 'bad_request', message: 'A "key" query parameter is required.' });
    return;
  }

  // 2 + 3: only the caller's own prefix, 5-minute GET presign.
  const key = ownKey(user.userId, rawKey);
  if (!key) {
    json(res, 403, {
      error: 'forbidden',
      message: 'That file does not belong to your account.',
    });
    return;
  }

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 300 },
    );
    json(res, 200, { url, key, expiresIn: 300 });
  } catch {
    json(res, 502, {
      error: 'sign_failed',
      message: 'Could not create the download URL. Try again shortly.',
    });
  }
}
