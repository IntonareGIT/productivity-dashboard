/**
 * Shared Dexie Cloud token verification for serverless functions.
 *
 * Every function trusts one thing only: a Dexie Cloud access token that Dexie
 * Cloud itself is willing to validate, via the documented token-validation
 * endpoint (REST API docs, "/token/validate"):
 *
 *   GET  https://<db>.dexie.cloud/token/validate
 *   Origin: <the origin the token was issued for>
 *   Authorization: Bearer <JWT>
 *   -> 200 { valid: true, claims: { sub, ... } }   when the JWT is genuine
 *
 * Anything else — missing header, non-200, `valid !== true`, or a network
 * error — counts as "not verified", and callers answer 401 without doing any
 * further work. The verified `claims` are returned because they carry the
 * user's identity (`sub`), which the R2 functions use to scope object keys.
 */
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * The Dexie Cloud database this app signs into. Mirrors `DEXIE_CLOUD_URL` in
 * `src/db/cloudConfig.ts` (safe to commit: a database URL, not a credential).
 * Tokens issued by a DIFFERENT database fail validation here — /token/validate
 * must be called on the same database that created the token.
 */
export const DEXIE_CLOUD_URL = 'https://zmofmso62.dexie.cloud';

/** Minimal typings for the Vercel Node runtime's req/res (no extra deps). */
export interface ApiRequest extends IncomingMessage {
  body?: unknown;
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): ApiResponse;
  send(body: string): ApiResponse;
}

export function setCors(req: ApiRequest, res: ApiResponse, methods: string): void {
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', methods);
}

export function json(res: ApiResponse, status: number, payload: unknown): void {
  res.status(status).json(payload);
}

/** Read `Authorization: Bearer <token>`, tolerating array-shaped headers. */
export function readBearer(req: ApiRequest): string | null {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Decode (NOT verify) the JWT payload's middle segment. Verification is Dexie
 * Cloud's job; this only echoes back the origin the token was issued for, so
 * it can be sent as the Origin header — exactly as the Dexie docs' example
 * does.
 */
export function decodeTokenOrigin(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const claims = JSON.parse(decoded) as { origin?: unknown };
    return typeof claims.origin === 'string' && claims.origin ? claims.origin : null;
  } catch {
    return null;
  }
}

/** The verified identity: the Dexie Cloud `sub` claim is the user's ID. */
export interface VerifiedUser {
  userId: string;
  claims: Record<string, unknown>;
}

/**
 * Verify the access token against Dexie Cloud's /token/validate endpoint.
 * Returns the verified user (with the `sub` claim as userId) or null.
 * Fails CLOSED: missing token, non-200, `valid !== true`, a missing `sub`,
 * and network errors all yield null.
 */
export async function verifyDexieToken(
  token: string | null,
  requestOrigin: string | null,
): Promise<VerifiedUser | null> {
  if (!token) return null;
  const origin = decodeTokenOrigin(token) ?? requestOrigin ?? undefined;
  try {
    const res = await fetch(`${DEXIE_CLOUD_URL}/token/validate`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(origin ? { Origin: origin } : {}),
      },
    });
    if (!res.status || res.status !== 200) return null;
    const body = (await res.json()) as { valid?: unknown; claims?: unknown };
    if (body?.valid !== true) return null;
    const claims =
      body.claims && typeof body.claims === 'object'
        ? (body.claims as Record<string, unknown>)
        : null;
    const userId = claims && typeof claims.sub === 'string' ? claims.sub.trim() : '';
    if (!claims || !userId) return null;
    return { userId, claims };
  } catch {
    return null;
  }
}

/** Read the request's Origin header, or null when absent. */
export function requestOrigin(req: ApiRequest): string | null {
  const raw = req.headers?.origin;
  return typeof raw === 'string' && raw ? raw : null;
}

/** The standard 401 answer every api/* function sends for a bad token. */
export function unauthorized(res: ApiResponse): void {
  json(res, 401, {
    error: 'unauthorized',
    message: 'Dexie Cloud rejected the access token. Sign in again from Settings \u2192 Sync.',
  });
}