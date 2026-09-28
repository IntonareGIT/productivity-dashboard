import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useStatusThemeStore } from '../stores/useStatusThemeStore';
import type { ThemeStatusMapping, UserStatus } from '../types';

/**
 * Live status -> theme mapping (synced).
 *
 * Reads `themeStatusMap` with a live query so a change made here, or arriving
 * from another device's sync, updates the store — and the applied theme —
 * without a reload. Nothing is seeded: the store falls back to the code
 * defaults for any status with no row, and a row is only written when the user
 * edits a mapping.
 */
export function useThemeStatusMap() {
  const setMappings = useStatusThemeStore((s) => s.setMappings);
  const rows = useLiveQuery(() => db.themeStatusMap.toArray());

  useEffect(() => {
    setMappings(rows ?? []);
  }, [rows, setMappings]);

  /** Write a row for one status (this is the only way a row is created). */
  const saveMapping = async (status: UserStatus, theme: ThemeStatusMapping['theme']) => {
    // colorScheme is legacy and ignored on read; write a neutral value rather
    // than this device's light/dark so nothing device-specific is synced.
    await db.themeStatusMap.put({ status, theme, colorScheme: 'dark' });
  };

  /** "Reset to default" — delete the row so the code default applies again. */
  const resetMapping = async (status: UserStatus) => {
    await db.themeStatusMap.delete(status);
  };

  return { rows, saveMapping, resetMapping };
}
