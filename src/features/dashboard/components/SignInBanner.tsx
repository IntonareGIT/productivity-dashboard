import React, { useEffect, useState } from 'react';
import { CloudOff, LogIn } from 'lucide-react';
import { db } from '../../../db/db';
import { useCloudAccount } from '../../settings/components/useCloudAccount';
import { shouldShowBanner, SIGN_IN_BANNER_TEXT } from './signInBannerState';

const btn = 'inline-flex items-center justify-center gap-2 px-3 min-h-[44px] rounded-xl text-xs font-semibold transition-colors disabled:opacity-40';

/**
 * Dashboard warning shown while the user is not signed in.
 *
 * Reads the SAME shared hook as Settings → Sync and the profile menu, and uses
 * the same real check (`state.signedIn`, i.e. `isLoggedIn`) — never the mere
 * existence of a `currentUser` object, which is truthy for the anonymous realm.
 *
 * `useCloudAccount()` does not expose an "initialized" flag, so the component
 * derives one locally by waiting for the first value of the addon's
 * `currentUser` observable. The hook itself is not modified.
 *
 * "Not now" dismisses for this app load only: it is in-memory React state, so a
 * reload brings the banner back. It is deliberately NOT written to the synced
 * database (nor to localStorage/sessionStorage, which would outlive the load).
 */
export const SignInBanner: React.FC = () => {
  const { state, busy, signIn } = useCloudAccount();
  // Read the observable's current value during the first render, so a user who
  // is already signed in never sees even one frame of the banner. The effect
  // below only handles later changes.
  const [initialized, setInitialized] = useState(() => {
    const cloud = db.cloud;
    if (!cloud) return true; // no cloud at all: settled as signed out
    return Boolean(cloud.currentUser?.value);
  });
  const [dismissed, setDismissed] = useState(false);

  // Resolve the startup "still loading" state without touching the shared hook.
  useEffect(() => {
    const currentUser = db.cloud?.currentUser;
    if (!currentUser) {
      setInitialized(true);
      return;
    }
    const sub = currentUser.subscribe(() => setInitialized(true));
    return () => sub.unsubscribe();
  }, []);

  if (!shouldShowBanner({ initialized, signedIn: state.signedIn, dismissed })) return null;

  return (
    <div
      role="status"
      className="w-full rounded-2xl border border-border bg-accent-subtle px-4 py-3 sm:px-5 sm:py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <CloudOff className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
          <p className="text-sm text-content-primary">{SIGN_IN_BANNER_TEXT}</p>
        </div>
        {/* Stacked below the text under 768px (sm breakpoint). */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:shrink-0">
          <button
            onClick={() => setDismissed(true)}
            className={`${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}
          >
            Not now
          </button>
          <button
            onClick={() => void signIn()}
            disabled={busy}
            className={`${btn} bg-accent hover:bg-accent-hover text-white`}
          >
            <LogIn className="w-4 h-4" aria-hidden="true" />
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
};
