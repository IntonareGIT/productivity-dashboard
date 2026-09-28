import React, { useState } from 'react';
import { Cloud, CloudOff, Download, LogIn, LogOut, RefreshCw, TriangleAlert } from 'lucide-react';
import { exportAllData } from '../../../db/backup';
import { Card } from '../../../components/ui/Card';
import { useCloudAccount } from './useCloudAccount';

const TONE = {
  ok: 'text-emerald-500',
  busy: 'text-accent',
  warn: 'text-amber-500',
  error: 'text-rose-500',
  muted: 'text-content-tertiary',
} as const;

const btn = 'inline-flex items-center gap-2 px-3 min-h-[44px] rounded-xl text-xs font-semibold transition-colors disabled:opacity-40';

interface SyncAccountPanelProps {
  /** 'plain' is used inside the profile menu; Settings wraps it in a Card. */
  variant?: 'card' | 'plain';
  /** Diagnostics stay in Settings per the spec. */
  showDiagnostics?: boolean;
  children?: React.ReactNode;
}

/**
 * Shared account + sync UI.
 *
 * Rendered by BOTH Settings → Sync and the top-bar profile menu, driven by the
 * same `useCloudAccount()` hook, so there is no duplicated account state.
 *
 * Sign-out erases the local database, so it is always guarded: a warning that
 * the data AND the unsynced AI API key are deleted, an "Export backup first"
 * button, a required acknowledgement checkbox, and a hard block whenever sync
 * has un-pushed work.
 */
export const SyncAccountPanel: React.FC<SyncAccountPanelProps> = ({
  variant = 'card',
  showDiagnostics = true,
  children,
}) => {
  const { state, busy, signIn, signOut, syncNow } = useCloudAccount();
  const [confirmingOut, setConfirmingOut] = useState(false);
  const [ackErase, setAckErase] = useState(false);

  const body = (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        {state.signedIn && (state.tone === 'ok' || state.tone === 'busy') ? (
          <Cloud className={`w-4 h-4 shrink-0 ${TONE[state.tone]}`} />
        ) : (
          <CloudOff className={`w-4 h-4 shrink-0 ${TONE[state.tone]}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${TONE[state.tone]}`}>{state.status}</p>
          {state.signedIn && state.email && (
            <p className="text-xs text-content-secondary truncate">Signed in as {state.email}</p>
          )}
          {!state.signedIn && (
            <p className="text-xs text-content-secondary">Not signed in, data stays on this device.</p>
          )}
        </div>
      </div>

      {state.errorMessage && (
        <p className="text-xs text-rose-500 flex items-start gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {state.errorMessage}
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
          {busy ? 'Signing in…' : 'Sign in'}
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

      {children}

      {showDiagnostics && (
        <details className="text-[11px] text-content-tertiary">
          <summary className="cursor-pointer select-none">Diagnostics</summary>
          <dl className="mt-1.5 space-y-0.5 font-mono break-all">
            <div className="flex gap-1.5">
              <dt>logged in:</dt>
              <dd className={state.diagnostics.loggedIn ? 'text-emerald-500' : 'text-amber-500'}>
                {state.diagnostics.loggedIn ? 'yes' : 'no'}
              </dd>
            </div>
            <div className="flex gap-1.5"><dt>user id:</dt><dd>{state.diagnostics.userId}</dd></div>
            <div className="flex gap-1.5"><dt>cloud:</dt><dd>{state.diagnostics.cloudHost}</dd></div>
            <div className="flex gap-1.5"><dt>origin:</dt><dd>{state.diagnostics.origin}</dd></div>
          </dl>
        </details>
      )}
    </div>
  );

  if (variant === 'card') {
    return (
      <Card title="Sync across devices" subtitle="Keep this dashboard in step on every device via Dexie Cloud">
        {body}
      </Card>
    );
  }
  return body;
};
