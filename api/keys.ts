/**
 * /api/keys — per-user encrypted AI provider keys.
 *
 * GET  -> { gemini: boolean, groq: boolean }
 * POST { provider, apiKey } -> { ok: true }
 * DELETE?provider= -> { ok: true }
 *
 * All endpoints verify the Dexie Cloud token and scope to the user's `sub` claim.
 * Keys are encrypted with AES-256-GCM via keyVault and stored in Upstash Redis.
 * Key values are NEVER returned, logged, or included in errors.
 */
import type { ApiRequest, ApiResponse, VerifiedUser } from './_dexie.js';
import { json, readBearer, verifyDexieToken, unauthorized } from './_dexie.js';
import { encrypt, kvGet, kvSet, kvDelete } from './_lib/keyVault.js';

const ALLOWED_PROVIDERS = ['gemini', 'groq'] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && ALLOWED_PROVIDERS.includes(v as Provider);
}

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
  const user = await getUser(req);
  if (!user) {
    unauthorized(res);
    return;
  }

  const { userId } = user;

  if (req.method === 'GET') {
    try {
      const [geminiRec, groqRec] = await Promise.all([
        kvGet(userId, 'gemini'),
        kvGet(userId, 'groq'),
      ]);
      json(res, 200, {
        gemini: !!geminiRec,
        groq: !!groqRec,
      });
    } catch {
      serverError(res, 'Key store unavailable');
    }
    return;
  }

  if (req.method === 'POST') {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const parsed = body as { provider?: unknown; apiKey?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') {
      badInput(res, 'JSON body required');
      return;
    }
    if (!isProvider(parsed.provider)) {
      badInput(res, 'provider must be "gemini" or "groq"');
      return;
    }
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    if (!apiKey) {
      badInput(res, 'apiKey is required');
      return;
    }
    if (apiKey.length > 300) {
      badInput(res, 'apiKey too long (max 300 characters)');
      return;
    }
    try {
      const record = encrypt(apiKey);
      const body = JSON.stringify(record);
      console.log(`redis write: key=keys:${userId}:${parsed.provider}, ivLen=${record.iv.length}, tagLen=${record.tag.length}, ciphertextLen=${record.ciphertext.length}`);
      await kvSet(userId, parsed.provider, record);
      json(res, 200, { ok: true });
    } catch {
      serverError(res, 'Key store unavailable');
    }
    return;
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const provider = url.searchParams.get('provider');
    if (!isProvider(provider)) {
      badInput(res, 'provider query parameter must be "gemini" or "groq"');
      return;
    }
    try {
      await kvDelete(userId, provider);
      json(res, 200, { ok: true });
    } catch {
      serverError(res, 'Key store unavailable');
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  json(res, 405, { error: 'method_not_allowed', message: 'Use GET, POST, or DELETE.' });
}