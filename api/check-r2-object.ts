/**
 * API endpoint to check if an R2 object exists via HEAD request.
 * POST { key } -> { exists: boolean, size?: number }
 */
import { PutObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

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

  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const key = scopeKey(user.userId, payload.key);
  if (!key) {
    json(res, 400, {
      error: 'bad_request',
      message: 'A "key" is required and must not contain "..".',
    });
    return;
  }

  try {
    const cmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
    await client.send(cmd);
    json(res, 200, { exists: true });
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      json(res, 200, { exists: false });
    } else {
      json(res, 502, {
        error: 'head_failed',
        message: 'Could not check object existence.',
      });
    }
  }
}