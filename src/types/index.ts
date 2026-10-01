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
  /**
   * The ORIGINAL markdown / LaTeX note body.
   *
   * NEVER overwritten, never deleted. This is the permanent backup: once a note
   * has been edited in the rich-text editor the authoritative content moves to
   * `contentHtml`, but this field is left exactly as it was so there is always a
   * readable original to fall back on.
   */
  notes: string;
  /**
   * Rich-text body produced by the WYSIWYG editor (v11+).
   *
   * Absent on notes that have not been edited in the editor yet. The editor
   * converts the markdown lazily on first open and only writes this once the
   * user actually changes something.
   */
  contentHtml?: string;
  /**
   * Which format is authoritative for display.
   *
   * `'html'` once `contentHtml` exists; `undefined` while `notes` (markdown) is
   * the only body. Renderers must read this and must not guess from the mere
   * presence of a string.
   */
  contentFormat?: 'html';
  status: TopicStatus;
  order: number;           // manual ordering within a subject
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export type ResourceKind = 'link' | 'file';

/**
 * A named, folder-like lane for resources WITHIN a subject.
 *
 * Deliberately not a child of Topic: a resource keeps its own `topicId` while
 * grouped, so grouping across topics ("every past paper") stays possible and
 * notes / split-with-notes / topic deletes keep working unchanged.
 */
export interface ResourceGroup {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id
  name: string;            // User-given group name
  order: number;           // manual ordering among SIBLINGS
  /**
   * FK -> ResourceGroup.id of the parent, or null/absent for a top-level group
   * in the subject (schema v14, additive). Metadata only, so it syncs like the
   * rest of the group row; every pre-v14 group is simply top-level.
   */
  parentGroupId?: string | null;
  createdAt: string;       // ISO 8601
}

export interface Resource {
  id: string;              // UUID
  subjectId: string;       // FK -> Subject.id (denormalized for fast queries)
  topicId: string | null;  // FK -> Topic.id (null = legacy subject-level, shown under default topic)
  /**
   * FK -> ResourceGroup.id (null = ungrouped). OPTIONAL and independent of
   * topicId: a grouped resource still belongs to its topic, so a group is a
   * lane over resources rather than a new parent. At most one group per
   * resource, and only ever a group of the same subject.
   */
  groupId?: string | null;
  kind: ResourceKind;      // 'link' = urlOrPath is a URL/path; 'file' = blob holds the upload
  title: string;           // Resource title
  /**
   * Web URL or local file path. Mandatory for 'link', absent for 'file' —
   * an upload carries no URL. Always read it defensively (it is undefined for
   * file rows), never as a bare string.
   */
  urlOrPath?: string;
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

/**
 * What kind of thing an event is, and which teaching period it occupies.
 *
 * Both are ADDITIVE and both are optional, so every existing event keeps working
 * and reads as `undefined`, which means "no kind" and "no period". They sit
 * next to the existing `subjectId` link rather than replacing it: an event is
 * still linked to a subject in exactly one way.
 */
export type EventKind = 'studying' | 'lecture' | 'section' | 'lab';

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
  // --- kind and period (schema v12), additive and optional ---
  eventKind?: EventKind;                  // undefined = no kind (every pre-v12 event)
  period?: number;                        // 1..6, only meaningful for lecture/section/lab
  /**
   * Shared id grouping the events created together by one bulk series
   * (schema v13, additive and optional). Undefined means "not part of a
   * series", which is true of every pre-v13 event.
   */
  seriesId?: string | null;
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

/**
 * Configurable AI provider (schema v6) — the global assistant always reads
 * whichever row is marked `isDefault`. Feature code never hardcodes a vendor:
 * any OpenAI-compatible endpoint works by changing baseUrl/modelName.
 */
export interface AiProvider {
  id: string;          // UUID primary key
  label: string;       // Display name, e.g. "Gemini Flash", "OpenRouter Free"
  baseUrl: string;     // OpenAI-compatible base URL (no trailing /chat/completions)
  apiKey: string;      // Secret key; empty = not configured yet
  modelName: string;   // Model id sent in the request body
  isDefault: boolean;  // Exactly one provider is default at a time
  /**
   * Optional second model id, tried ONCE if the primary fails every retry
   * (schema v13, additive). Empty or absent means the feature is OFF, which is
   * the default, so nothing changes unless the user opts in.
   */
  fallbackModel?: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

/**
 * A chat conversation with the assistant (schema v7).
 *
 * `providerId` pins the session to the provider that produced it. Gemini's
 * `thought_signature` is provider-specific, so replaying one provider's
 * messages against another is invalid — the app starts a fresh session
 * instead of resending them.
 */
export interface ChatSession {
  id: string;          // UUID primary key
  title: string;       // Derived from the first user message
  providerId: string | null; // FK -> AiProvider.id that this session belongs to
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601 (bumped on every stored message)
}

/**
 * One stored chat message (schema v7).
 *
 * `raw` is the message object EXACTLY as sent to / received from the provider
 * and must be replayed verbatim on later turns — see ChatMessage.raw in
 * src/features/ai/types.ts for the Gemini thought_signature constraint. The
 * normalized fields exist only for rendering and filtering; they are never a
 * substitute for `raw`.
 *
 * API keys are never written here: only request/response message payloads are
 * persisted, and the Authorization header is not part of a message.
 */
export interface ChatMessageRow {
  id: string;          // UUID primary key
  sessionId: string;   // FK -> ChatSession.id
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;     // Text for the UI; '' for pure tool-call turns
  /** Full message object as sent/received, including extra_content. */
  raw: Record<string, unknown>;
  /** Tool-call ids this message requests (assistant turns). */
  toolCallIds?: string[];
  /** The tool call this message answers (tool turns). */
  toolCallId?: string | null;
  /** Function name, for the "action" chips in the UI. */
  toolName?: string | null;
  /** Short human summary of a tool result (UI only). */
  display?: string | null;
  /**
   * Provider-native reasoning for this turn (UI only; never replayed).
   *
   * Not indexed, so adding it needs no Dexie version bump — IndexedDB stores
   * whole objects and only the listed keys become indexes.
   */
  reasoning?: string | null;
  error?: boolean;
  createdAt: string;   // ISO 8601
}

/**
 * Synced UI state (schema v8) — a single row with the fixed key 'current'.
 *
 * Holds the two preferences that follow the user across devices: the current
 * status and any theme override. Light/dark is deliberately NOT here; it is a
 * per-device preference in localStorage, so one device's brightness choice
 * never overrides another's.
 *
 * A fixed key is used so two devices writing concurrently converge on the same
 * row rather than creating duplicates, and so a missing row is unambiguous.
 */
export interface UiState {
  id: string;          // always 'current'
  status: UserStatus;
  /** Manual "Override colors" theme, or null when following the mapping. */
  themeOverride: ThemeMode | null;
  updatedAt: string;   // ISO 8601
}


