import { db } from './db';
import type { ShiftConfig, ThemeStatusMapping } from '../types';

export const defaultShiftConfig: ShiftConfig = {
  id: 'default',
  shiftLengthHours: 9,
  startTime: '09:00',
  workingDays: [1, 2, 3, 4, 5], // Monday - Friday
  offDays: [6, 0], // Saturday, Sunday
  updatedAt: new Date().toISOString()
};

export const defaultThemeStatusMappings: ThemeStatusMapping[] = [
  { status: 'Studying', theme: 'studying', colorScheme: 'dark' },
  { status: 'Working', theme: 'working', colorScheme: 'dark' },
  { status: 'Researching', theme: 'researching', colorScheme: 'dark' },
  { status: 'Playing', theme: 'playing', colorScheme: 'dark' }
];

export async function initializeDatabaseDefaults() {
  const existingConfig = await db.shiftConfig.get('default');
  if (!existingConfig) {
    await db.shiftConfig.put(defaultShiftConfig);
  }

  const existingMappings = await db.themeStatusMap.toArray();
  if (existingMappings.length === 0) {
    await db.themeStatusMap.bulkPut(defaultThemeStatusMappings);
  }
}
