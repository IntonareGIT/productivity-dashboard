export type UserStatus = 'Studying' | 'Working' | 'Researching' | 'Playing';
export type ThemeMode = 'studying' | 'working' | 'researching' | 'playing';
export type ColorScheme = 'light' | 'dark';

export interface Subject {
  id: string;              // UUID
  name: string;            // Subject title
  description?: string;    // Short description
  color: string;           // Independent card color hex/class
  notes: string;           // LEGACY subject blob (v5 migrates to a default topic; kept for back-compat)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export type TopicStatus = 'not_started' | 'studying' | 'confident';

export interface Topic {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id
  title: string;           // Topic title
  notes: string;           // Markdown / LaTeX / code-supported notes
  status: TopicStatus;
  order: number;           // manual ordering within a subject
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export type ResourceKind = 'link' | 'file';

export interface Resource {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id (denormalized for fast queries)
  topicId: string | null;  // FK -> Topic.id (null = legacy subject-level, shown under default topic)
  kind: ResourceKind;      // 'link' = urlOrPath is a URL/path; 'file' = blob holds the upload
  title: string;           // Resource title
  urlOrPath: string;       // Web URL or local file path (links)
  fileName?: string | null;// Original upload name (files)
  mimeType?: string | null;// Upload MIME (files)
  fileSize?: number | null;// Upload bytes (files)
  blob?: Blob | null;      // File bytes stored in Dexie (files; excluded from JSON backup)
  tags: string[];          // Tag strings
  dueDate?: string | null; // ISO 8601 YYYY-MM-DD
  completed?: boolean;
  createdAt: string;       // ISO 8601
}

export type AssessmentType = 'exam' | 'quiz' | 'assignment' | 'project';
export type AssessmentStatus = 'upcoming' | 'done';

export interface Assessment {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id
  name: string;            // e.g. "Midterm 1"
  type: AssessmentType;
  date: string;            // YYYY-MM-DD (feeds Dashboard deadlines card)
  weight?: number | null;  // optional % weight
  status: AssessmentStatus;
  createdAt: string;       // ISO 8601
}

export type EventCategory = 'class' | 'deadline' | 'personal' | 'work';

/** Recurrence rule stored ONCE on the parent event (occurrences are computed,
 *  never generated). Missing/undefined is treated as 'none'. */
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'custom';

export interface CalendarEvent {
  id: string;              // UUID
  title: string;
  description?: string;
  date: string;            // anchor / first date (YYYY-MM-DD)
  startTime?: string;      // HH:mm (24-hour)
  endTime?: string;        // HH:mm (24-hour)
  category: EventCategory;
  // --- recurrence (schema v4) ---
  recurrenceType?: RecurrenceType;         // default 'none'
  recurrenceInterval?: number | null;      // 'custom': every N days
  recurrenceDaysOfWeek?: number[] | null;  // 'weekly': 0=Sun..6=Sat
  recurrenceEndDate?: string | null;       // optional inclusive end (YYYY-MM-DD)
  recurrenceCount?: number | null;         // optional: stop after N occurrences
  subjectId?: string | null;               // FK -> subjects.id (null = personal)
  createdAt: string;       // ISO 8601
}

/** One independent schedule record per roster week (Mon–Sun). Replaces the
 *  old singleton ShiftConfig (dropped in schema v3). */
export interface WeeklySchedule {
  id: string;                // UUID primary key
  weekStartDate: string;     // The Monday this week begins (YYYY-MM-DD)
  offDays: number[];         // 0=Sun..6=Sat — the 2 off days that week
  shiftStartTime: string;    // HH:mm, fixed for that week
  shiftLengthHours: number;  // e.g. 9, fixed for that week
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
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
  focusSubject: string;    // free-text label (kept; prefilled from subject/topic picker)
  subjectId?: string | null; // optional FK -> Subject.id (v5)
  topicId?: string | null;   // optional FK -> Topic.id (v5)
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
