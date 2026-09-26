import { db } from './db';
import type { PomodoroSettings, ThemeStatusMapping } from '../types';

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
}
