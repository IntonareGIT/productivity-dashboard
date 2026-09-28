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
 * - `aiProviders` holds API keys. Syncing it would copy the user's provider
 *   secret to the cloud, so each device configures its own key.
 */
export const UNSYNCED_TABLES = ['aiProviders'] as const;

/** Dexie Cloud blob handling. 'lazy' uploads a Blob's bytes to remote storage
 *  on first sync, keeping the local IndexedDB entry small. */
export const BLOB_MODE = 'lazy' as const;

/** Uploads above this size are warned about before they are stored. */
export const LARGE_BLOB_WARNING_BYTES = 20 * 1024 * 1024;
