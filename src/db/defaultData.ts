import { db } from './db';
import type { AiProvider, PomodoroSettings, ThemeStatusMapping } from '../types';

export const defaultPomodoroSettings: PomodoroSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  cyclesBeforeLongBreak: 4,
  soundEnabled: true,
  notificationEnabled: true,
};

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
 * Rules (see Dexie Cloud best practices — synced tables must never be
 * Version.upgrade()d or blindly populated, or a fresh device would overwrite
 * synced rows with defaults):
 *
 *  1. Insert ONLY when the row is missing. Never overwrite an existing row.
 *  2. Fixed primary keys, so two devices seeding independently converge on the
 *     same row instead of creating duplicates. `themeStatusMap` keys on
 *     `status` and `appSettings` on the literal 'pomodoro' — both natural and
 *     already deterministic.
 *  3. Called on first run (never signed in) and again after the first sync
 *     following sign-in, so a fresh device can only ever fill GAPS that the
 *     account does not already define.
 */
export async function initializeDatabaseDefaults() {
  // NOTE: no schedule seeding — weeks are assigned manually via
  // weeklySchedules ("Add this week's schedule"); unknown weeks stay
  // unscheduled by design.

  // Per-row insert-if-missing: never clobber a synced mapping.
  for (const mapping of defaultThemeStatusMappings) {
    const existing = await db.themeStatusMap.get(mapping.status);
    if (!existing) await db.themeStatusMap.put(mapping);
  }

  const existingPomodoro = await db.appSettings.get('pomodoro');
  if (!existingPomodoro) {
    await db.appSettings.put({ id: 'pomodoro', ...defaultPomodoroSettings });
  }

  // aiProviders is UNSYNCED (API keys stay per-device), so this table is always
  // local. Seed exactly one provider on first run with a fixed id so a
  // re-seed can never create a second Gemini row.
  const existingProviders = await db.aiProviders.toArray();
  if (existingProviders.length === 0) {
    await db.aiProviders.put(makeDefaultAiProvider());
  } else if (!existingProviders.some((p) => p.isDefault)) {
    // Guarantee exactly one default after imports/edits.
    await db.aiProviders.put({ ...existingProviders[0], isDefault: true });
  }
}
