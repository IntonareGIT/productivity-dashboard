import { db } from './db';
import type { AiProvider, PomodoroSettings, ThemeStatusMapping } from '../types';

/**
 * Code defaults for settings that also have a synced DB row.
 *
 * These are the fallback values ONLY. They are deliberately NOT seeded into
 * Dexie: seeding a synced table from a client can push defaults over an
 * account's real values. Instead, `useThemeStatusMap` merges these with the
 * database rows in memory — DB row wins, code default is the fallback — and a
 * row is written only when the user actually changes the setting. Settings
 * offers "Reset to default", which DELETES the row and falls back here.
 */

export const defaultPomodoroSettings: PomodoroSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  cyclesBeforeLongBreak: 4,
  soundEnabled: true,
  notificationEnabled: true,
};

/**
 * Default status → theme mapping.
 *
 * NOTE: `colorScheme` on these rows is legacy and is ignored. Light/dark is a
 * per-device preference held in localStorage, so a synced row can never change
 * another device's appearance. Rows are written without consulting it.
 */
export const defaultThemeStatusMappings: ThemeStatusMapping[] = [
  { status: 'Studying', theme: 'studying', colorScheme: 'dark' },
  { status: 'Working', theme: 'working', colorScheme: 'dark' },
  { status: 'Researching', theme: 'researching', colorScheme: 'dark' },
  { status: 'Playing', theme: 'playing', colorScheme: 'dark' }
];


/**
 * First-run AI provider (schema v6): Gemini's OpenAI-compatible endpoint with
 * an EMPTY apiKey. The assistant stays disabled until the user pastes a key
 * (or swaps in any other OpenAI-compatible provider) under Settings.
 */
export function makeDefaultAiProvider(): AiProvider {
  const now = new Date().toISOString();
  return {
    id: 'ai-provider-gemini-default',
    label: 'Gemini Flash (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    modelName: 'gemini-2.0-flash',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * First-run seeding. Safe to run on every launch.
 *
 * `themeStatusMap`, `uiState` and `appSettings` are deliberately NOT seeded.
 * They are synced tables, and writing defaults from a client can overwrite an
 * account's real values. Their code defaults are merged in memory instead (see
 * `defaultThemeStatusMappings` / `defaultPomodoroSettings`), and a row is
 * written only when the user changes the setting. "Reset to default" deletes
 * the row. The `uiState` row is the exception that proves the rule: it is
 * written only by an explicit status/override choice, never at startup, so a
 * fresh device cannot push its fallback over the account's value.
 *
 * `aiProviders` IS seeded: it is an unsynced table, so it stays per-device and
 * cannot reach another account. It uses a fixed id so a re-seed can never
 * create a second Gemini row.
 */
export async function initializeDatabaseDefaults() {
  // NOTE: no schedule seeding — weeks are assigned manually via
  // weeklySchedules ("Add this week's schedule"); unknown weeks stay
  // unscheduled by design.
  //
  // NOTE: no pomodoro seeding either. `appSettings` is synced, so a seed here
  // would race the account's real value; `defaultPomodoroSettings` is the
  // in-memory fallback until the live query returns a real row (or the user
  // saves).

  const existingProviders = await db.aiProviders.toArray();
  if (existingProviders.length === 0) {
    await db.aiProviders.put(makeDefaultAiProvider());
  } else if (!existingProviders.some((p) => p.isDefault)) {
    // Guarantee exactly one default after imports/edits.
    await db.aiProviders.put({ ...existingProviders[0], isDefault: true });
  }
}
