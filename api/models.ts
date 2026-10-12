/**
 * /api/models — user-added AI models (per-user, encrypted keys).
 *
 * GET    -> { models: PublicModel[] }
 * POST   { displayName, adapter, baseUrl, modelId, capabilities, apiKey } -> { model: PublicModel }
 * DELETE ?id= -> { ok: true }
 *
 * All endpoints verify the Dexie Cloud token and scope to the user's `sub` claim.
 * API keys are encrypted with AES-256-GCM via keyVault and stored in Upstash Redis.
 * Key values are NEVER returned, logged, or included in errors.
 */
import type { ApiRequest, ApiResponse, VerifiedUser } from '../lib/server/dexie.js';
import { json, readBearer, verifyDexieToken, unauthorized, setCors } from '../lib/server/dexie.js';
import {
  listModels,
  createModel,
  updateModel,
  deleteModel,
  type CreateModelInput,
  type UpdateModelInput,
} from '../lib/server/models.js';

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
  setCors(req, res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const user = await getUser(req);
  if (!user) {
    unauthorized(res);
    return;
  }
  const { userId } = user;

  if (req.method === 'GET') {
    try {
      const models = await listModels(userId);
      json(res, 200, { models });
    } catch {
      serverError(res, 'Model store unavailable');
    }
    return;
  }

  // Test endpoint: POST /api/models/test { adapter, baseUrl, modelId, apiKey }
  // Returns { ok: true, message } or { ok: false, message }
  if (req.method === 'POST' && req.url?.includes('/test')) {
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
    const parsed = body as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      badInput(res, 'JSON body required');
      return;
    }

    // Validate required fields
    const displayName = typeof parsed.displayName === 'string' ? parsed.displayName.trim() : '';
    const adapter = parsed.adapter;
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
    const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : '';
    const capabilities = parsed.capabilities;
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';

    if (!displayName) {
      badInput(res, 'displayName is required');
      return;
    }
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
      // For gemini, baseUrl should be empty
      if (baseUrl) {
        badInput(res, 'baseUrl must be empty for gemini adapter');
        return;
      }
    }
    if (!modelId) {
      badInput(res, 'modelId is required');
      return;
    }
    if (!validateCapabilities(capabilities)) {
      badInput(res, 'capabilities must include chat, acceptsPdf, acceptsImages (all booleans)');
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

    // Test the key before saving
    const testResult = await testModelKey(adapter, baseUrl, modelId, apiKey);
    if (!testResult.ok) {
      json(res, 400, { error: 'test_failed', message: testResult.message });
      return;
    }

    try {
      const input: CreateModelInput = {
        displayName,
        adapter,
        baseUrl,
        modelId,
        capabilities,
        apiKey,
      };
      const model = await createModel(userId, input);
      json(res, 200, { model });
    } catch {
      serverError(res, 'Model store unavailable');
    }
    return;
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const id = url.searchParams.get('id');
    if (!id) {
      badInput(res, 'id query parameter is required');
      return;
    }
    try {
      const deleted = await deleteModel(userId, id);
      if (!deleted) {
        json(res, 404, { error: 'not_found', message: 'Model not found' });
        return;
      }
      json(res, 200, { ok: true });
    } catch {
      serverError(res, 'Model store unavailable');
    }
    return;
  }

  // PATCH for updates - read id from query parameter, not body
  if (req.method === 'PATCH') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const id = url.searchParams.get('id');
    if (!id) {
      badInput(res, 'id query parameter is required');
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

    const displayName = typeof parsed.displayName === 'string' ? parsed.displayName.trim() : undefined;
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : undefined;
    const modelId = typeof parsed.modelId === 'string' ? parsed.modelId.trim() : undefined;
    const capabilities = parsed.capabilities;
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : undefined;

    if (baseUrl !== undefined && baseUrl !== '' && !isValidUrl(baseUrl)) {
      badInput(res, 'baseUrl must be a valid HTTPS URL');
      return;
    }
    if (capabilities !== undefined && !validateCapabilities(capabilities)) {
      badInput(res, 'capabilities must include chat, acceptsPdf, acceptsImages (all booleans)');
      return;
    }
    if (apiKey !== undefined && apiKey.length > 300) {
      badInput(res, 'apiKey too long (max 300 characters)');
      return;
    }

    const input: UpdateModelInput = {};
    if (displayName !== undefined) input.displayName = displayName;
    if (baseUrl !== undefined) input.baseUrl = baseUrl;
    if (modelId !== undefined) input.modelId = modelId;
    if (capabilities !== undefined) input.capabilities = capabilities;
    if (apiKey !== undefined) input.apiKey = apiKey;

    try {
      const model = await updateModel(userId, id, input);
      if (!model) {
        json(res, 404, { error: 'not_found', message: 'Model not found' });
        return;
      }
      json(res, 200, { model });
    } catch {
      serverError(res, 'Model store unavailable');
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  json(res, 405, { error: 'method_not_allowed', message: 'Use GET, POST, PATCH, or DELETE.' });
}

async function testModelKey(
  adapter: 'gemini' | 'openai-compatible',
  baseUrl: string,
  modelId: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (adapter === 'gemini') {
      // Test with Gemini's generateContent endpoint
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }],
          generationConfig: { maxOutputTokens: 64 },
        }),
      });
      const responseText = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        // ignore parse error
      }
      console.log('[DEBUG] Gemini test response:', { status: res.status, keys: Object.keys(data), error: data.error });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid key (provider returned 401)' };
      }
      if (res.status === 404) {
        return { ok: false, message: 'Model ID not found at this provider' };
      }
      if (!res.ok) {
        return { ok: false, message: `Provider error (status ${res.status})` };
      }
      // Accept any 200 with candidates array as success, even if text is empty
      // (some models use tokens for internal reasoning)
      if (Array.isArray(data.candidates) && data.candidates.length > 0) {
        return { ok: true, message: 'Key valid' };
      }
      return { ok: false, message: 'Provider returned unexpected response' };
    } else {
      // Test with OpenAI-compatible chat/completions
      if (!baseUrl) {
        return { ok: false, message: 'baseUrl is required for openai-compatible' };
      }
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 16,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid key (provider returned 401)' };
      }
      if (res.status === 404) {
        return { ok: false, message: 'Model ID not found at this provider' };
      }
      if (!res.ok) {
        return { ok: false, message: `Provider error (status ${res.status})` };
      }
      return { ok: true, message: 'Key valid' };
    }
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('fetch')) {
      return { ok: false, message: 'Could not reach the provider at this address' };
    }
    return { ok: false, message: 'Could not reach the provider at this address' };
  }
}