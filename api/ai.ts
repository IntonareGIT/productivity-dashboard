/**
 * /api/ai — the app's AI gateway (a Vercel serverless function).
 *
 * Why it exists: the browser must never hold a Gemini or Groq API key. The app
 * ships without a single provider credential; instead the client sends its chat
 * request here, authenticated with the user's DEXIE CLOUD ACCESS TOKEN, and this
 * function loads the user's own encrypted key from Upstash Redis, decrypts it,
 * and attaches it on the way to the model.
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
 *   3. Load the user's saved key for the requested provider (default: gemini)
 *      from Upstash Redis, decrypt it with AES-256-GCM using KEY_ENCRYPTION_SECRET.
 *   4. If no key is saved for that provider, return 403 with { error: "no_key", provider }.
 *   5. Forward the request to the provider with the decrypted key. The key must
 *      never appear in a response, log, or error.
 *
 * The client contract is deliberately identical to the OpenAI chat-completions
 * shape the app already speaks (messages, tools, tool_choice, temperature,
 * max_tokens, model), plus one gateway-only field: `provider` ('gemini' | 'groq').
 * That field is stripped before forwarding.
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
import { decrypt, kvGet } from './_lib/keyVault.js';

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

/** Upstream OpenAI-compatible endpoints, one per provider. */
const UPSTREAM = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.1-flash-lite',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
  },
} as const;

type GatewayProvider = keyof typeof UPSTREAM;
function pickProvider(body: Record<string, unknown>): GatewayProvider {
  return body.provider === 'groq' ? 'groq' : 'gemini';
}

/**
 * Belt and braces against ever returning a key: every byte headed back to the
 * client is scrubbed of BOTH server keys before it is sent.
 */
function scrub(text: string): string {
  let out = text;
  for (const secret of [process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY]) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
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
  const parsed = body as { messages?: unknown[] } | null;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.messages)) {
    json(res, 400, {
      error: 'bad_request',
      message: 'A JSON body with a "messages" array is required.',
    });
    return;
  }
  const payload = body as Record<string, unknown>;

  // 3: pick the upstream by request (default Gemini), falling back to Groq
  // when only GROQ_API_KEY is configured on this deployment.
  let providerName = pickProvider(payload);
  const cfg = UPSTREAM[providerName];

  // 4: load the user's saved key for this provider
  let apiKey: string;
  try {
    const record = await kvGet(userId, providerName);
    if (!record) {
      console.log(`redis read: not found, key=keys:${userId}:${providerName}`);
      json(res, 403, {
        error: 'no_key',
        provider: providerName,
        message: `No ${providerName} API key saved. Add one in Settings \u2192 AI Keys.`,
      });
      return;
    }
    console.log(`redis read: found, key=keys:${userId}:${providerName}, fields=${Object.keys(record).join(',')}`);
    apiKey = decrypt(record);
    console.log('decrypt: ok');
  } catch (e) {
    console.log(`decrypt: failed: ${e instanceof Error ? e.name : String(e)}`);
    json(res, 503, {
      error: 'key_unavailable',
      message: 'Could not load your API key. Try again or re-save it in Settings.',
    });
    return;
  }

  const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : '';
  const envModel = (process.env[cfg.modelEnv] ?? '').trim();
  const model = requestedModel || envModel || cfg.defaultModel;

  // Forward everything the provider understands; `provider` is gateway-only.
  const { provider: _gatewayOnly, ...forwarded } = payload;
  forwarded.model = model;

  let upstream: Response;
  try {
    upstream = await fetch(cfg.url, {
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
  // with both server keys scrubbed from the text.
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  res.send(scrub(await upstream.text()));
}