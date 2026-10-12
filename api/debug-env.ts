/**
 * /api/debug-env — reports which required env vars are present at runtime.
 * No auth required. Returns only names, never values.
 */
import type { ApiRequest, ApiResponse } from './_dexie.js';
import { json, setCors } from './_dexie.js';

const REQUIRED = [
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'KEY_ENCRYPTION_SECRET',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    json(res, 405, { error: 'method_not_allowed', message: 'Use GET.' });
    return;
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const key of REQUIRED) {
    if (process.env[key]) present.push(key);
    else missing.push(key);
  }
  const keyLen = process.env.KEY_ENCRYPTION_SECRET?.length ?? 0;
  const keyValid = keyLen === 64 && /^[0-9a-fA-F]{64}$/.test(process.env.KEY_ENCRYPTION_SECRET ?? '');

  json(res, 200, {
    present,
    missing,
    keyEncryptionSecret: { length: keyLen, validHex: keyValid },
  });
}