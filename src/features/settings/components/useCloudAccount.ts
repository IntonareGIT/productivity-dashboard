import { useCallback, useEffect, useState } from 'react';
import { db } from '../../../db/db';
import { DEXIE_CLOUD_URL } from '../../../db/cloudConfig';
import { toast } from '../../../stores/useToastStore';

export interface CloudAccountState {
  /** From the addon's real login flag — NOT currentUserId, which is truthy when anonymous. */
  signedIn: boolean;
  email: string | null;
  /** Human label. Never claims "Synced" while signed out. */
  status: string;
  tone: 'ok' | 'busy' | 'warn' | 'error' | 'muted';
  /** True while the cloud still has work to push or pull. */
  pendingWork: boolean;
  errorMessage: string | null;
  diagnostics: { userId: string; cloudHost: string; origin: string; loggedIn: boolean };
}

const SIGNED_OUT: CloudAccountState = {
  signedIn: false,
  email: null,
  status: 'Not signed in',
  tone: 'muted',
  pendingWork: false,
  errorMessage: null,
  diagnostics: { userId: '—', cloudHost: '—', origin: '—', loggedIn: false },
};

export interface CloudAccount {
  state: CloudAccountState;
  busy: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  clearError: () => void;
}

/**
 * Single source of truth for account + sync state.
 *
 * Shared by Settings → Sync and the top-bar profile menu so both read the same
 * observables and never diverge. Sign-out safety (erasing local data and the
 * unsynced API key) is enforced by the shared UI, not per call site.
 */
export function useCloudAccount(): CloudAccount {
  const [state, setState] = useState<CloudAccountState>(SIGNED_OUT);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const cloud = db.cloud;
    if (!cloud) return;

    // Static diagnostics: which cloud we point at, and where from.
    const origin = typeof window !== 'undefined' ? window.location.origin : '—';
    let cloudHost = DEXIE_CLOUD_URL;
    try {
      cloudHost = new URL(DEXIE_CLOUD_URL).host;
    } catch {
      cloudHost = 'invalid URL';
    }

    const read = () => {
      const user = cloud.currentUser?.value;
      // `currentUserId` is a non-empty string even for the anonymous realm, so
      // it must never be used as the signed-in test. `isLoggedIn` is the real flag.
      const signedIn = user?.isLoggedIn === true;
      const userId = user?.userId ?? '—';
      const sync = cloud.syncState?.value;

      if (!signedIn) {
        setState({
          ...SIGNED_OUT,
          errorMessage: null,
          diagnostics: { userId, cloudHost, origin, loggedIn: false },
        });
        return;
      }

      const email = user?.email ?? null;
      const base = { userId, cloudHost, origin, loggedIn: true };
      // phase: initial | not-in-sync | pushing | pulling | in-sync | error | offline
      switch (sync?.phase) {
        case 'in-sync':
          setState({ ...base, signedIn: true, email, status: 'Synced', tone: 'ok', pendingWork: false, errorMessage: null, diagnostics: base });
          break;
        case 'pushing':
          setState({ ...base, signedIn: true, email, status: 'Syncing — uploading', tone: 'busy', pendingWork: true, errorMessage: null, diagnostics: base });
          break;
        case 'pulling':
          setState({ ...base, signedIn: true, email, status: 'Syncing — downloading', tone: 'busy', pendingWork: true, errorMessage: null, diagnostics: base });
          break;
        case 'offline':
          setState({ ...base, signedIn: true, email, status: 'Offline — changes will sync later', tone: 'warn', pendingWork: true, errorMessage: null, diagnostics: base });
          break;
        case 'error':
          setState({ ...base, signedIn: true, email, status: 'Sync error', tone: 'error', pendingWork: true, errorMessage: sync?.error?.message ?? 'The last sync failed.', diagnostics: base });
          break;
        default:
          setState({ ...base, signedIn: true, email, status: 'Syncing…', tone: 'busy', pendingWork: true, errorMessage: null, diagnostics: base });
      }
    };

    read();
    const subs = [cloud.currentUser, cloud.syncState, cloud.webSocketStatus]
      .filter(Boolean)
      .map((o: { subscribe(fn: () => void): { unsubscribe(): void } }) => o.subscribe(read));
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setLocalError(null);
    try {
      // login() drives the addon's own email + code dialog. Ask for an explicit
      // sync afterwards so the first pull completes promptly.
      await db.cloud?.login();
      await db.cloud?.sync().catch(() => undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reach Dexie Cloud.';
      setLocalError(message);
      toast('error', 'Sign-in failed', message);
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await db.cloud?.logout({ force: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Try again, or clear site data in your browser.';
      setLocalError(message);
      toast('error', 'Sign-out failed', message);
    } finally {
      setBusy(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await db.cloud?.sync();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'You appear to be offline. Changes are kept locally.';
      setLocalError(message);
      toast('error', 'Sync failed', message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state: localError ? { ...state, errorMessage: localError } : state,
    busy,
    signIn,
    signOut,
    syncNow,
    clearError: () => setLocalError(null),
  };
}
