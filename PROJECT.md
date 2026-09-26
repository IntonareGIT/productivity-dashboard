# Personal Productivity Dashboard — Architecture & Schema

## Overview

A single-user, local-first personal productivity dashboard built with React,
TypeScript, Vite, Tailwind CSS, and Dexie.js (IndexedDB). Distributed as an
installable Progressive Web App (PWA) with a responsive desktop layout
(collapsible sidebar) and mobile layout (bottom navigation bar, single-column
stacks below 768px).

- No auth, no backend, no server. All data lives in the browser's IndexedDB.
- Themes are CSS custom properties swapped via `data-theme` on `<html>`.
- Global state via Zustand; date math via date-fns; persistence via Dexie.

**This file is the source of truth for data shapes.** Re-read it before adding
any new feature and keep it updated whenever the schema evolves.

---

## 1. Dexie.js Database Schema

Database name: `ProductivityDashboardDB`
Current version: `5`
(v3 replaced `shiftConfig` with `weeklySchedules`; v4 added the `subjectId`
index on `calendarEvents`; v5 adds topic-based library: `topics`,
`assessments`, topic-level `resources` with file blobs, and
`subjectId`/`topicId` links on `pomodoroSessions`)
Source: `src/db/db.ts` (interfaces in `src/types/index.ts`)

```typescript
db.version(1).stores({
  subjects:        'id, name, color, createdAt',
  resources:       'id, subjectId, title, dueDate, createdAt',
  calendarEvents:  'id, date, category, startTime, endTime',
  shiftConfig:     'id',            // dropped in v3
  shiftOverrides:  'id, date, type',
  pomodoroSessions:'id, date, durationMinutes, completedAt',
  themeStatusMap:  'status'
});
db.version(2).stores({
  appSettings:     'id'   // singleton rows, e.g. id: 'pomodoro'
});
db.version(3).stores({
  weeklySchedules: 'id, weekStartDate', // replaces shiftConfig
  shiftConfig:     null                  // table dropped
});
db.version(4).stores({
  calendarEvents:  'id, date, category, startTime, endTime, subjectId'
});
db.version(5).stores({
  topics:          'id, subjectId, status, createdAt',
  assessments:     'id, subjectId, date, status',
  resources:       'id, subjectId, topicId, title, dueDate, createdAt',
  pomodoroSessions:'id, date, durationMinutes, completedAt, subjectId, topicId',
});
db.version(5).upgrade(async (tx) => {
  // One default topic per subject carries the legacy subject.notes;
  // legacy subject-level resources are attached to that topic
  // (keeping subjectId denormalized for fast dashboard queries).
});
```

Indexed fields are listed; `tags`, `notes`, etc. are stored but not indexed.

### 1.1 `subjects` — color-coded study/project cards

```typescript
export interface Subject {
  id: string;              // UUID primary key
  name: string;            // Subject name (e.g. "Advanced Algorithms")
  description?: string;    // Short description
  color: string;           // Hex color, independent of the active theme
  notes: string;           // LEGACY free-form notes (migrated to a default topic in v5; kept for back-compat)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

Topics carry per-topic notes now (§1.2). `Subject.notes` is still written
by old code paths but the UI reads topics.

### 1.2 `topics` — one-to-many under subjects (v5)

```typescript
export type TopicStatus = 'not_started' | 'studying' | 'confident';

export interface Topic {
  id: string;              // UUID primary key
  subjectId: string;       // Foreign key -> subjects.id
  title: string;           // Topic title
  notes: string;           // Markdown / LaTeX / code-supported notes
  status: TopicStatus;     // Not started / Studying / Confident
  order: number;           // Manual ordering within a subject
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

Subject page shows topics as a list/grid with status indicators and an
overall progress bar ("N of M topics Confident"). Detail view: left pane
= selected topic's notes, right pane = that topic's resources.

### 1.3 `resources` — topic-level links + file uploads (v5)

```typescript
export type ResourceKind = 'link' | 'file';

export interface Resource {
  id: string;              // UUID primary key
  subjectId: string;       // Denormalized FK -> subjects.id (fast dashboard queries)
  topicId: string | null;  // FK -> topics.id (null = legacy subject-level row)
  kind: ResourceKind;      // 'link' = urlOrPath; 'file' = blob holds the upload
  title: string;           // Title / label
  urlOrPath: string;       // Web URL or file reference/path (links)
  fileName?: string | null;// Original upload name (files)
  mimeType?: string | null;// Upload MIME (files)
  fileSize?: number | null;// Upload bytes (files)
  blob?: Blob | null;      // File bytes in Dexie (files; excluded from JSON backup)
  tags: string[];          // Tag strings (not indexed)
  dueDate?: string | null; // YYYY-MM-DD; feeds the Dashboard deadlines card
  completed?: boolean;     // Done flag
  createdAt: string;       // ISO 8601
}
```

Uploads (PDF/image/doc) are stored as Blobs in IndexedDB and opened via
`URL.createObjectURL(blob)` for view/download. JSON backup skips `blob`
bytes (keeps metadata only) — see §1.10.

### 1.4 `assessments` — exams/quizzes/assignments/projects per subject (v5)

```typescript
export type AssessmentType = 'exam' | 'quiz' | 'assignment' | 'project';
export type AssessmentStatus = 'upcoming' | 'done';

export interface Assessment {
  id: string;              // UUID primary key
  subjectId: string;       // FK -> subjects.id
  name: string;            // e.g. "Midterm 1"
  type: AssessmentType;
  date: string;            // YYYY-MM-DD (feeds Dashboard deadlines alongside resource due dates)
  weight?: number | null;  // optional % weight
  status: AssessmentStatus;
  createdAt: string;       // ISO 8601
}
```

### 1.5 `calendarEvents` — month/week view events (with recurrence, v4)

```typescript
export interface Resource {
  id: string;              // UUID primary key
  subjectId: string;       // Foreign key -> subjects.id
  title: string;           // Title / label
  urlOrPath: string;       // Web URL or file reference/path
  tags: string[];          // Tag strings (not indexed)
  dueDate?: string | null; // YYYY-MM-DD; feeds the Dashboard deadlines card
  completed?: boolean;     // Done flag
  createdAt: string;       // ISO 8601
}
```

### 1.3 `calendarEvents` — month/week view events (with recurrence, v4)

```typescript
export type EventCategory = 'class' | 'deadline' | 'personal' | 'work';

/** Recurrence rule stored ONCE on the parent event — occurrences are
 *  computed dynamically for the visible range, never stored as rows.
 *  Missing/undefined recurrenceType is treated as 'none'. */
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'custom';

export interface CalendarEvent {
  id: string;              // UUID primary key
  title: string;
  description?: string;
  date: string;            // anchor/first date (YYYY-MM-DD)
  startTime?: string;      // HH:mm (24-hour)
  endTime?: string;        // HH:mm (24-hour)
  category: EventCategory;
  // --- recurrence (v4) ---
  recurrenceType?: RecurrenceType;      // default 'none'
  recurrenceInterval?: number | null;   // custom only: every N days (>=1)
  recurrenceDaysOfWeek?: number[] | null; // weekly: 0=Sun..6=Sat (e.g. [1,3])
  recurrenceEndDate?: string | null;    // optional inclusive end (YYYY-MM-DD)
  recurrenceCount?: number | null;      // optional: stop after N occurrences
  subjectId?: string | null;            // FK -> subjects.id; null = personal
  createdAt: string;       // ISO 8601
}
```

Notes:
- One row per series; editing/deleting a recurring event asks
  *this only* / *this and future* / *all occurrences*. "This only" and
  "future" splits are implemented by truncating `recurrenceEndDate` on the
  parent and (when needed) cloning a continuation row — no occurrence rows
  are ever generated.
- `subjectId` is indexed (v4) so a Library subject can list its linked
  lectures; linked events render with the subject's color on the Calendar.

### 1.6 `weeklySchedules` — one independent record per roster week (v3)

Replaces the old singleton `shiftConfig`. The schedule is fixed for a full
week (Mon–Sun) and reassigned manually week to week; each week's record is
fully independent — editing one week never affects any other week. A week
with no record is **unscheduled** (never guessed from a previous week).

```typescript
export interface WeeklySchedule {
  id: string;                // UUID primary key
  weekStartDate: string;     // The Monday this week begins (YYYY-MM-DD)
  offDays: number[];         // 0=Sun..6=Sat — the 2 off days that week
  shiftStartTime: string;    // HH:mm, fixed for that week
  shiftLengthHours: number;  // e.g. 9, fixed for that week
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
}
```

Resolution rules for a date (see `shiftLogic.ts`):
1. `shiftOverrides` still apply on top (PTO / custom hours / custom off),
   exactly as before, whichever week's base schedule is active.
2. Otherwise, look up the `weeklySchedules` row whose `weekStartDate`
   equals that date's Monday. Missing row → kind `unscheduled`.

### 1.7 `shiftOverrides` — one-off date adjustments (PTO / custom hours)

```typescript
export type ShiftOverrideType = 'pto' | 'custom_hours' | 'custom_off';

export interface ShiftOverride {
  id: string;                // UUID primary key
  date: string;              // Target date (YYYY-MM-DD)
  type: ShiftOverrideType;
  startTime?: string;        // For 'custom_hours': HH:mm
  shiftLengthHours?: number; // For 'custom_hours': adjusted length
  note?: string;             // Optional reason/note
  createdAt: string;         // ISO 8601
}
```

### 1.8 `pomodoroSessions` — focus session log (v5: optional subject/topic link)

```typescript
export interface PomodoroSession {
  id: string;               // UUID primary key
  date: string;             // YYYY-MM-DD
  focusSubject: string;     // Display label (prefilled from subject/topic picker, still editable)
  subjectId?: string | null; // optional FK to subjects (v5; per-subject focus stats)
  topicId?: string | null;   // optional FK to topics (v5)
  durationMinutes: number;  // e.g. 25
  sessionType: 'focus' | 'short_break' | 'long_break';
  completedAt: string;      // ISO 8601
}
```

The Focus page replaces the free-text field with an optional subject/topic
selector; the label stays editable. Subject pages show total focus time this
week/month from linked sessions.

### 1.7 `themeStatusMap` — status → theme mapping (primary key is `status`)

```typescript
export type UserStatus = 'Studying' | 'Working' | 'Researching' | 'Playing';
export type ThemeMode = 'studying' | 'working' | 'researching' | 'playing';
export type ColorScheme = 'light' | 'dark';

export interface ThemeStatusMapping {
  status: UserStatus;       // Primary key
  theme: ThemeMode;
  colorScheme: ColorScheme; // Independent light/dark per status
}
```

### 1.8 `appSettings` — singleton settings rows (schema v2)

```typescript
export interface PomodoroSettings {
  focusDuration: number;        // Minutes, default: 25
  shortBreakDuration: number;   // Minutes, default: 5
  longBreakDuration: number;    // Minutes, default: 15
  cyclesBeforeLongBreak: number;// Default: 4
  soundEnabled: boolean;
  notificationEnabled: boolean;
}

export interface PomodoroSettingsRow extends PomodoroSettings {
  id: string;               // Singleton key: 'pomodoro'
}
```

### Related settings note

Pomodoro durations persist in `appSettings` (row `id: 'pomodoro'`) since
Phase 5; `PomodoroSettings` above is the canonical shape.

---

## 2. Folder Structure

```
├── public/
│   ├── favicon.svg
│   ├── pwa-192x192.png          # generated by scripts/generate-icons.mjs
│   └── pwa-512x512.png
├── scripts/
│   └── generate-icons.mjs       # dependency-free PWA icon generator
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx    # sidebar + top bar + content + bottom nav
│   │   │   ├── Sidebar.tsx      # desktop collapsible nav (md+)
│   │   │   ├── TopBar.tsx       # clock + status selector + light/dark toggle
│   │   │   └── BottomNav.tsx    # mobile nav (< md)
│   │   └── ui/
│   │       ├── Card.tsx
│   │       └── Modal.tsx        # dialog (bottom sheet on mobile)
│   ├── db/
│   │   ├── db.ts                # Dexie instance & table definitions (v2)
│   │   ├── backup.ts            # export/import all tables as one JSON file
│   │   └── defaultData.ts       # default shift config + theme mappings
│   ├── components/
│   │   ├── layout/ ... (as above)
│   │   └── ui/
│   │       ├── Card.tsx
│   │       ├── Modal.tsx        # dialog (bottom sheet on mobile)
│   │       └── CommandPalette.tsx  # Ctrl/Cmd+K quick-add palette
│   ├── features/
│   │   ├── dashboard/           # bento grid page + widget components
│   │   │   ├── DashboardPage.tsx
│   │   │   └── components/
│   │   │       ├── TodayTimelineStrip.tsx
│   │   │       ├── PomodoroMiniWidget.tsx
│   │   │       ├── UpcomingDeadlinesCard.tsx
│   │   │       ├── WeeklyHoursCard.tsx
│   │   │       └── StatsCard.tsx     # Phase 6: days studied, focus hours
│   │   ├── library/             # Phase 4: subjects, notes, resources
│   │   │   ├── LibraryPage.tsx
│   │   │   ├── libraryRepo.ts   # subject/resource CRUD (cascade delete)
│   │   │   ├── palette.ts       # fixed 12-color subject palette
│   │   │   └── components/
│   │   │       ├── SubjectModal.tsx
│   │   │       ├── ResourceModal.tsx
│   │   │       └── SubjectDetail.tsx   # two-pane notes + resources
│   │   ├── calendar/            # Phase 3: month/week views & events
│   │   │   ├── CalendarPage.tsx
│   │   │   ├── categories.ts    # fixed (theme-independent) category colors
│   │   │   ├── eventsRepo.ts    # event CRUD + group-by-date
│   │   │   └── components/
│   │   │       ├── EventModal.tsx
│   │   │       ├── MonthView.tsx
│   │   │       └── WeekView.tsx
│   │   ├── shifts/              # Phase 2: weekly strip, PTO, overrides
│   │   │   ├── ShiftsPage.tsx
│   │   │   ├── shiftLogic.ts    # pure per-week resolution & summaries
│   │   │   ├── shiftsRepo.ts    # weeklySchedules + override mutations
│   │   │   └── components/
│   │   │       ├── DayOverrideModal.tsx
│   │   │       └── WeeklyScheduleModal.tsx  # add/edit ONE week
│   │   ├── focus/               # Phase 5: pomodoro timer & session log
│   │   │   ├── FocusPage.tsx     # large circular countdown + controls
│   │   │   └── components/
│   │   │       └── SessionLog.tsx  # collapsed Dexie session history
│   │   └── settings/            # Phase 6: theme map, shifts, export/import
│   │       ├── SettingsPage.tsx
│   │       └── components/
│   │           ├── WeeklySchedulesSettings.tsx
│   │           ├── PomodoroSettingsSection.tsx
│   │           └── DataBackupSection.tsx
│   ├── stores/
│   │   ├── useStatusThemeStore.ts   # status/theme/colorScheme (Zustand)
│   │   └── usePomodoroStore.ts      # active timer state (Zustand)
│   ├── styles/
│   │   ├── index.css             # Tailwind layers + base styles
│   │   └── themes.css            # 4 themes x light/dark CSS variables
│   ├── types/
│   │   └── index.ts              # all shared interfaces (mirrors schema)
│   ├── utils/
│   │   └── id.ts                 # newId() UUID helper for all tables
│   ├── App.tsx                   # tab routing between feature pages
│   └── main.tsx                  # entry; self-hosted Inter font imports
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js            # color tokens -> CSS variables
├── tsconfig.json
├── vite.config.ts                # React + PWA plugin (manifest, workbox)
├── PROJECT.md                    # this file
└── DEPLOY.md                     # Phase 6
```

---

## 3. Theme System

- Themes set CSS custom properties (`--bg-primary`, `--bg-surface`,
  `--bg-surface-elevated`, `--border-subtle`, `--border-strong`,
  `--accent-primary`, `--accent-hover`, `--accent-subtle`, `--accent-text`,
  `--text-primary`, `--text-secondary`, `--text-tertiary`) in
  `src/styles/themes.css`.
- Selector scheme: `[data-theme="<theme>"]` = dark (default), plus
  `html[data-theme="<theme>"].light` overrides for light mode. The
  `data-theme` attribute and `.light`/`.dark` class on `<html>` are managed
  by `useStatusThemeStore`.
- Only color tokens change between themes; layout/spacing stay fixed.
- Mapping status → (theme, colorScheme) is editable in Settings and persisted
  in the `themeStatusMap` table.

---

## 4. Phase Log

- **Phase 1 — Shell + Dashboard:** scaffold (Vite + Tailwind + Dexie + PWA),
  app shell (sidebar/top bar/bottom nav), theme system (4 themes × light/dark,
  status mapping), routing to page stubs, bento Dashboard (today strip,
  pomodoro mini-widget, upcoming deadlines, weekly hours).
- **Phase 2 — Work Shift Tracker:** no schema changes (v1 tables already
  covered it). Added `shiftLogic.ts` (shared day resolution: PTO > custom_off
  > custom_hours > default schedule; week/month summaries; worked-hours
  estimation) and `shiftsRepo.ts` (one override per date, config patching).
  Shifts page: Mon–Sun weekly strip (stacked on mobile), distinct colors for
  shift/off/PTO, day-tap modal for PTO + one-off adjustments, weekly + monthly
  scheduled-hours summaries. Settings: Work Schedule section (off days,
  shift length, start time). Dashboard today strip + weekly hours now read
  real shift data (correct end times, override badges, worked-vs-scheduled).
- **Phase 3 — Calendar:** no schema changes. Added `calendar/` with
  `eventsRepo.ts` (event CRUD, events grouped by date) and `categories.ts`
  (fixed class/deadline/personal/work colors, independent of theme). Month
  view: 42-cell grid, event chips (dots on mobile), shift days rendered as a
  subtle `bg-accent-subtle` background tint (PTO = faint amber) — never as
  event blocks; legend explains the tint. Week view: 7 columns on desktop,
  stacked day sections below md. Event modal: add/edit/delete with title,
  date, start/end time, category. Dashboard today strip reads these events.
- **Phase 4 — Study Library:** no schema changes. Added `library/` with
  `libraryRepo.ts` (CRUD + cascade delete of a subject's resources),
  `palette.ts` (fixed 12-color palette, theme-independent). Subject grid:
  color-strip cards with resource counts and pending-due badges; add/edit
  modal with live color preview. Detail view: two panes (notes with explicit
  Save | resources with tag chips, due-date badges — Overdue/Due today/Done —
  URL links vs copyable file paths, completed toggle, filter). Search on the
  library page filters subjects (name/description/notes) and shows
  cross-subject resource matches. Resource due dates feed the Dashboard
  deadlines card (already live-queried there).
- **Phase 5 — Pomodoro & Focus:** schema bump to **v2** — added `appSettings`
  (singleton row `id: 'pomodoro'` holding `PomodoroSettings`), documented in
  §1.8. Rewrote `usePomodoroStore` as a timestamp-based singleton engine
  (one module-level interval, accurate after tab throttling) implementing
  25/5/longer-after-4 with per-user durations, synthesized two-tone chime
  (WebAudio, offline), browser notifications on phase end, focus sessions
  logged to `pomodoroSessions` (date/duration/focus target), phase skip and
  cycle tracking. Focus page: large circular SVG countdown, phase chips,
  cycle dots, focus-target input, start/pause/reset/skip; collapsed
  `<details>` session log below. Settings: Pomodoro section (durations,
  cycles, sound/notification toggles) persisted + applied live. Dashboard
  mini-widget now reads the shared engine (no local interval) with
  Active/Paused/Idle status.
- **Phase 6 — Settings, backup, deployment, polish:** no schema changes.
  Added `db/backup.ts` — export **all 8 tables** to one downloadable JSON
  (`productivity-backup-YYYY-MM-DD.json`) and import it back (validated,
  transactional clear+bulkPut, reload to re-init stores) → Settings › Data &
  Backup shows per-table row counts. Stats view: Dashboard `StatsCard` with
  days studied this week, focus hours this month, sessions this week,
  resources completed (existing pomodoro/library data only). Global
  **Ctrl/Cmd+K command palette** (`components/ui/CommandPalette.tsx`):
  new event (opens Calendar's event modal for today), start pomodoro
  (shares the global engine), log/remove PTO today, plus navigation.
  Responsive pass: Focus ring now scales (`aspect-square`, max 264px),
  TopBar separator hidden below sm, resource row action buttons enlarged on
  touch, week strip verified single-column below 768px. `DEPLOY.md` added
  (Netlify drag-drop/CLI/Git + Vercel CLI/Git, PWA install + offline notes).
- **Weekly roster rework (schema v3, Part 1 of 2):** removed the singleton
  `shiftConfig` and replaced it with `weeklySchedules` — one independent
  record per Mon–Sun week (`weekStartDate`, `offDays`, `shiftStartTime`,
  `shiftLengthHours`). `shiftLogic.ts` resolves each date from its own
  week's record only, producing a new `unscheduled` state (with
  `unscheduledCount` in summaries) when a week has no roster; PTO and
  one-off overrides still layer on top unchanged. Shifts page: per-week
  "Add/Edit this week's schedule" action, unscheduled banner, dashed
  unscheduled day cells and legend entry. New `WeeklyScheduleModal`
  (upsert keyed by `weekStartDate`) and a Settings "Weekly Schedules"
  section that lists, adds, edits and deletes individual weeks (replacing
  `ShiftScheduleSettings`). Dashboard today-strip + weekly-hours card and
  Calendar shift tints now use the per-week context; `db/backup.ts` exports
  `weeklySchedules` instead of the dropped table. No schedule is ever
  guessed from another week.
