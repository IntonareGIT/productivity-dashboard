export type UserStatus = 'Studying' | 'Working' | 'Researching' | 'Playing';
export type ThemeMode = 'studying' | 'working' | 'researching' | 'playing';
export type ColorScheme = 'light' | 'dark';

export interface Subject {
  id: string;              // UUID
  name: string;            // Subject title
  description?: string;    // Short description
  color: string;           // Independent card color hex/class
  notes: string;           // Markdown / Plain text notes
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export interface Resource {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id
  title: string;           // Resource title
  urlOrPath: string;       // Web URL or local file path
  tags: string[];          // Tag strings
  dueDate?: string | null; // ISO 8601 YYYY-MM-DD
  completed?: boolean;
  createdAt: string;       // ISO 8601
}

export type EventCategory = 'class' | 'deadline' | 'personal' | 'work';

export interface CalendarEvent {
  id: string;              // UUID
  title: string;
  description?: string;
  date: string;            // YYYY-MM-DD
  startTime?: string;      // HH:mm (24-hour)
  endTime?: string;        // HH:mm (24-hour)
  category: EventCategory;
  createdAt: string;       // ISO 8601
}

export interface ShiftConfig {
  id: string;              // 'default'
  shiftLengthHours: number;// Default 9
  startTime: string;       // Default "09:00"
  workingDays: number[];   // [1, 2, 3, 4, 5] (Mon-Fri)
  offDays: number[];       // [6, 0] (Sat, Sun)
  updatedAt: string;
}

export type ShiftOverrideType = 'pto' | 'custom_hours' | 'custom_off';

export interface ShiftOverride {
  id: string;              // UUID
  date: string;            // YYYY-MM-DD
  type: ShiftOverrideType;
  startTime?: string;      // HH:mm
  shiftLengthHours?: number;
  note?: string;
  createdAt: string;
}

export interface PomodoroSession {
  id: string;
  date: string;            // YYYY-MM-DD
  focusSubject: string;
  durationMinutes: number;
  sessionType: 'focus' | 'short_break' | 'long_break';
  completedAt: string;     // ISO 8601
}

export interface ThemeStatusMapping {
  status: UserStatus;      // PK
  theme: ThemeMode;
  colorScheme: ColorScheme;
}

export interface PomodoroSettings {
  focusDuration: number;       // Minutes, default: 25
  shortBreakDuration: number;  // Minutes, default: 5
  longBreakDuration: number;   // Minutes, default: 15
  cyclesBeforeLongBreak: number;// Default: 4
  soundEnabled: boolean;
  notificationEnabled: boolean;
}

/** Dexie row in `appSettings` (schema v2) — singleton id: 'pomodoro'. */
export interface PomodoroSettingsRow extends PomodoroSettings {
  id: string;
}
