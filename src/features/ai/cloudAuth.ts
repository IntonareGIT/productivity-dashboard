import { db } from '../../db/db';

/**
 * Dexie Cloud session, as the AI gateway sees it.
 *
 * Chat requests no longer carry a provider API key — they are authenticated
 * with the user's DEXIE CLOUD ACCESS TOKEN and sent to `/api/ai`, which
 * verifies the token against Dexie Cloud and attaches the server-side key.
 * This module is the single place that reads that token.
 */

/**
 * The signed-in user's Dexie Cloud access token, or null when signed out.
 *
 * Read from the addon's `currentUser` observable (the `UserLogin` row keeps a
 * short-lived `accessToken` alongside the session). Defensive by design: any
 * missing piece — addon not attached, no current user, no token yet — is
 * simply "not signed in", never a crash.
 */
export function getCloudAccessToken(): string | null {
  try {
    const cloud = (db as {
      cloud?: { currentUser?: { value?: { accessToken?: unknown } } };
    }).cloud;
    const token = cloud?.currentUser?.value?.accessToken;
    return typeof token === 'string' && token.trim() ? token : null;
  } catch {
    return null;
  }
}

/**
 * Whether a cloud token is REQUIRED for the assistant.
 *
 * True whenever the Dexie Cloud addon is attached to the database, which in
 * the shipping app is always. The check exists so environments that replace
 * the database wholesale (the verify scripts' db stubs) can drive the chat
 * code paths without standing up a cloud session.
 */
export function cloudAuthRequired(): boolean {
  return (db as { cloud?: unknown }).cloud != null;
}

/** Shown wherever a request is blocked for lack of a Dexie Cloud session. */
export const CLOUD_SIGN_IN_REQUIRED =
  'The assistant verifies who you are with Dexie Cloud. Sign in from Settings → Sync, then try again.';
