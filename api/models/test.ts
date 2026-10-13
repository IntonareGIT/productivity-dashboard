/**
 * /api/models/test — test a model key without saving.
 *
 * POST { adapter, baseUrl, modelId, apiKey } -> { ok: true, message } | { ok: false, message }
 *
 * Verifies the Dexie Cloud token and scopes to the user's `sub` claim.
 * Never logs the API key.
 */
import type { ApiRequest, ApiResponse, VerifiedUser } from '../lib/server/dexie.js';
import { json, readBearer, verifyDexieToken, unauthorized, setCors } from '../lib/server/dexie.js';
import { testModelKey } from './models.js';

function badInput(res: ApiResponse, message: string): void {
  json(res, 400, { error: 'bad_request', message });
}

async function getUser(req: ApiRequest): Promise<VerifiedUser | null> {
  const token = readBearer(req);
  if (!token) return null;
  const origin = req.headers?.origin ?? undefined;
  return verifyDexieToken(token, origin ?? null);
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateCapabilities(caps: unknown): caps is { chat: boolean; acceptsPdf: boolean; acceptsImages: boolean } {
  return (
    caps !== null &&
    typeof caps === 'object' &&
    'chat' in caps &&
    'acceptsPdf' in caps &&
    'acceptsImages' in caps &&
    typeof (caps as Record<string, unknown>).chat === 'boolean' &&
    typeof (caps as Record<string, unknown>).acceptsPdf === 'boolean' &&
    typeof (caps as Record<string, unknown>).acceptsImages === 'boolean'
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const user = await getUser(req);
  if (!user) {
    unauthorized(res);
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
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
  const parsed = body as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    badInput(res, 'JSON body required');
    return;
  }

  const adapter = parsed.adapter;
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
  const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
  const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';

  if (adapter !== 'gemini' && adapter !== 'openai-compatible') {
    badInput(res, 'adapter must be "gemini" or "openai-compatible"');
    return;
  }
  if (adapter === 'openai-compatible') {
    if (!baseUrl || !isValidUrl(baseUrl)) {
      badInput(res, 'baseUrl must be a valid HTTPS URL for openai-compatible adapter');
      return;
    }
  } else {
    if (baseUrl) {
      badInput(res, 'baseUrl must be empty for gemini adapter');
      return;
    }
  }
  if (!modelId) {
    badInput(res, 'modelId is required');
    return;
  }
  if (!apiKey) {
    badInput(res, 'apiKey is required');
    return;
  }
  if (apiKey.length > 300) {
    badInput(res, 'apiKey too long (max 300 characters)');
    return;
  }

  const testResult = await testModelKey(adapter, baseUrl, modelId, apiKey);
  console.log('[DEBUG] testModelKey result:', { adapter, status: testResult.ok ? 'ok' : 'fail', message: testResult.message });
  if (!testResult.ok) {
    json(res, 400, { error: 'test_failed', message: testResult.message });
    return;
  }
  json(res, 200, { ok: true, message: testResult.message });
}