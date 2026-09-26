import Dexie, { type Table } from 'dexie';
import type {
  Subject,
  Resource,
  CalendarEvent,
  WeeklySchedule,
  ShiftOverride,
  PomodoroSession,
  ThemeStatusMapping,
  PomodoroSettingsRow
} from '../types';

export class ProductivityDB extends Dexie {
  subjects!: Table<Subject, string>;
  resources!: Table<Resource, string>;
  calendarEvents!: Table<CalendarEvent, string>;
  weeklySchedules!: Table<WeeklySchedule, string>;
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
    // v3: per-week roster records replace the singleton shiftConfig.
    this.version(3).stores({
      weeklySchedules: 'id, weekStartDate',
      shiftConfig: null // table dropped
    });
  }
}

export const db = new ProductivityDB();
