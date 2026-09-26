import Dexie, { type Table } from 'dexie';
import type {
  Subject,
  Resource,
  CalendarEvent,
  ShiftConfig,
  ShiftOverride,
  PomodoroSession,
  ThemeStatusMapping,
  PomodoroSettingsRow
} from '../types';

export class ProductivityDB extends Dexie {
  subjects!: Table<Subject, string>;
  resources!: Table<Resource, string>;
  calendarEvents!: Table<CalendarEvent, string>;
  shiftConfig!: Table<ShiftConfig, string>;
  shiftOverrides!: Table<ShiftOverride, string>;
  pomodoroSessions!: Table<PomodoroSession, string>;
  themeStatusMap!: Table<ThemeStatusMapping, string>;
  appSettings!: Table<PomodoroSettingsRow, string>;

  constructor() {
    super('ProductivityDashboardDB');
    this.version(1).stores({
      subjects: 'id, name, color, createdAt',
      resources: 'id, subjectId, title, dueDate, createdAt',
      calendarEvents: 'id, date, category, startTime, endTime',
      shiftConfig: 'id',
      shiftOverrides: 'id, date, type',
      pomodoroSessions: 'id, date, durationMinutes, completedAt',
      themeStatusMap: 'status'
    });
    // v2 (Phase 5): singleton app settings rows (pomodoro durations).
    this.version(2).stores({
      appSettings: 'id'
    });
  }
}

export const db = new ProductivityDB();
