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
Current version: `1`
Source: `src/db/db.ts` (interfaces in `src/types/index.ts`)

```typescript
db.version(1).stores({
  subjects:        'id, name, color, createdAt',
  resources:       'id, subjectId, title, dueDate, createdAt',
  calendarEvents:  'id, date, category, startTime, endTime',
  shiftConfig:     'id',
  shiftOverrides:  'id, date, type',
  pomodoroSessions:'id, date, durationMinutes, completedAt',
  themeStatusMap:  'status'
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
  notes: string;           // Free-form notes (shown in the detail view)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}
```

### 1.2 `resources` — links/files attached to a subject

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

### 1.3 `calendarEvents` — month/week view events

```typescript
export type EventCategory = 'class' | 'deadline' | 'personal' | 'work';

export interface CalendarEvent {
  id: string;              // UUID primary key
  title: string;
  description?: string;
  date: string;            // YYYY-MM-DD
  startTime?: string;      // HH:mm (24-hour)
  endTime?: string;        // HH:mm (24-hour)
  category: EventCategory;
  createdAt: string;       // ISO 8601
}
```

### 1.4 `shiftConfig` — singleton recurring-schedule settings

```typescript
export interface ShiftConfig {
  id: string;               // Singleton key: 'default'
  shiftLengthHours: number; // Default: 9
  startTime: string;        // Default: "09:00" (HH:mm)
  workingDays: number[];    // 0=Sun..6=Sat; default [1,2,3,4,5] (Mon–Fri)
  offDays: number[];        // default [6,0] (Sat, Sun)
  updatedAt: string;        // ISO 8601
}
```

### 1.5 `shiftOverrides` — one-off date adjustments (PTO / custom hours)

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

### 1.6 `pomodoroSessions` — focus session log

```typescript
export interface PomodoroSession {
  id: string;               // UUID primary key
  date: string;             // YYYY-MM-DD
  focusSubject: string;     // What was focused on
  durationMinutes: number;  // e.g. 25
  sessionType: 'focus' | 'short_break' | 'long_break';
  completedAt: string;      // ISO 8601
}
```

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

### Related non-persisted settings type

`PomodoroSettings` (`focusDuration`, `shortBreakDuration`,
`longBreakDuration`, `cyclesBeforeLongBreak`, `soundEnabled`,
`notificationEnabled`) is defined in `src/types/index.ts` for Phase 5/6. It
will be persisted once Settings storage lands (plan: a singleton row in an
`appSettings` table — schema bump required, documented here first).

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
│   │   ├── db.ts                # Dexie instance & table definitions
│   │   └── defaultData.ts       # default shift config + theme mappings
│   ├── features/
│   │   ├── dashboard/           # bento grid page + widget components
│   │   │   ├── DashboardPage.tsx
│   │   │   └── components/
│   │   │       ├── TodayTimelineStrip.tsx
│   │   │       ├── PomodoroMiniWidget.tsx
│   │   │       ├── UpcomingDeadlinesCard.tsx
│   │   │       └── WeeklyHoursCard.tsx
│   │   ├── library/             # Phase 4: subjects, notes, resources
│   │   │   └── LibraryPage.tsx
│   │   ├── calendar/            # Phase 3: month/week views & events
│   │   │   └── CalendarPage.tsx
│   │   ├── shifts/              # Phase 2: weekly strip, PTO, overrides
│   │   │   ├── ShiftsPage.tsx
│   │   │   ├── shiftLogic.ts    # pure schedule resolution & summaries
│   │   │   ├── shiftsRepo.ts    # Dexie mutations for config/overrides
│   │   │   └── components/
│   │   │       └── DayOverrideModal.tsx
│   │   ├── focus/               # Phase 5: pomodoro timer & session log
│   │   │   └── FocusPage.tsx
│   │   └── settings/            # Phase 6: theme map, shifts, export/import
│   │       ├── SettingsPage.tsx
│   │       └── components/
│   │           └── ShiftScheduleSettings.tsx
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
