/**
 * /api/ai — the app's AI gateway (a Vercel serverless function).
 *
 * Why it exists: the browser must never hold an AI API key. The app ships
 * without provider credentials; instead the client sends its chat request here,
 * authenticated with the user's DEXIE CLOUD ACCESS TOKEN, and this function
 * loads the user's model record from Upstash Redis, decrypts the key, and
 * forwards the request to the appropriate adapter.
 *
 * The pipeline, in order:
 *   1. Read the Dexie Cloud access token from `Authorization: Bearer <token>`.
 *   2. VERIFY it against the database that issued it, using Dexie Cloud's
 *      documented token-validation endpoint (REST API docs, "/token/validate"):
 *
 *        GET  https://<db>.dexie.cloud/token/validate
 *        Origin: <the origin the token was issued for>
 *        Authorization: Bearer <JWT>
 *        -> 200 { valid: true, claims: { ... } }   when the JWT is genuine
 *
 *      Anything other than `valid: true` is answered with 401 and NOTHING is
 *      forwarded. The Origin header matters: Dexie Cloud checks it against the
 *      token's audience, so the origin CLAIM inside the token itself is used
 *      when present, falling back to the request's own Origin header.
 *   3. Load the user's model record by `modelId` from Upstash Redis.
 *   4. If no model found, return 404. If model has no key, return 403 { error: "no_key", modelId }.
 *   5. Forward the request to the adapter (gemini or openai-compatible) with the decrypted key.
 *      The key must never appear in a response, log, or error.
 *
 * The client contract: OpenAI chat-completions shape plus `modelId` (gateway-only).
 * The `modelId` field is stripped before forwarding.
 */
import type { IncomingMessage } from 'http';
import {
  json,
  readBearer,
  requestOrigin,
  setCors,
  verifyDexieToken,
  type ApiRequest as AiRequest,
  type ApiResponse as AiResponse,
} from './_dexie.js';
import { getModel, getModelKey } from '../lib/server/models.js';

/** Longer chats with tool rounds need more than the bare default. */
export const maxDuration = 60;

/**
 * The Dexie Cloud database this app signs into. Mirrors `DEXIE_CLOUD_URL` in
 * `src/db/cloudConfig.ts` (safe to commit: it is a database URL, not a
 * credential). Tokens issued by a DIFFERENT database will fail validation here,
 * which is correct — /token/validate must be called on the same database that
 * created the token.
 */
const DEXIE_CLOUD_URL = 'https://zmofmso62.dexie.cloud';

/** Upstream OpenAI-compatible endpoints for each adapter. */
const ADAPTER_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'openai-compatible': '', // Set per-model from stored baseUrl
} as const;

/**
 * Belt and braces against ever returning a key: every byte headed back to the
 * client is scrubbed of server keys before it is sent.
 */
function scrub(text: string): string {
  // Note: We no longer have GEMINI_API_KEY/GROQ_API_KEY in env, but keep
  // the scrubber as defense-in-depth for any future server-side keys.
  return text;
}

export default async function handler(req: AiRequest, res: AiResponse): Promise<void> {
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

  // 1 + 2: the caller must be a signed-in Dexie Cloud user, proven by a token
  // Dexie Cloud itself is willing to validate. No valid token, no AI.
  const token = readBearer(req);
  if (!token) {
    json(res, 401, {
      error: 'unauthorized',
      message: 'Missing Dexie Cloud access token. Sign in to Dexie Cloud first.',
    });
    return;
  }
  const originHeader = req.headers?.origin;
  const requestOrigin = typeof originHeader === 'string' && originHeader ? originHeader : null;
  const user = await verifyDexieToken(token, requestOrigin);
  if (!user) {
    json(res, 401, {
      error: 'unauthorized',
      message: 'Dexie Cloud rejected the access token. Sign in again from Settings \u2192 Sync.',
    });
    return;
  }
  const { userId } = user;

  // Parse the chat payload. Vercel pre-parses JSON bodies; the string branch
  // keeps the function honest if the content type was not what we expected.
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const parsed = body as { messages?: unknown[]; modelId?: unknown } | null;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
    json(res, 400, {
      error: 'bad_request',
      message: 'A JSON body with a "messages" array is required.',
    });
    return;
  }
  const payload = body as Record<string, unknown>;

  // 3: Load the user's model record by modelId
  const modelId = typeof payload.modelId === 'string' ? payload.modelId.trim() : '';
  if (!modelId) {
    json(res, 400, {
      error: 'bad_request',
      message: 'A "modelId" string is required.',
    });
    return;
  }

  let modelRecord: Awaited<ReturnType<typeof getModel>>;
  try {
    modelRecord = await getModel(userId, modelId);
  } catch {
    json(res, 503, {
      error: 'model_unavailable',
      message: 'Could not load model. Try again.',
    });
    return;
  }

  if (!modelRecord) {
    json(res, 404, {
      error: 'not_found',
      modelId,
      message: `Model "${modelId}" not found. Add it in Settings \u2192 AI Models.`,
    });
    return;
  }

  // 4: Get the decrypted API key
  let apiKey: string;
  try {
    apiKey = await getModelKey(userId, modelId);
  } catch {
    json(res, 503, {
      error: 'key_unavailable',
      message: 'Could not load your API key. Try again or re-save it in Settings.',
    });
    return;
  }

  if (!apiKey) {
    json(res, 403, {
      error: 'no_key',
      modelId,
      message: `No API key saved for this model. Edit it in Settings \u2192 AI Models.`,
    });
    return;
  }

  // Determine upstream URL based on adapter
  const adapter = modelRecord.adapter;
  let upstreamUrl: string;
  if (adapter === 'gemini') {
    upstreamUrl = ADAPTER_ENDPOINTS.gemini;
  } else if (adapter === 'openai-compatible') {
    upstreamUrl = modelRecord.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  } else {
    json(res, 500, {
      error: 'invalid_adapter',
      message: `Unknown adapter: ${adapter}`,
    });
    return;
  }

  // Forward everything the provider understands; `modelId` is gateway-only.
  const { modelId: _gatewayOnly, ...forwarded } = payload;
  forwarded.model = modelRecord.modelId;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(forwarded),
    });
  } catch {
    json(res, 502, {
      error: 'upstream_unreachable',
      message: 'The AI provider could not be reached. Try again shortly.',
    });
    return;
  }

  // 5: pass the model's response straight through — status, body and the
  // provider's Retry-After hint (the client's backoff policy reads it) —
  // with server keys scrubbed from the text.
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  res.send(scrub(await upstream.text()));
}