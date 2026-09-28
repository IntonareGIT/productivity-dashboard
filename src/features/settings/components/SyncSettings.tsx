import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, Download, LogIn, LogOut, RefreshCw, TriangleAlert } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { db } from '../../../db/db';
import { exportAllData } from '../../../db/backup';
import { DEXIE_CLOUD_URL, UNSYNCED_TABLES } from '../../../db/cloudConfig';
import { toast } from '../../../stores/useToastStore';

interface CloudState {
  signedIn: boolean;
  email: string | null;
  /** Human label. Never claims "Synced" while signed out. */
  status: string;
  tone: 'ok' | 'busy' | 'warn' | 'error' | 'muted';
  /** True while the cloud still has work to push or pull. */
  pendingWork: boolean;
  /** Login or sync error, shown on screen rather than swallowed. */
  errorMessage: string | null;
}

const IDLE: CloudState = {
  signedIn: false,
  email: null,
  status: 'Not signed in',
  tone: 'muted',
  pendingWork: false,
  errorMessage: null,
};

/**
 * Settings → Sync.
 *
 * Reads live status from the Dexie Cloud observables. The app is fully usable
 * when signed out; this panel only reflects and controls sync.
 */
export const SyncSettings: React.FC = () => {
  const [state, setState] = useState<CloudState>(IDLE);
  const [busy, setBusy] = useState(false);
  const [confirmingOut, setConfirmingOut] = useState(false);
  const [ackErase, setAckErase] = useState(false);
  // Login/sign-out/sync failures are shown in the panel, not only as a toast.
  const [localError, setLocalError] = useState<string | null>(null);
  // Diagnostics: the addon's real user id, cloud host and this page's origin.
  const [diag, setDiag] = useState({ userId: '—', cloudHost: '—', origin: '—', loggedIn: false });

  useEffect(() => {
    const cloud = db.cloud;
    if (!cloud) return;

    // Static diagnostics: which cloud we are pointed at, and where from.
    try {
      setDiag((d) => ({
        ...d,
        cloudHost: new URL(DEXIE_CLOUD_URL).host,
        origin: typeof window !== 'undefined' ? window.location.origin : '—',
      }));
    } catch {
      setDiag((d) => ({ ...d, cloudHost: 'invalid URL' }));
    }

    const read = () => {
      const user = cloud.currentUser?.value;
      // IMPORTANT: `cloud.currentUserId` is a non-empty string even for the
      // anonymous/private realm, so it must NOT be used as the signed-in test.
      // `isLoggedIn` is the addon's real flag and is only true after login.
      const signedIn = user?.isLoggedIn === true;
      const email = signedIn ? (user?.email ?? null) : null;
      const sync = cloud.syncState?.value;

      if (!signedIn) {
        // Anonymous: local-only. Never report a sync phase as if it were synced.
        setState({ ...IDLE, errorMessage: null });
        setDiag((d) => ({
          ...d,
          loggedIn: false,
          // Still report the realm/userId the addon assigned, so it is visible
          // that an anonymous identity exists (and is not a real login).
          userId: user?.userId ?? '—',
        }));
        return;
      }

      // phase: initial | not-in-sync | pushing | pulling | in-sync | error | offline
      setDiag((d) => ({ ...d, loggedIn: true, userId: user?.userId ?? '—' }));
      switch (sync?.phase) {
        case 'in-sync':
          setState({ signedIn: true, email, status: 'Synced', tone: 'ok', pendingWork: false, errorMessage: null });
          break;
        case 'pushing':
          setState({ signedIn: true, email, status: 'Syncing — uploading', tone: 'busy', pendingWork: true, errorMessage: null });
          break;
        case 'pulling':
          setState({ signedIn: true, email, status: 'Syncing — downloading', tone: 'busy', pendingWork: true, errorMessage: null });
          break;
        case 'offline':
          setState({
            signedIn: true, email,
            status: 'Offline — changes will sync later', tone: 'warn', pendingWork: true, errorMessage: null,
          });
          break;
        case 'error':
          setState({
            signedIn: true, email, status: 'Sync error', tone: 'error', pendingWork: true,
            errorMessage: sync?.error?.message ?? 'The last sync failed.',
          });
          break;
        default:
          setState({ signedIn: true, email, status: 'Syncing…', tone: 'busy', pendingWork: true, errorMessage: null });
      }
    };

    read();
    const subs = [cloud.currentUser, cloud.syncState, cloud.webSocketStatus]
      .filter(Boolean)
      .map((o: { subscribe(fn: () => void): { unsubscribe(): void } }) => o.subscribe(read));

    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  const signIn = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      // login() drives the addon's own email + code dialog. On success the
      // addon begins syncing, but we ask for an explicit sync too so the first
      // pull completes promptly and the panel leaves "Syncing…".
      await db.cloud?.login();
      await db.cloud?.sync().catch(() => undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reach Dexie Cloud.';
      setLocalError(message);
      toast('error', 'Sign-in failed', message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await db.cloud?.logout({ force: true });
      setConfirmingOut(false);
      setAckErase(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Try again, or clear site data in your browser.';
      setLocalError(message);
      toast('error', 'Sign-out failed', message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
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
  };

  const TONE: Record<CloudState['tone'], string> = {
    ok: 'text-emerald-500',
    busy: 'text-accent',
    warn: 'text-amber-500',
    error: 'text-rose-500',
    muted: 'text-content-tertiary',
  };
  const StatusIcon = state.signedIn && (state.tone === 'ok' || state.tone === 'busy') ? Cloud : CloudOff;
  const btn = 'inline-flex items-center gap-2 px-3 min-h-[44px] rounded-xl text-xs font-semibold transition-colors disabled:opacity-40';

  return (
    <Card title="Sync across devices" subtitle="Keep this dashboard in step on every device via Dexie Cloud">
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <StatusIcon className={`w-4 h-4 shrink-0 ${TONE[state.tone]}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${TONE[state.tone]}`}>{state.status}</p>
            {state.signedIn && state.email && (
              <p className="text-xs text-content-secondary truncate">Signed in as {state.email}</p>
            )}
            {!state.signedIn && (
              <p className="text-xs text-content-secondary">
                Not signed in — data stays on this device only. Sign in to enable sync.
              </p>
            )}
          </div>
        </div>

        {(localError || state.errorMessage) && (
          <p className="text-xs text-rose-500 flex items-start gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {localError ?? state.errorMessage}
          </p>
        )}

        {state.signedIn && (
          <button onClick={() => void syncNow()} disabled={busy} className={`${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            Sync now
          </button>
        )}

        {!state.signedIn ? (
          <button onClick={() => void signIn()} disabled={busy} className={`${btn} bg-accent hover:bg-accent-hover text-white`}>
            <LogIn className="w-4 h-4" />
            {busy ? 'Signing in…' : 'Sign in to sync'}
          </button>
        ) : confirmingOut ? (
          <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
            <p className="text-xs font-semibold text-content-primary">Sign out and erase this device's data?</p>
            <p className="text-xs text-content-secondary">
              Signing out <strong>erases the local database on this device</strong>: subjects, topics,
              calendar, schedules, focus history and assistant chats. Your{' '}
              <strong>AI API key is not synced</strong>, so it is deleted here and must be re-entered on
              this device. Other devices keep their own data and key.
            </p>
            <button onClick={() => void exportAllData()} className={`${btn} border border-border bg-bg-surface text-content-primary hover:bg-bg-elevated`}>
              <Download className="w-4 h-4" />
              Export backup first
            </button>

            {state.pendingWork ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
                <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-content-primary">
                  Sync has not finished — currently &ldquo;{state.status}&rdquo;. Signing out now can lose
                  changes that have not reached the cloud yet. Reconnect and wait for &ldquo;Synced&rdquo;.
                </p>
              </div>
            ) : (
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={ackErase} onChange={(e) => setAckErase(e.target.checked)} className="mt-0.5 accent-rose-500" />
                <span className="text-xs text-content-secondary">
                  I understand the local data and API key on this device will be erased.
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => void signOut()} disabled={busy || !ackErase || state.pendingWork} className={`${btn} bg-rose-500 hover:bg-rose-600 text-white`}>
                <LogOut className="w-4 h-4" />
                {busy ? 'Signing out…' : 'Sign out and erase'}
              </button>
              <button onClick={() => { setConfirmingOut(false); setAckErase(false); }} disabled={busy} className={`${btn} border border-border text-content-secondary hover:text-content-primary`}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmingOut(true)} className={`${btn} border border-rose-500/40 text-rose-500 hover:bg-rose-500/10`}>
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        )}

        <p className="text-[11px] text-content-tertiary">
          Never synced (kept per-device): {UNSYNCED_TABLES.join(', ')}.
        </p>

        <details className="text-[11px] text-content-tertiary">
          <summary className="cursor-pointer select-none">Diagnostics</summary>
          <dl className="mt-1.5 space-y-0.5 font-mono break-all">
            <div className="flex gap-1.5">
              <dt>logged in:</dt>
              <dd className={diag.loggedIn ? 'text-emerald-500' : 'text-amber-500'}>
                {diag.loggedIn ? 'yes' : 'no'}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>user id:</dt>
              <dd>{diag.userId}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>cloud:</dt>
              <dd>{diag.cloudHost}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>origin:</dt>
              <dd>{diag.origin}</dd>
            </div>
          </dl>
        </details>
      </div>
    </Card>
  );
};
