import { getCloudAccessToken, getCloudUserId } from './cloudAuth';

/**
 * Authenticated client for the app's Vercel serverless functions.
 *
 * `/api/ai`, `/api/upload-url` and `/api/download-url` all verify the caller
 * with the user's DEXIE CLOUD ACCESS TOKEN before doing anything, so this is
 * the single place that attaches the header. No API key is ever held here —
 * the gateway reads its keys from this deployment's environment variables.
 *
 * Any call that fails verification lands in `cloudAuthRequired`, which the
 * caller can turn into a "sign in to Dexie Cloud" message.
 */
export class CloudApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
  }
}

export interface SignedUploadUrl {
  url: string;
  key: string;
  expiresIn: number;
}

export interface SignedDownloadUrl {
  url: string;
  key: string;
  expiresIn: number;
}

export interface R2ObjectCheck {
  exists: boolean;
}

/** POST a JSON body to one of the gateway functions, returning parsed JSON. */
async function gateway<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getCloudAccessToken();
  if (!token) throw new CloudApiError('Not signed in to Dexie Cloud.', 401);
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Request failed (${res.status}).`;
    throw new CloudApiError(message, res.status);
  }
  return body as T;
}

/** Ask the gateway for a 5-minute PUT presigned URL for `key`. */
export async function requestUploadUrl(key: string, contentType?: string): Promise<SignedUploadUrl> {
  return gateway<SignedUploadUrl>('/api/upload-url', {
    method: 'POST',
    body: JSON.stringify({ key, contentType }),
  });
}

/** Ask the gateway for a 5-minute GET presigned URL for `key`. */
export async function requestDownloadUrl(key: string): Promise<SignedDownloadUrl> {
  const q = `?key=${encodeURIComponent(key)}`;
  return gateway<SignedDownloadUrl>(`/api/download-url${q}`, { method: 'GET' });
}

/** True when a signed-in Dexie Cloud session exists. */
export function cloudAuthRequired(): boolean {
  return getCloudAccessToken() !== null;
}

/** The current user's id, used as the `{userId}/` prefix on R2 keys. */
export function currentUserId(): string | null {
  return getCloudUserId();
}

/** Upload bytes to R2 via a presigned PUT URL. Returns the final object key. */
export async function uploadToR2(
  key: string,
  file: Blob,
  contentType?: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<string> {
  const { url } = await requestUploadUrl(key, contentType);
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(key);
      else reject(new Error(`Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => {
      // A browser PUT to a presigned R2 URL always triggers a CORS preflight
      // (PUT is never a "simple" request). If the bucket has no CORS rule the
      // preflight dies before a single byte moves, which reads as a network
      // error and leaves the object at 0 bytes — that is the usual cause.
      reject(
        new Error(
          'Upload failed: network error. A presigned PUT needs a CORS rule on the R2 bucket ' +
          '(AllowedMethods: PUT, AllowedHeaders: Content-Type). See DEPLOY.md.',
        ),
      );
    };
    xhr.send(file);
  });
}

/** Check if an R2 object exists via HEAD request through the gateway. */
export async function checkR2Object(key: string): Promise<boolean> {
  const token = getCloudAccessToken();
  if (!token) throw new CloudApiError('Not signed in to Dexie Cloud.', 401);
  const res = await fetch('/api/check-r2-object', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ key }),
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Request failed (${res.status})`;
    throw new CloudApiError(message, res.status);
  }
  return (body as { exists: boolean }).exists ?? false;
}

/** Fetch a presigned download URL and return the object's bytes as a Blob. */
export async function downloadFromR2(key: string): Promise<Blob> {
  const { url } = await requestDownloadUrl(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed with status ${res.status}.`);
  return res.blob();
}

/**
 * Delete an object from R2 by key. Best-effort: a failure here must not break
 * deleting the local row, so callers catch it.
 */
export async function deleteCloudObject(key: string): Promise<void> {
  const { url } = await gateway<{ url: string }>(
    '/api/delete-url',
    { method: 'POST', body: JSON.stringify({ key }) },
  );
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed with status ${res.status}.`);
}