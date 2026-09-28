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

export async function initializeDatabaseDefaults() {
  // NOTE: no schedule seeding — weeks are assigned manually via
  // weeklySchedules ("Add this week's schedule"); unknown weeks stay
  // unscheduled by design.

  const existingMappings = await db.themeStatusMap.toArray();
  if (existingMappings.length === 0) {
    await db.themeStatusMap.bulkPut(defaultThemeStatusMappings);
  }

  const existingPomodoro = await db.appSettings.get('pomodoro');
  if (!existingPomodoro) {
    await db.appSettings.put({ id: 'pomodoro', ...defaultPomodoroSettings });
  }

  // Seed exactly one AI provider on first run (apiKey left empty on purpose).
  const existingProviders = await db.aiProviders.toArray();
  if (existingProviders.length === 0) {
    await db.aiProviders.put(makeDefaultAiProvider());
  } else if (!existingProviders.some((p) => p.isDefault)) {
    // Guarantee one default after imports/edits.
    await db.aiProviders.put({ ...existingProviders[0], isDefault: true });
  }
}
