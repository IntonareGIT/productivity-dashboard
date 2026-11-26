import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { UI_STATE_KEY, useStatusThemeStore } from '../stores/useStatusThemeStore';

/**
 * Synced UI state (schema v8): current status + theme override, one row keyed
 * 'current'.
 *
 * Read side only. Writes are owned by `useStatusThemeStore`, which persists from
 * explicit user actions (picking a status, picking/clearing an override) and
 * never at startup — so a fresh device cannot overwrite the account's value
 * with its own fallback, and nothing is seeded.
 *
 * A live query means a change arriving from sync (or another tab) updates the
 * store and applies the theme immediately, with no reload. The incoming value
 * is applied via `applyRemoteUiState`, which does not write back to Dexie —
 * that is what prevents a write loop.
 *
 * localStorage stays the startup cache for status/override so the first paint
 * has no flash; this row wins once it loads.
 */
export function useUiState() {
  const applyRemoteUiState = useStatusThemeStore((s) => s.applyRemoteUiState);
  const row = useLiveQuery(() => db.uiState.get(UI_STATE_KEY));
  // Skip re-applying a value we already applied, so the effect stays idempotent
  // without blocking a genuine remote change.
  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    // A missing row means "nothing saved yet" — keep the localStorage cache or
    // the fallback, and never write.
    if (!row) return;
    const signature = `${row.status}|${row.themeOverride ?? ''}`;
    if (signature === lastApplied.current) return;
    lastApplied.current = signature;
    applyRemoteUiState(row.status, row.themeOverride);
  }, [row, applyRemoteUiState]);
}

