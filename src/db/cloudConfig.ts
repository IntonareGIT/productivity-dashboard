/**
 * Dexie Cloud configuration.
 *
 * The database URL is committed here on purpose. It is read from THIS file at
 * build/run time — never from `dexie-cloud.json`, which is gitignored and does
 * not exist on the Vercel build server.
 *
 * `dexie-cloud.key` is a SECRET. It is gitignored and must never be committed,
 * printed, or read at build time. On a fresh clone (CI, Vercel) the addon falls
 * back to anonymous access, which is exactly what we want until the user signs
 * in from Settings.
 */

/** Dexie Cloud database URL — safe to commit (it is not a credential). */
export const DEXIE_CLOUD_URL = 'https://zmofmso62.dexie.cloud';

/**
 * Tables that must never leave the device.
 *
 * Currently EMPTY: every table, including `aiProviders`, now syncs to the
 * user's Dexie Cloud account. Provider records (label, baseUrl, apiKey,
 * modelName, isDefault, supportsImages) are therefore available on every
 * signed-in device.
 *
 * This is a deliberate change: `aiProviders` was previously excluded here so
 * API keys could not reach the cloud. The account is per-user, and the addon
 * already requires sign-in before anything syncs, so the key stays within the
 * user's own account. Settings states this plainly under AI Providers.
 *
 * Kept as an export (rather than deleted) so the exclusion point stays visible
 * and a future table can be opted out in one place.
 */
export const UNSYNCED_TABLES: readonly string[] = [];

/** Dexie Cloud blob handling. 'lazy' uploads a Blob's bytes to remote storage
 *  on first sync, keeping the local IndexedDB entry small. */
export const BLOB_MODE = 'lazy' as const;

/** Uploads above this size are warned about before they are stored. */
export const LARGE_BLOB_WARNING_BYTES = 20 * 1024 * 1024;
