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
Current version: `7`
(v3 replaced `shiftConfig` with `weeklySchedules`; v4 added the `subjectId`
index on `calendarEvents`; v5 adds topic-based library: `topics`,
`assessments`, topic-level `resources` with file blobs, and
`subjectId`/`topicId` links on `pomodoroSessions`; v6 adds `aiProviders`,
the configurable AI provider table backing the global assistant; v7 adds
`chatSessions` / `chatMessages` for persistent assistant chat history)
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
db.version(6).stores({
  aiProviders:      'id, label, isDefault',
});
db.version(7).stores({
  chatSessions:     'id, updatedAt, providerId',
  chatMessages:     'id, sessionId, createdAt',
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

### 1.9 `aiProviders` — configurable AI models (schema v6)

```typescript
export interface AiProvider {
  id: string;
  label: string;        // User-facing name, e.g. "Gemini Flash"
  baseUrl: string;      // OpenAI-compatible root, no /chat/completions suffix
  apiKey: string;       // Empty on first run — user must paste a key
  modelName: string;    // e.g. 'gemini-2.0-flash'
  isDefault: boolean;   // Exactly one provider is default at a time
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}
```

**No vendor is hardcoded in feature code.** Every AI feature resolves its
endpoint through `getDefaultProvider()` in
`src/features/ai/aiProviderRepo.ts`, which returns the `isDefault` row (falling
back to the oldest row). Switching providers is therefore a Settings-only
change — no code edits. `buildChatCompletionsUrl()` appends
`/chat/completions` and `stripChatCompletionsSuffix()` tolerates a pasted URL
that already includes it.

On first run `initializeDatabaseDefaults()` seeds exactly one default row
pointing at Gemini's OpenAI-compatible endpoint
(`https://generativelanguage.googleapis.com/v1beta/openai`, model
`gemini-2.0-flash`) with an **empty apiKey**, so the assistant stays disabled
until the user supplies a key. Any OpenAI-compatible endpoint (OpenRouter,
Groq, Ollama, LM Studio, …) can be added via "+ Add model".

`providerIsReady()` requires base URL, API key and model name to be non-empty;
when it returns false the launcher/panel are disabled with a pointer to
Settings. Keys are stored in plain IndexedDB like all other local data.

---

## 1.10 Global AI Assistant (function calling)
`AssistantLauncher` (floating, bottom-right, every page) opens
`AssistantPanel`. Both are mounted once in `App.tsx` alongside the
`Toaster`. The Ctrl+K command palette also routes natural-language input into
the same assistant: typing a query appends a dynamic
`Ask Assistant: "<query>"` action to the filtered command list, and
`Open AI assistant` is a permanent palette command. Selecting either calls
`useAssistantStore.getState().ask()` / `.setOpen(true)`.

`src/features/ai/tools.ts` and `toolsExtended.ts` expose the callable
functions. Each performs a **real** Dexie/store operation and returns a
structured result that is fed back to the model so it can report accurately
what happened. Shared argument validation lives in `toolRuntime.ts`.

**Lookup — always call these first (read-only)**

| Function | Arguments | Returns |
| --- | --- | --- |
| `listSubjects` | — | `id`, `name`, `term` for every subject |
| `listTopics` | `subjectId` | `id`, `title`, `status` for each topic |
| `getWeekSchedule` | `weekStartDate` | Per-day resolved schedule incl. PTO + one-off exceptions |

**Read-only**

| Function | Arguments | Returns |
| --- | --- | --- |
| `getTodaysSchedule` | — | Today's shift/day-off, events, minutes focused |
| `getUpcomingDeadlines` | `days` | Assessments + resource due dates in the window |
| `searchLibrary` | `query` | Topics, notes, resources, assessments by text |
| `getFocusStats` | `range` (`today`/`week`/`month`) | Total focus time, broken down per subject |
| `getSubjectProgress` | `subjectId` | Topics by status, % confident, next assessment |
| `getCurrentStatus` | — | Active status and theme |

**Writes — run immediately, each raises a visible toast**

| Function | Arguments | Real effect |
| --- | --- | --- |
| `setStatus` | `status` | Switches status/theme via `useStatusThemeStore` |
| `addCalendarEvent` | `title`, `date`, `time`, `category`, `recurrence` | `saveEvent` |
| `addResourceLink` | `topicId`, `title`, `url` | `saveResource` (kind `link`) |
| `createSubject` | `name` | `saveSubject` |
| `createTopic` | `subjectId`, `title` | `saveTopic` |
| `markTopicStatus` | `topicId`, `status` | Updates the topic row |
| `addTopicNote` | `topicId`, `title`, `content` | Appends to topic notes |
| `addAssessment` | `subjectId`, `type`, `date`, `weight` | `saveAssessment` |
| `startPomodoroSession` | `durationMinutes` | Starts a real timer |
| `stopPomodoroSession` | — | Stops the running timer |

**Writes — require an explicit Confirm button before running**

| Function | Arguments | Confirm text states |
| --- | --- | --- |
| `addOrUpdateWeeklySchedule` | `weekStartDate`, `offDays`, `shiftStartTime`, `shiftLengthHours` | The full roster being written |
| `addPTO` | `date` | The date and that it replaces the current shift |
| `addOneOffShiftException` | `date`, `startTime`, `hours` | New start/end and that it replaces the shift |
| `deleteCalendarEvent` | `eventId` | That it is permanent and cannot be undone |

`CONFIRMATION_TOOL_NAMES` holds exactly those four. They **pause** in the chat
UI and require Confirm/Cancel before `executeTool` runs — the assistant never
applies them on its own, even when the request seems unambiguous.

**ID discipline.** The system prompt instructs the model to call
`listSubjects` / `listTopics` before any function that needs an id, and never
to guess one. `requireSubject()` / `requireTopic()` reject an unknown id with
a message telling the model to look it up. If a name matches more than one
subject or topic, the model is instructed to ask the user which one is meant.
Duplicate `createSubject` / `createTopic` calls are rejected rather than
silently duplicating.

Safety model:

- Every action raises a **visible toast** (`useToastStore` / `Toaster`) with a
  one-line summary, so nothing happens silently.
- `MUTATING_TOOL_NAMES` marks every tool that changes stored data.
- Arguments are validated up front: dates must be `yyyy-MM-dd`, times `HH:mm`,
  weights 0–100, hours 1–24, enums checked against their allowed values. A bad
  argument returns a clear error the model can report instead of writing junk.

### Assistant messages must be stored and replayed verbatim

Gemini 3 attaches a `thought_signature` to every tool call. In the
OpenAI-compatible response it arrives at
`tool_calls[i].extra_content.google.thought_signature`, and Gemini rejects the
follow-up request with **HTTP 400 "Function call is missing a
thought_signature in functionCall parts"** if it is absent.

So the assistant message is kept exactly as the provider returned it:

- `chatCompletion()` returns `raw` — `choices[0].message`, untouched.
- The store stores it on `ChatMessage.raw`.
- `toWire()` forwards `raw` verbatim for any assistant turn that has tool
  calls, instead of rebuilding it from `id`/`name`/`arguments`. Rebuilding is
  what silently dropped the signature and caused the 400.

This holds for every turn of the tool loop: multiple tool calls in one turn,
and chained calls after results, each keep their own signature. Providers that
send no signature (OpenRouter, Groq, Ollama, …) are unaffected — the message
is sent as-is and **no placeholder values are invented**.

Two related invariants the same loop depends on:

- A tool result must carry a matching `tool_call_id`. A confirmation-gated call
  stores its `callId` on `pending` so the result written after the user
  approves stays paired.
- History is trimmed with `trimHistory()`, never a bare `slice(-N)`, which
  could cut between a `tool_calls` message and the results answering it.
  `trimHistory()` walks back to the parent turn so the sequence is never split.

Regression coverage: `node scripts/verify-thought-signature.mjs` drives the real
`chatCompletion()` against a mock Gemini endpoint that returns HTTP 400 on an
unsigned tool call, covering single tool calls, two calls in one turn, chained
calls, an unsigned provider, legacy history without `raw`, and a confirmed
gated call. `node scripts/verify-chat-history.mjs` covers the persistence
rules and `node scripts/verify-extended-tools.mjs` covers every callable
function (writes reaching Dexie, argument validation, confirmation gating, and
the confirmation wording).

### Scope: this is Part 1

PDF-based subject Q&A is **Part 2 and intentionally out of scope** for this
pass. It requires a separate text-extraction pipeline (PDF → chunked text,
plus embeddings/indexing) before the assistant can meaningfully reference
uploaded lecture files in `resources`.

### 1.11 Persistent chat history (schema v7)

```typescript
export interface ChatSession {
  id: string;
  title: string;                // from the first user message, or user-set
  providerId: string | null;    // FK -> AiProvider.id that produced it
  createdAt: string;
  updatedAt: string;            // bumped on every stored message
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;            // FK -> ChatSession.id
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;              // prose for the UI; '' on pure tool-call turns
  raw: Record<string, unknown>; // FULL message as sent/received, incl. extra_content
  toolCallIds?: string[];       // assistant turns: which calls it requested
  toolCallId?: string | null;   // tool turns: which call this answers
  toolName?: string | null;
  display?: string | null;      // short human summary (UI only)
  error?: boolean;
  createdAt: string;
}
```

`src/features/ai/chatRepo.ts` owns all of it: session CRUD, `appendMessage()`,
`buildTranscript()` and `toViewMessages()`.

**Why `raw` exists.** Assistant messages must be stored and replayed
*verbatim*. Gemini 3 attaches a `thought_signature` to every tool call
(`tool_calls[i].extra_content.google.thought_signature`) and rejects the next
turn with HTTP 400 if it is missing. Storing a normalized subset and
rebuilding the request would drop it, so `raw` is the source of truth; the
other columns exist only so the UI can render without parsing JSON. This
survives a page refresh, which an in-memory transcript could not.

Rules the transcript builder enforces:

- **Context window.** Only the most recent ~20 messages are sent, but the
  window is widened when a `tool_calls` turn and its results would otherwise be
  split. It may exceed 20 by a message or two — that is intentional.
- **No orphans.** A `tool` message whose issuing assistant turn is missing is
  dropped, never sent with an unpaired `tool_call_id`.
- **Provider pinning.** Sessions record `providerId`. Switching the default
  provider starts a **new** session instead of replaying old messages, because
  `extra_content` is Gemini-specific and must never be sent to another
  provider.
- **No secrets.** Only message payloads are stored. The API key lives in
  `aiProviders` and the `Authorization` header is not part of a message.
- **Rendering.** `toViewMessages()` shows user/assistant prose as chat bubbles
  and collapses tool calls and results into small "Action · name" chips — raw
  JSON is never displayed.

`chatSessions` and `chatMessages` are included in `db/backup.ts`
(`schemaVersion: 7`). Settings → Assistant Chat History has a
"Clear all history" action that wipes both tables.

### 1.13 Cross-device sync (Dexie Cloud)

All tables sync through Dexie Cloud except one (see below). Configuration lives
in `src/db/cloudConfig.ts`.

```typescript
db.cloud?.configure({
  databaseUrl: 'https://zmofmso62.dexie.cloud', // committed on purpose
  unsyncedTables: ['aiProviders'],
  blobMode: 'lazy',
});
```

**ID format.** Every primary key is a client-generated **string UUID**
(`crypto.randomUUID()` via `src/utils/id.ts`), declared as a plain `'id'`
primary key — never `++id` and never `@id`. This is deliberate:

- Dexie Cloud explicitly supports own GUID strings, and forbids ever changing a
  table's primary keys.
- `@id` (auto-generated) would require keys prefixed with a dedicated 3-letter
  table shortname, which existing UUIDs do not have. Switching would mean
  re-keying every row — a table migration, and migrations on *synced* tables
  cannot be performed consistently on the client.
- Consequently there is **no `Version.upgrade()` touching any synced table**.
  The only `.upgrade()` in the codebase is the historical schema v5 one, which
  predates sync.

`themeStatusMap` (keyed on `status`) and `appSettings` (keyed on the literal
`'pomodoro'`) keep their natural keys. These are deterministic, so two devices
seeding independently converge on the same row rather than duplicating it.

**Unsynced tables.** `aiProviders` is excluded so API keys never leave the
device — each device configures its own key. Nothing else is device-specific.

**Blob handling.** `resources.blob` (uploaded files) uses `blobMode: 'lazy'`,
so bytes are offloaded to remote storage on first sync. The upload UI warns
above 20 MB because that first sync is slow.

**Seeding rules** (`src/db/defaultData.ts`) — synced tables must never be
blindly populated, or a fresh device would overwrite synced rows with defaults:

1. Insert a default row **only when that row is missing**; never overwrite.
2. Only fixed/deterministic primary keys.
3. Run on first run when signed out, and again on the first `syncComplete`
   after signing in.

**Service worker.** `vite-plugin-pwa` precaches only same-origin build assets
and `runtimeCaching` is empty, so Dexie Cloud requests are never cached or
intercepted. Offline use is unaffected.

**Settings → Sync** offers sign in, the signed-in email, live status
(synced / syncing / offline / error) and sign out. Signing out erases the local
database, so it requires an explicit acknowledgement checkbox, offers an
"Export backup first" button, and is blocked entirely while sync is
incomplete (offline, syncing or error) to avoid losing unpushed changes.

### Conflict resolution for same-key rows

Dexie Cloud is **server-authoritative**: the server re-executes operations with
their where-clauses, and the last write to reach the server wins for a given
primary key. A locally seeded row and a cloud row with the same key do **not**
merge — the newer one overwrites the other. This is exactly why seeding is
insert-if-missing and is deferred until after the first sync when signed in:
without that ordering, a fresh device would push its defaults over the
account's real settings.

---

## 1.12 `/assistant` — full-page assistant

The bubble panel and the full page are two renderings of the same
conversation, not two implementations:

- `AssistantChat` — transcript, confirmation gate and composer. All behaviour
  comes from `useAssistantStore`; this only renders it.
- `AssistantSessionList` — New chat, rename, delete; collapsible side panel on
  `md+` and a slide-over drawer below.
- `AssistantPanel` — floating bubble; below `sm` it fills the viewport instead
  of floating, so it never appears as a small window on phones.
- `AssistantPage` — full page reached via the panel's Expand button, or by
  navigating to `/assistant`.

`App.tsx` holds an `assistantPage` flag. Expanding pushes `/assistant` onto the
history stack and remembers the originating tab; **Back** in the page (and the
browser back button) returns to that tab. The page and the bubble share one
Dexie history and one provider configuration — switching between them keeps
the same conversation open.

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
│   │   ├── db.ts                # Dexie instance, table definitions, db.cloud.configure()
│   │   ├── cloudConfig.ts       # Dexie Cloud URL, unsyncedTables, blobMode
│   │   ├── backup.ts            # export/import all tables as one JSON file
│   │   └── defaultData.ts       # first-run seeding (insert-if-missing only)
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
│   │   ├── library/             # topics, resources, assessments (schema v5)
│   │   │   ├── LibraryPage.tsx    # subject grid + global search (grouped)
│   │   │   ├── libraryRepo.ts   # subject/topic/resource/assessment CRUD
│   │   │   ├── palette.ts       # fixed 12-color subject palette
│   │   │   └── components/
│   │   │       ├── SubjectModal.tsx
│   │   │       ├── ResourceModal.tsx  # link OR file upload (Blob)
│   │   │       ├── TopicModal.tsx
│   │   │       ├── AssessmentModal.tsx
│   │   │       ├── MarkdownNotes.tsx   # markdown/LaTeX/code renderer
│   │   │       └── SubjectDetail.tsx   # progress + topics + two-pane detail
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
│   │   ├── ai/                  # global AI assistant (schema v6/v7)
│   │   │   ├── aiProviderRepo.ts # provider CRUD + getDefaultProvider()
│   │   │   ├── aiClient.ts      # OpenAI-compatible chat/completions + tool loop
│   │   │   ├── chatRepo.ts      # chat sessions/messages (Dexie, verbatim raw)
│   │   │   ├── toolRuntime.ts   # shared ToolError + argument validation
│   │   │   ├── tools.ts         # original tools + merged spec list/dispatch
│   │   │   ├── toolsExtended.ts # library/calendar/status functions
│   │   │   ├── types.ts         # ToolSpec / ChatMessage
│   │   │   └── components/
│   │   │       ├── AssistantLauncher.tsx   # floating bottom-right button
│   │   │       ├── AssistantChat.tsx       # transcript + composer (shared)
│   │   │       ├── AssistantSessionList.tsx# new/rename/delete sessions
│   │   │       ├── AssistantPanel.tsx      # floating bubble wrapper
│   │   │       └── AssistantPage.tsx       # full page at /assistant
│   │   └── settings/            # Phase 6: theme map, shifts, export/import
│   │       ├── SettingsPage.tsx
│   │       └── components/
│   │           ├── WeeklySchedulesSettings.tsx
│   │           ├── PomodoroSettingsSection.tsx
│   │           ├── AiProvidersSettings.tsx  # add/edit/default/test providers
│   │           ├── ChatHistorySettings.tsx   # clear all chat history
│   │           ├── SyncSettings.tsx          # Dexie Cloud sign in / status / out
│   │           └── DataBackupSection.tsx
│   ├── stores/
│   │   ├── useStatusThemeStore.ts   # status/theme/colorScheme (Zustand)
│   │   ├── usePomodoroStore.ts      # active timer state (Zustand)
│   │   ├── useAssistantStore.ts     # chat transcript, tool loop, confirmation
│   │   └── useToastStore.ts         # transient action-confirmation toasts
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

- **Topic-based Study Library (schema v5):** restructured the Library from one
  notes blob per subject into `subjects -> topics -> resources`. New `topics`
  table (title, Markdown/LaTeX/code notes, status Not started / Studying /
  Confident, manual order) with a `TopicModal`. `resources` gained `topicId`,
  `kind: 'link' | 'file'` and file metadata + Blob (PDF/image/doc uploads are
  stored in IndexedDB and opened via object URLs with View / Download);
  `Subject.notes` is legacy. The v5 Dexie upgrade migrates each subject's
  legacy notes and subject-level resources into a default "General" topic.
  New `assessments` table (exam / quiz / assignment / project, date, optional
  weight, upcoming/done) feeds the Dashboard's Upcoming Deadlines card
  alongside resource due dates. Subject page: overall progress bar ("N of M
  topics Confident"), topic grid with status pills, two-pane detail (left =
  selected topic's rendered notes, right = that topic's resources),
  assessments section, and per-subject focus stats (week/month minutes from
  linked `pomodoroSessions`, which now carry optional `subjectId`/`topicId`).
  Focus page: free-text target replaced by subject + topic selectors (label
  stays editable and prefilled); SessionLog resolves linked names. Library
  search spans topic titles/notes, resource titles and assessment names,
  grouped by subject. `db/backup.ts` exports all 10 tables (schemaVersion 5,
  file blobs stripped from JSON). Cascade delete covers topics, resources,
  assessments, linked events; pomodoro sessions are unlinked, not deleted.

- **Global AI Assistant (schema v6, AI Part 1):** added the `aiProviders`
  table (label, baseUrl, apiKey, modelName, isDefault) and a Settings "AI
  Providers" section that lists providers, adds/edits/deletes them via
  "+ Add model", marks one default and offers a per-provider "Test
  Connection". First run seeds one default Gemini row against its
  OpenAI-compatible endpoint with an empty `apiKey`; until a key is present
  every AI affordance is disabled with a pointer to Settings. No vendor is
  hardcoded in feature code — `getDefaultProvider()` is the single lookup, so
  switching providers is a Settings-only change. A floating `AssistantLauncher`
  (bottom-right, every page) opens `AssistantPanel`, and the Ctrl+K command
  palette feeds natural-language queries into the same assistant via a dynamic
  `Ask Assistant: "<query>"` action plus an "Open AI assistant" command. The
  assistant uses OpenAI-style function calling over six tools that perform
  real Dexie/store operations and return their result to the model for a
  plain-language confirmation: `getTodaysSchedule`, `getUpcomingDeadlines`,
  `searchLibrary`, `addOrUpdateWeeklySchedule`, `startPomodoroSession` and
  `stopPomodoroSession`. Every executed action raises a visible toast, and
  `addOrUpdateWeeklySchedule` is confirmation-gated in the chat UI so roster
  changes never apply without explicit approval. `db/backup.ts` exports
  `aiProviders` (schemaVersion 6). **Scope note:** this is Part 1 only —
  PDF-based subject Q&A is a later phase requiring a separate text-extraction
  and indexing pipeline before uploaded lecture files can be referenced.

- **Assistant chat history (schema v7):** added `chatSessions` and
  `chatMessages`, so conversations survive a reload. Every message is stored
  with the provider's own payload in `raw` and replayed verbatim — this is
  required for Gemini's `thought_signature` and would silently reintroduce the
  HTTP 400 otherwise. The session list supports New chat, rename and delete;
  Settings has "Clear all history"; both tables are included in the export /
  import backup. Only the most recent ~20 messages are sent to the model, and
  the window is widened rather than split when a `tool_calls` turn and its
  results straddle the cut; tool results with no issuing turn are dropped.
  Sessions record their `providerId`, so switching the default provider starts a
  fresh session instead of replaying another provider's messages. Only message
  payloads are stored — never the API key. The panel renders user/assistant
  prose and collapses tool activity into "Action" chips, never raw JSON.

- **Full-page assistant at `/assistant`:** the bubble panel and the full page
  share one `AssistantChat` component, one `useAssistantStore` and one Dexie
  history, so no chat logic is duplicated. The page adds a session list that is
  a persistent rail on `md+` and a slide-over drawer below, reached from the
  panel's Expand button; expanding pushes `/assistant` onto the history stack
  and remembers the originating tab so Back returns there. Under 768px the
  bubble panel now fills the viewport rather than floating.

- **Expanded assistant function set:** the callable surface grew from six to
  twenty-three functions, split across `tools.ts` (original) and the new
  `toolsExtended.ts`, with shared validation in `toolRuntime.ts`. New lookup
  functions `listSubjects` and `listTopics` give the model real ids;
  read-only reports `getWeekSchedule`, `getFocusStats`, `getSubjectProgress`
  and `getCurrentStatus`; immediate writes `setStatus`, `addCalendarEvent`,
  `addResourceLink`, `createSubject`, `createTopic`, `markTopicStatus`,
  `addTopicNote` and `addAssessment`; and confirmation-gated writes `addPTO`,
  `addOneOffShiftException` and `deleteCalendarEvent` alongside the existing
  `addOrUpdateWeeklySchedule`. The system prompt now groups the functions by
  risk, instructs the model to look ids up rather than guess and to ask the
  user when a name is ambiguous, and every function validates its arguments
  (date/time format, enum membership, weight and hour ranges) so a bad request
  returns a clear error instead of writing bad data. The function-calling loop,
  the confirmation gate and the verbatim `raw` message storage/replay are
  unchanged.

- **Cross-device sync via Dexie Cloud:** `dexie-cloud-addon` is attached in
  `db.ts` and configured from the committed `db/cloudConfig.ts` with the
  database URL — deliberately not read from the gitignored `dexie-cloud.json`,
  which does not exist on the build server. `aiProviders` is excluded from sync
  so API keys stay per-device; `resources` blobs use `blobMode: 'lazy'` with a
  20 MB upload warning. Primary keys are unchanged: all remain plain `'id'`
  string UUIDs, with no `Version.upgrade()` on any synced table, per Dexie
  Cloud's rule that primary keys must never change and synced-table migrations
  cannot run client-side. Dexie was upgraded 4.0.11 → ^4.4.5 (the addon
  requires ≥4.4.5). First-run seeding was hardened to insert only missing rows
  so a fresh device cannot overwrite synced settings, and is deferred until
  after the first sync when signed in. Workbox precaches only app assets with
  empty `runtimeCaching`, so cloud requests are never intercepted. Settings →
  Sync adds sign in, live status, and a guarded sign out (acknowledgement
  checkbox, export-first option, blocked while sync is incomplete).
  **`dexie-cloud.key` is a secret: never commit it.**
