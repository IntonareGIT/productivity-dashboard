import { getCloudAccessToken } from './cloudAuth';
import type { UserModel } from '../../types';

export interface FetchModelsResult {
  models: UserModel[];
  error: null;
}

export interface FetchModelsError {
  models: null;
  error: {
    message: string;
    status: number | null;
    code: string;
  };
}

export type FetchModelsResponse = FetchModelsResult | FetchModelsError;

export async function fetchUserModels(): Promise<FetchModelsResponse> {
  const token = getCloudAccessToken();
  if (!token) {
    return {
      models: null,
      error: {
        message: 'Sign in first. Open Settings → Sync to sign in to Dexie Cloud.',
        status: null,
        code: 'NO_TOKEN',
      },
    };
  }

  try {
    const res = await fetch('/api/models', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      let message: string;
      let code: string;
      if (res.status === 401) {
        message = 'Could not load models (HTTP 401) — session expired or invalid. Sign in again from Settings → Sync.';
        code = 'UNAUTHORIZED';
      } else if (res.status === 503) {
        message = 'Could not load models (HTTP 503) — model store unavailable. Check KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.';
        code = 'SERVICE_UNAVAILABLE';
      } else if (res.status === 404) {
        message = 'Could not load models (HTTP 404) — route not found. Check Vercel functions are deployed.';
        code = 'NOT_FOUND';
      } else {
        message = `Could not load models (HTTP ${res.status})`;
        code = 'SERVER_ERROR';
      }
      return {
        models: null,
        error: { message, status: res.status, code },
      };
    }

    const data = await res.json();
    return {
      models: (data.models ?? []) as UserModel[],
      error: null,
    };
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('fetch')) {
      return {
        models: null,
        error: {
          message: 'Network error — could not reach the server.',
          status: null,
          code: 'NETWORK_ERROR',
        },
      };
    }
    return {
      models: null,
      error: {
        message: 'Network error',
        status: null,
        code: 'NETWORK_ERROR',
      },
    };
  }
}

/**
 * Filter models to only those with a saved key AND PDF capability.
 * Returns models ready for the "Extract now" dropdown.
 */
export function getPdfCapableModels(models: UserModel[]): UserModel[] {
  return models.filter((m) => m.capabilities.acceptsPdf && m.hasKey);
}