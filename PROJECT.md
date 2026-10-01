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

> **RULE: the About / Help page must be updated in the same change as any
> feature.** `src/features/about/helpContent.ts` holds every word on that page
> as data. Whenever a feature is added, removed, or its behaviour changes, edit
> that file in the same commit — a feature that ships without a line there is a
> feature the user cannot discover.
>
> `scripts/verify-about-help.mjs` (part of `npm run verify`) enforces the
> mechanical part: it checks the required sections exist, that the copy lives in
> one data file rather than JSX, that **every AI tool the runtime actually
> registers is described on the page**, and that the sync wording matches what
> `blobMode` really does. Adding a tool without a matching line will fail it.

---

## 1. Dexie.js Database Schema

Database name: `ProductivityDashboardDB`
Current version: `15`
(v3 replaced `shiftConfig` with `weeklySchedules`; v4 added the `subjectId`
index on `calendarEvents`; v5 adds topic-based library: `topics`,
`assessments`, topic-level `resources` with file blobs, and
`subjectId`/`topicId` links on `pomodoroSessions`; v6 adds `aiProviders`,
the configurable AI provider table backing the global assistant; v7 adds
`chatSessions` / `chatMessages` for persistent assistant chat history;
v8-v13 are additive; v14 adds `resourceGroups.parentGroupId` for nested
groups; **v15 changes no schema at all** and only re-labels note titles the
app itself generated, so a note is called "<Subject>'s Notes")
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
db.version(8).stores({
  uiState:          'id',   // single row, key 'current'
});
db.version(9).stores({
  topics:           'id, subjectId, status, createdAt, title',  // +title index
});
db.version(10).stores({
  resourceGroups:   'id, subjectId, order, createdAt',          // new table
  resources:        'id, subjectId, topicId, title, dueDate, createdAt, groupId',
});

// v11 is ADDITIVE and its upgrade touches NO row: `contentHtml` and
// `contentFormat` are plain (unindexed) fields, absent on every existing row.
// Nothing is converted here — conversion happens lazily on first edit.
db.version(11).stores({
  topics:           'id, subjectId, status, createdAt, title',
});
```

Notes carry a rich-text body in `contentHtml`, alongside the original markdown,
which is **never** overwritten or deleted.

### 1.3.2 Note formatting — size, alignment, color

Notes are edited in a **Tiptap (ProseMirror) WYSIWYG editor**, not a textarea.
Select text, press a button, see the result immediately; tag code is never
visible because there is no textarea to show it in.

| Control | Stored as |
| --- | --- |
| Size (Small / Normal / Large / Huge) | a `font-size` text-style mark |
| Alignment (left / center / right) | `text-align` on the paragraph/heading |
| Color (8 swatches + Default) | a `color` text-style mark |
| Clear formatting | `unsetAllMarks` + `clearNodes` |

**The palette uses CSS variables, not fixed hex values.** A note stores
`var(--note-c-rose)` and `themes.css` resolves it per theme *and* per mode,
mixing the hue toward that theme's `--text-primary`. That is what makes a color
readable in both light and dark without eight hard-coded values per theme, and
it follows the same pattern as `--pane-ring`. A literal hex, `rgb()`, or a named
color is **rejected by the sanitizer** precisely so this guarantee cannot be
bypassed.

**Storage is additive and lazy, which is the whole safety argument.** A topic
gained two fields: `contentHtml` (the editor's HTML) and `contentFormat` (an
`'html'` marker). Dexie **v11** is additive with an empty upgrade: existing rows
are untouched, so a note nobody opens is byte-identical to before.

- Opening a note converts the markdown **in memory only**. Nothing is written.
- The conversion is persisted on the **first real edit**, via
  `updateTopicContentHtml`, which writes *only* `contentHtml`/`contentFormat`.
- `notes` is therefore the permanent original forever. Clearing `contentHtml`
  and `contentFormat` reverts a note to markdown at any time.

`contentFormat` is the single authority on which body to render. Renderers must
read it and must not infer from the mere presence of a string.

**Sanitizing happens on the way IN as well as out.** `sanitizeEditorHtml` runs on
stored HTML when the editor loads and again on every save, so pasted content
cannot inject scripts at any point. The allowlist permits only the formatting
tags Tiptap emits, with no `on*` handler, `href`, `src`, `class`, or `url()`.
`scripts/verify-note-editor-browser.mjs` pastes a script tag, an `onerror`, an
`onclick`, an `<img>` and a literal red hex, and asserts each is stripped while
the safe text survives.

**Math is a separate seam.** `mathNode.ts` + `mathRender.ts` hold it, so swapping
in real KaTeX later is a change to that module alone — the toolbar, the
sanitizer and storage do not move. It currently styles `$..$` / `$$..$$` rather
than typesetting them, and the verification script pins every case the fake
renderer must keep working.

**The toolbar renders from the shared `NotesEditorBody`**, used by **both** the
standalone Library editor and the split-pane notes view, so the controls cannot
drift apart. On mobile it is one horizontally scrolling row with 40px targets
and `overscroll-x-contain`.

**Every formatting button must `preventDefault` on `mousedown`.** This is not
optional and it is easy to lose in a refactor, because the bug it prevents looks
like a color bug or a sanitizer bug and is neither. Pressing a button fires
`mousedown` **first**, which moves focus off the editor and **collapses the
selection to a caret**. By the time `onClick` runs, the command applies to
**zero characters**: the user then sees a bare `<span>` with nothing inside it
(which reads as "size pastes tag code into the textarea") and, for color, an
empty span that renders nothing at all (which reads as "text color does not
work at all").

Tiptap does not save you from this — `onMouseDown` firing before `onClick` is
browser behaviour, not a framework detail. `keepSelection` in `NoteEditor.tsx` is
the single shared handler, and it must be on `mousedown`: preventing the default
of `click` is already too late. The palette swatches are in a portal and use
`onPointerDown`, which needs the same guard or a phone tap collapses the
selection exactly like a mouse press did. Regression checks in
`verify-ai-tools-library.mjs` assert both.

**`setContent` must never be driven by the editor's own `onUpdate`.** Doing that
resets the selection on every keystroke. Content is re-seeded only when `noteKey`
changes, i.e. when a different note is opened, and always with
`{ emitUpdate: false }`.

**Out of scope, deliberately:** the AI reply renderer. `AssistantChat.tsx` still
renders message text as plain `whitespace-pre-wrap` and does not use this
renderer.

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
  notes: string;           // Markdown original — NEVER overwritten or deleted
  contentHtml?: string;    // Rich-text editor HTML. Absent until the note is edited.
  contentFormat?: 'html';  // Which body is authoritative. Absent => `notes`.
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
  groupId?: string | null; // FK -> resourceGroups.id (null = ungrouped). Independent
                            // of topicId: a grouped resource still has its topic.
  kind: ResourceKind;      // 'link' = urlOrPath; 'file' = blob holds the upload
  title: string;           // Title / label
  urlOrPath?: string;      // Web URL or file reference/path — REQUIRED for
                           // 'link', ABSENT for 'file' (an upload has no URL).
                           // Read it defensively: `(x.urlOrPath ?? '')`.
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

**Preview.** One **Preview** button per resource row opens `ResourceViewer`,
which dispatches on `previewKindFor()` (`src/features/library/previewKind.ts`,
pure and separately testable):

| Kind | Behaviour |
| --- | --- |
| `image` (jpeg/png) | `<img>` from a blob object URL, revoked on unmount |
| `pdf` | The shared `PdfViewer` (pdf.js) — page render + Prev/Next |
| `drive` | Google Drive share link → `drive.google.com/file/d/<id>/preview` iframe |
| `opaque` | Word / PowerPoint / anything else: name, type, size + **Download** |
| `link` | Non-Drive URL → **Open link** in a new tab |
| `none` | No local blob → "File not available on this device" |

`PdfViewer` is the **single place** pdf.js page-render logic lives; the Library
viewer mounts it and any "Ask about this PDF" flow must reuse the same component
rather than re-implementing page rendering. A test asserts that **exactly one**
file in `src/` imports `pdfjs-dist`, so a second renderer cannot creep in.
`pdfjs-dist` is **code-split** via `React.lazy` (~474 kB) with its worker
(~1.2 MB) as a separate hashed asset, so neither is downloaded until a PDF is
actually previewed. In pdf.js v6, `destroy()` lives on the loading task, not the
document proxy, so the task is retained and aborted on unmount.

**Render safety.** pdf.js permits one render per canvas and throws *"Cannot use
the same canvas during multiple render() operations"* otherwise. Every render:

1. cancels the previous `RenderTask` and **awaits** that cancellation, then
2. claims a monotonic token, discarding any stale completion that lands after a
   newer render has started (so an old page can never repaint the canvas).

The effect cleanup also cancels on unmount or input change. A cancelled render
rejects with `RenderingCancelledException`, which is swallowed rather than shown
as an error.

**Viewer controls.** Zoom is a multiplier over fit-to-width (`1` = fit, clamped
to 0.5–4, reset via **Fit**) with the percentage always displayed; rotation
cycles 0/90/180/270 via `getViewport({ rotation })`; a **page number input** and
Prev/Next show the current page and total; a **Rendering…** overlay prevents
zoom/rotate/page changes from looking frozen. Full screen is a real
`fixed inset-0` overlay that re-measures the available width, not a scaled
canvas, and is offered by the `standalone` variant. While the viewer has focus
(`tabIndex=0`): ←/→ change page, +/− zoom, Esc exits full screen. Zoom and
rotation are local state reset per opened document, never global.

Drive embeds are best-effort: Drive serves its own "no access" page inside the
iframe for private or unshared files, which the parent cannot detect, so
**Open link** is always offered alongside the embed. **Download** and **Open
link** remain available regardless of whether the inline preview succeeds.

**Two modes, and `kind` must be explicit.** `ResourceModal` offers *Link*
(title + URL) and *Upload file* (title + file). `saveResource()` validates per
mode: `'link'` requires a non-empty `urlOrPath`, `'file'` requires a blob and
requires **no** URL. Because `kind` defaults to `'link'`, **every call site must
pass it** — omitting it made uploads fail with "A URL or file path is
required", which is exactly the bug fixed here. `urlOrPath` is optional on both
`Resource` and `ResourceInput` for the same reason: it is mandatory only in link
mode, so consumers must read it as `resource.urlOrPath ?? ''`.

Verified by `scripts/verify-resource-form.mjs` (run by `npm run verify`): link
mode saves and still rejects a missing URL or title; a PDF, a PNG and a DOCX
each save with **no** URL and keep their blob, fileName, mimeType and fileSize;
editing an upload's title without re-picking a file keeps the stored bytes; and
an upload that omits `kind` is still rejected, which pins the original bug.

### 1.3.1 `resourceGroups` — named folders for resources (v10)

```typescript
export interface ResourceGroup {
  id: string;              // UUID primary key
  subjectId: string;       // FK -> subjects.id
  name: string;            // User-given group name
  order: number;           // Manual ordering among SIBLINGS (v14: reused, not a new field)
  createdAt: string;       // ISO 8601
  parentGroupId?: string | null; // v14: FK -> resourceGroups.id. null/absent = top level.
}
```

A group is a **lane over resources inside one subject**, not a new level in the
hierarchy. It is deliberately *not* a child of `topics`: a grouped resource
keeps its own `topicId`, so notes, split-with-notes and `deleteTopicCascade`
are unaffected, and grouping *across* topics ("every past paper") works.

#### 1.3.1.1 Nesting (v14)

`parentGroupId` makes the lane itself a tree. A group sits either at a subject's
top level or inside exactly one other group of that same subject, up to
`MAX_GROUP_DEPTH = 5` levels.

**Every rule lives in one module, `src/features/library/groupTree.ts`**, and is
shared by the Library UI, the repository and the AI tools, so the three can never
disagree about what is legal. It is pure: no Dexie, no React. The repository
validates through it, so a rule cannot be enforced in the UI but skipped by the
assistant.

Invariants, pinned by `scripts/verify-nested-groups.mjs` (91 checks):

- A group belongs to exactly one subject and is never re-homed.
- A parent must belong to **the same subject** as its child. The parent is
  resolved from the whole table, so a cross-subject id is reported as such
  rather than as a missing parent.
- **No cycles.** A group can never become its own ancestor, via a chain of any
  length.
- **Depth is capped at 5.** The check accounts for the height of a whole
  *subtree* being moved, not just the moved group's own level.
- A name must be **unique among siblings only**. The same name in two different
  branches is allowed, which is why every tool and picker result carries a full
  path rather than a bare name.
- **Deleting a group deletes only the group.** Its child groups and its
  resources move **up one level** to where it was, at any depth. The confirmation
  states both counts before the user commits. Losing a folder must not lose the
  work in it, nor the subfolders.
- Deleting a subject removes its groups at **every** depth.
- A resource subject change clears a now-invalid `groupId`.

The v14 upgrade is **additive and normalising**: it clears an impossible
`parentGroupId` (a parent that is gone, in another subject, self-referential, or
already in a cycle) and writes an explicit `null` where the field was absent. It
never rewrites a name, an order or a subject, and never deletes a row, so a
repaired group surfaces at the top level rather than vanishing. It adds **no
index**, because a subject's whole group set is small and read together.

**`resourceGroups` syncs unchanged.** The new field is ordinary row metadata and
needs no Dexie Cloud action of any kind: no new database, no console change, no
migration script. Existing rows simply have no `parentGroupId`, which already
means top level, and existing group ids stay valid everywhere they are
referenced.

`resourceGroups` is metadata, so it **syncs**: it is deliberately absent from
`UNSYNCED_TABLES` in `cloudConfig.ts`, and the file-blob rules (`BLOB_MODE`,
`LARGE_BLOB_WARNING_BYTES`) are untouched.

#### 1.3.1.2 Note titles (v15)

**A note's default title is `<Subject name>'s Notes`.** Exactly that, including
the awkward possessive: "Thermodynamics's Notes". It is deliberate and not
"fixed" to "Thermodynamics Notes", because every screen that shows the title is
showing the string the user was told to expect.

**One function owns the rule.** `getDefaultNoteTitle(subject)` in
`src/db/noteTitle.ts` is pure and takes the subject, not an id, so the UI, the AI
tools and the migration all call the same function and cannot drift:

- `getDefaultNoteTitle(subject)` → `"<Subject>'s Notes"`, falling back to the
  old generic constant only when the subject cannot be found.
- `uniqueDefaultNoteTitle(base, taken)` → the first free variant: the bare
  default, then `" 2"`, `" 3"`. It fills the **gap** rather than running past it,
  and compares case-insensitively.
- `generatedNoteTitleNumber(title, subjectName)` → `1` for the bare default, `N`
  for `"... N"`, `null` for anything the user typed. This is what decides whether
  a title may be rewritten.
- `noteTitleForNumber(subjectName, n)` → the same title for a given number.

Called from `ensureDefaultTopic` (the auto-created note), `saveSubject`'s rename,
`setTopicTitle`'s empty-title fallback, `TopicModal`'s blank title, the AI's
`createNote`, and the v15 upgrade.

**Numbering exists because duplicates are useless.** A note list and the picker
both show titles side by side with nothing else to distinguish them, which is the
same problem the file picker solves with paths.

**A generated title follows its subject; a typed one never moves.** Rather than
adding an `isGenerated` field (which would be a schema change for something
derivable), the check is textual: a title equal to the old subject's default, or
that default plus a number, is ours. `renameGeneratedNoteTitles` rewrites those
and returns `null` for everything else. **The rename and the title update share
one `db.transaction('rw', [db.subjects, db.topics])`**, so there is never a
moment where the subject has been renamed and the note has not. The NUMBER is
carried across rather than recomputed, so `"X's Notes 2"` becomes `"Y's Notes 2"`
and cannot collide with an existing sibling.

**The v15 upgrade changes no schema at all.** No table, field or index is added;
`.stores()` re-declares `topics` verbatim because Dexie requires the version to
exist. It re-labels only titles the app itself generated — empty, the legacy
`'General'` placeholder, or the old `'Untitled note'` default — and the predicate
is deliberately SEPARATE from v9's `needsTitleBackfill`, because v9's rule was
broader and reusing it would touch notes v9 deliberately left alone. Numbering is
per subject and respects real user titles. **Every write is `{ ...t, title }`**,
so `notes`, `contentHtml` and `contentFormat` ride across byte-for-byte. Running
it twice writes nothing, which matters because Dexie Cloud can replay a schema
upgrade on a synced device.

**No Dexie Cloud action is needed.** v15 adds no field, so there is nothing for
the cloud schema to learn: no new database, no console command, no migration
script. Existing notes simply gain a better title the first time the app opens.
A device that has already synced will replay the upgrade locally and the
resulting titles sync back as ordinary row updates.

**An empty group must still be rendered.** This is the whole of the "New group
does nothing" bug, and it is worth stating because the failure mode is so
misleading: the Dexie write always succeeded. `SubjectDetail.tsx` was doing
`if (members.length === 0) return null;` per group, so a group the user had just
created — which by definition has no members yet — was written to the database
and then never drawn. The list query was live and correctly scoped the whole
time. A group now always renders, with an inline "No resources in this group
yet" hint so an empty folder reads as a folder.

Two related defects are fixed alongside it, and both made the symptom
indistinguishable from "nothing happened":

- The **New group control sat inside the `topicResources.length === 0` ternary**,
  so a topic with no resources could not host a group at all. It now renders
  unconditionally.
- **Every group write was `void someWrite(...)` with no `await` and no `catch`**,
  so a rejected write vanished. Create, rename, delete and move now run through
  `runGroupAction`, which toasts `Could not create group: <reason>` (and the
  rename/delete/move equivalents) instead of failing silently.

`scripts/verify-groups-ui.mjs` drives the real repository functions and reads the
data back after every action, including that deleting a group keeps its resources
and that deleting a subject removes its groups.

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

### 1.9 `uiState` — synced UI state, one row (schema v8)

```typescript
export interface UiState {
  id: string;                // Always the literal 'current'
  status: UserStatus;
  themeOverride: ThemeMode | null;  // null = follow the status mapping
  updatedAt: string;         // ISO 8601
}
```

The two preferences that should **follow the user between devices**: the current
status and any theme override. Light/dark is deliberately absent — it is a
per-device preference (see §1.13.1).

A fixed key is used so two devices writing concurrently converge on the same row
instead of creating duplicates, and so "nothing saved yet" is unambiguous. The
row is written **only** by an explicit user action; it is never seeded and never
written at startup (see §1.13.1).

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
  modelName: string;    // e.g. 'gemini-3.1-flash-lite'
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
`gemini-3.1-flash-lite`) with an **empty apiKey**, so the assistant stays disabled
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

`src/features/ai/tools.ts`, `toolsExtended.ts` and `toolsLibrary.ts` expose
the callable functions. Each performs a **real** Dexie/store operation and
returns a structured result that is fed back to the model so it can report
accurately what happened. Shared argument validation lives in `toolRuntime.ts`,
and shared argument resolution in `toolResolve.ts`.

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
| `listGroups` | `subjectId` | Groups of one subject with ids and resource counts |
| `createGroup` | `subjectId`, `name` | `saveResourceGroup` |
| `renameGroup` | `groupId`, `name` | `renameResourceGroup`; resources untouched |
| `moveResourceToGroup` | `resourceId`, `groupId` | `moveResourceToGroup`; `null` means no group |
| `renameSubject` | `subjectId`, `name` | `saveSubject` upsert, keeps the id and all children |
| `renameTopic` | `topicId`, `title` | `setTopicTitle` |
| `renameResource` | `resourceId`, `title` | `saveResource` |
| `moveResource` | `resourceId`, `topicId` | `saveResource`; clears `groupId` |
| `createNote` | `subjectId`, `title`, `content?`, `topicId?` | `saveTopic`; refuses a cross-subject topic, no title means no write |
| `renameNote` / `setNoteTitle` | `topicId`, `title` | `setTopicTitle`; blank title is refused |

**Writes — require an explicit Confirm button before running**

| Function | Arguments | Confirm text states |
| --- | --- | --- |
| `addOrUpdateWeeklySchedule` | `weekStartDate`, `offDays`, `shiftStartTime`, `shiftLengthHours` | The full roster being written |
| `addPTO` | `date` | The date and that it replaces the current shift |
| `addOneOffShiftException` | `date`, `startTime`, `hours` | New start/end and that it replaces the shift |
| `deleteCalendarEvent` | `eventId` | That it is permanent and cannot be undone |
| `deleteResource` | `resourceId` | PERMANENTLY DELETE, and that the file goes with it |
| `deleteNote` | `topicId` | PERMANENTLY DELETE the note and its resources |
| `deleteTopic` | `topicId` | PERMANENTLY DELETE, plus resources and uploaded files |
| `deleteSubject` | `subjectId` | PERMANENTLY DELETE, plus everything under it |
| `deleteGroup` | `groupId` | That resources are KEPT and become ungrouped |

The five library deletes are listed in `LIBRARY_CONFIRM_TOOL_NAMES`
(`toolsLibrary.ts`) and spread into `CONFIRMATION_TOOL_NAMES`, so the
classification lives beside the handlers and a new delete cannot be added
without also being gated. `verify-ai-tools-library.mjs` derives its expected
delete count from that set rather than hardcoding a number, which is what stops
a new gated delete from slipping past the "every delete names the Confirm
requirement" check.

**Every Confirm card states WHAT will be lost, not merely that something will
be.** `describeDeleteCounts` reads live counts off the database (topics,
resources, uploaded files, notes, groups) while the card is being built, so they
cannot drift from the data the delete will act on, and the card appends
"This will also remove: …". The count helper never throws: an unresolvable
target yields `null` and the card falls back to its plain description, because a
preview must never be the thing that fails.

**How the Confirm guarantee actually holds.** It is structural, not a prompt
instruction. `useAssistantStore` splits the model's tool batch into gated and
ungated calls, runs the ungated ones, and **breaks out of the loop before
`runTool`** for anything gated. The call is parked as `pending` and only
`confirmPending()` — driven by the Confirm button — executes it. So the model
calling `deleteSubject` twice still deletes nothing; there is no `confirmed`
boolean parameter it could set to bypass the gate. Declining feeds
"The user moved on without confirming this action" back to the model.

**ID discipline.** The system prompt instructs the model to call
`listSubjects` / `listTopics` before any function that needs an id, and never
to guess one. `requireSubject()` / `requireTopic()` reject an unknown id with
a message telling the model to look it up. If a name matches more than one
subject or topic, the model is instructed to ask the user which one is meant.
Duplicate `createSubject` / `createTopic` calls are rejected rather than
silently duplicating.

**Id-or-name resolution (`toolResolve.ts`).** The library tools accept either an
id or a name, because the model often only has the name from the conversation.
`resolveByIdOrName` tries, in order: an exact id, a case-insensitive exact name,
then a case-insensitive substring. If more than one row matches it returns the
**candidate list with ids** rather than picking one, and the error text tells the
model to ask the user. Every rejection ends with "Nothing was changed", so the
model does not retry blindly against the wrong record. A wrong guess is worse
than an error here, because these tools delete data.

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
- **Every `tool_calls` turn is immediately followed by a tool turn answering
  it.** The provider requires `user -> model call -> tool response -> model
  answer`; a call with nothing after it is rejected with **HTTP 400**, and
  because the bad turn stays in the stored history, it poisons *every* later
  request in that session — the chat is then permanently broken, not just one
  turn. Three layers keep this true:
  1. `runTool()` (in `useAssistantStore`) always returns a tool turn, including
     when the tool throws, so a failure is reported rather than left dangling.
  2. Two paths that used to leave a call unanswered are now closed. Sending a
     new message while a confirmation is open resolves the pending call as
     declined first; and a turn mixing gated and ungated calls now executes the
     ungated ones before pausing, instead of `break`ing past all of them.
3. `normalizeHistoryForProvider()` (`historyNormalizer.ts`) is the ONE place
   that decides the turn order, and every request goes through it: the main
   path, each retry, the fallback model and every tool round. It guarantees the
   sequence is `user -> model call -> function response -> model answer`, that
   calls are answered in CALL ORDER, that an unanswered call gets a synthetic
   response, that an orphan response is dropped, that there are no empty or
   same-role-in-a-row turns, and that the request both starts and ends
   correctly. It works on a COPY and logs what it repaired.
4. The session is repaired AT THE SOURCE too. `repairStoredSession()` runs when
   a turn ends by any route (success, Stop, error, retries exhausted) and when a
   chat is opened, so an unanswered call is answered in the database rather than
   patched on every request. Nothing is ever deleted.
5. As a last resort, a 400 whose MESSAGE names turn order is retried ONCE with
   the system prompt, the last user message and a plain-text summary of the
   earlier turns. It is matched on the message, not the status, so a 400 for a
   missing `thought_signature` or a bad model name is never thrown away.
- History is trimmed by `trimToWindow()` at TURN BOUNDARIES, never a bare
  `slice(-N)`. The cut is walked back until the window starts on a user turn, so
  it can never open on a model turn nor split a `tool_calls` message from the
  results answering it. The window may come out SHORTER than the limit, which is
  the correct trade: a refused request returns no answer at all.
- **The bug this fixed.** `closeDanglingCalls()` appended a synthetic response
  immediately after the call, so a parallel call whose sibling already had a
  stored response went out as `[c2, c1]`. Gemini rejects that with
  `INVALID_ARGUMENT: Please ensure that function call turn comes immediately
  after a user turn or after a function response turn`, and because those rows
  are stored, every later message in that chat failed too.

Regression coverage: `node scripts/verify-thought-signature.mjs` drives the real
`chatCompletion()` against a mock Gemini endpoint that returns HTTP 400 on an
unsigned tool call, covering single tool calls, two calls in one turn, chained
calls, an unsigned provider, legacy history without `raw`, and a confirmed
gated call. `node scripts/verify-chat-history.mjs` covers the persistence
rules, the window-widening rules, and sequence integrity (group 8: a dangling
call is closed, an answered call is never double-answered, a partially answered
multi-call turn is completed, and the repair writes nothing to the database).
`node scripts/verify-extended-tools.mjs` covers every callable function (writes
reaching Dexie, argument validation, confirmation gating, and the confirmation
wording).

**The model must be able to see an id, or it will invent one.** Every lookup
tool that returns a reference must include the `id` field in the payload that
goes back to the model — the UI pill is irrelevant, only the tool response
matters. `searchLibrary` returns a flat, id-carrying list
(`resources: [{ id, title, type, subject, topic }]`, `topics: [{ id, title,
subject }]`) alongside the grouped view, and its summary says so explicitly.
Without that, the model had only the file name to hand back, passed it as
`resource_id`, and the tool failed — repeatedly, with no way to recover.

**`searchLibrary` searches the note's PLAIN TEXT, not its raw field.** It reads
`topicPlainText(topic)`, which returns the text of `contentHtml` for a converted
note and the markdown for a legacy one. Reading `notes` directly would be a
silent data-loss bug for the assistant: a converted note keeps its markdown
backup, but the user's real text lives in `contentHtml`, so every word typed in
the rich-text editor would be invisible to the assistant — the model would
report "no results" for text the user can see on screen. Both search paths (the
grouped view and the flat `topics` list) must use the same helper, and
`verify-extended-tools.mjs` pins all three cases: text only in the rich-text
field, text only in untouched markdown, and the stale backup of a converted note
not being searched.

`manage_split_screen` is deliberately forgiving, in this order:

1. exact id lookup;
2. else case-insensitive exact match on title / fileName;
3. else contains-match; **one** match is used;
4. **several** matches return `{ error: 'ambiguous_resource', candidates: [{ id,
   title, type }] }` as a normal tool result — a list the model can act on, not
   a dead-end error;
5. only a genuinely unknown value throws, and the message names the `"id"` field
   and says *never the file name*.

**The tool loop must always end in a sentence.** Every failure path returns a
`role: 'tool'` turn, so the strict order (`user -> model call -> tool response
-> model answer`) is never broken. And if the round budget runs out while the
model is still calling tools, `send()` makes one final `chatCompletion` **with no
tools offered** and persists that reply. Without it the loop simply fell through
with the transcript ending on a tool turn — the action chip rendered, the chat
looked frozen, and no HTTP 400 ever fired to explain it.

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
  unsyncedTables: [],                    // every table syncs, aiProviders included
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
  The `.upgrade()` callbacks in the codebase are all client-side value
  migrations that run on the upgrading device: the historical schema v5 one
  (which predates sync), v9 (note titles) and v10 (resource groups). None of
  them needs to execute consistently on the server, because each derives its
  writes from data the client already has.

`themeStatusMap` (keyed on `status`), `appSettings` (keyed on the literal
`'pomodoro'`) and `uiState` (keyed on the literal `'current'`) keep their natural
keys. These are deterministic, so two devices writing concurrently converge on
the same row rather than duplicating it.

**Unsynced tables.** None. `UNSYNCED_TABLES` is now an empty list, so every
table syncs — `aiProviders` included. Provider records (label, baseUrl, apiKey,
modelName, isDefault, supportsImages) are available on every signed-in device,
and the key stays inside the user's own account. While signed out nothing
syncs, so a provider added then works on that device exactly as before. The
export is kept (rather than removed) as the single place to opt a table out.

**Blob handling.** `resources.blob` (uploaded files) uses `blobMode: 'lazy'`,
so bytes are offloaded to remote storage on first sync. The upload UI warns
above 20 MB because that first sync is slow.

**Seeding rules** (`src/db/defaultData.ts`):

- `themeStatusMap`, `appSettings` and `uiState` are **not seeded at all**. They
  are synced tables, and a client writing defaults can overwrite an account's
  real values — this is exactly the bug a fresh device hits on first load.
  Their code defaults (`defaultThemeStatusMappings`, `defaultPomodoroSettings`)
  are merged **in memory** instead: the DB row wins, the code default is the
  fallback. A row is written only when the user changes the setting, and
  **"Reset to default"** deletes the row so the code default applies again.
- Nothing is seeded on a signed-*out* device either. `defaultPomodoroSettings`
  is the in-memory fallback at both read sites (`App.tsx` and
  `PomodoroSettingsSection.tsx`), so a local start still works.
- `aiProviders` is seeded **only on a signed-out device**. It is a synced table,
  and the default uses the fixed id `ai-provider-gemini-default`, so seeding on a
  fresh signed-in device would push an empty-key row over the account's real
  provider. Signed-in devices take their providers from the live query instead.
  Signed out, the seed is written locally and the app works exactly as before.

**Service worker.** `vite-plugin-pwa` precaches only same-origin build assets
and `runtimeCaching` is empty, so Dexie Cloud requests are never cached or
intercepted. Offline use is unaffected.

### 1.13.1 Status / theme: what is per-device vs synced

Three separate concerns, previously conflated, which caused lost selections and
cross-device theme leakage.

| Preference | Where it lives | Synced? |
| --- | --- | --- |
| Light/dark | `localStorage` (`pd.colorScheme`) | **No** — per device |
| Current status + theme override | `localStorage` cache + Dexie `uiState` | **Yes** |
| Status → theme mapping | Dexie `themeStatusMap` | **Yes** |

**Light/dark is per-device only.** It lives in `localStorage` and is never
written to Dexie, so one device's brightness choice never overrides another's.
A `window` `storage` listener in the store propagates it to other tabs of the
same browser (the event only fires in *other* tabs, which is the desired
direction).

**Current status and theme override follow the user across devices** via the
single `uiState` row (key `'current'`, schema v8):

- **Write policy.** The row is written **only** by an explicit user action —
  `setStatus`, `setThemeOverride`, or `clearThemeOverride` ("Back to status
  theme"). It is **never** written at startup and **never** seeded, so a fresh
  device cannot push its fallback over the account's real value. A missing row
  falls back to `'Studying'` and its mapped theme.
- **Read policy.** `useUiState()` (`src/hooks/useUiState.ts`) is a
  `useLiveQuery` on `db.uiState.get('current')`, so a change arriving from sync
  (or another tab) updates the store and applies the theme immediately, with no
  reload.
- **No write loops.** Incoming values are applied via `applyRemoteUiState()`,
  which updates the store and the localStorage cache but **does not** call the
  persistence helper. Applying a remote value therefore can never echo it back.
  The hook also de-dupes by `status|override` signature so the effect is
  idempotent without blocking genuine remote changes.
- **No flash.** `localStorage` is read **synchronously at module load** and
  `applyToDocument()` runs before React mounts, so first paint uses the cached
  value. The synced row wins once it arrives. (A brief mismatch is possible
  when the cache and the row disagree; the row is authoritative.)

**Synced — Dexie `themeStatusMap`.** The status → theme mapping, read through
`useThemeStatusMap()` (`src/hooks/useThemeStatusMap.ts`), a `useLiveQuery` on
`db.themeStatusMap`. A change made in Settings, or arriving from another
device's sync, updates the store and re-applies the theme with no reload.

Store rules (`src/stores/useStatusThemeStore.ts`):

- `setStatus` persists the status, **clears any override**, writes the `uiState`
  row, and applies the newly mapped theme.
- `setThemeOverride` applies a theme without changing the status, writes the
  `uiState` row, and persists until the user next picks a status.
- `clearThemeOverride` re-applies the active status's mapped theme and writes a
  cleared `uiState` row — this is what "Back to status theme" calls.
- `toggleColorScheme` is per-device only; it writes localStorage and never
  touches Dexie.
- `applyRemoteUiState` applies an incoming synced status/override without
  writing back (see above).
- `setMappings` **rebuilds from `defaultThemeStatusMappings` on every call**
  rather than merging into the previous store value, so a mapping deleted by
  "Reset to default" reverts immediately instead of lingering until a reload.
  It **ignores a row's `colorScheme`** (legacy, so a synced row cannot flip
  another device's light/dark), skips unknown values, and re-applies the active
  status's theme **unless an override is active**.
- Existing `colorScheme` values on stored rows are neither migrated nor
  rewritten, and no `Version.upgrade()` is used on synced tables.

**Manual verification** (no automation is available for this):

1. Sign in on two profiles, open the app in both.
2. Pick a status in profile A → it appears in profile B within ~20 s.
3. Set an override in A → it appears in B; "Back to status theme" in A clears
   it in both.
4. Toggle light/dark in A → B is unchanged.
5. Open a **fresh** device profile signed into the same account → it must show
   the account's status/override and must not overwrite the row on first load.

### 1.13.2 Not-signed-in banner (Dashboard only)

A warning at the top of the **Dashboard** page, above the "Welcome back"
heading, whenever the user is known to be signed out:

> Not signed in. Your data is only saved on this device and is not backed up.
> Clearing browser data or losing this device will erase it.

with a **Sign in** button and a **Not now** button.

**Reuses the existing account state.** It renders the same
`useCloudAccount()` hook that Settings → Sync and the profile menu use, and the
same real check, `state.signedIn` (the addon's `isLoggedIn`). It never treats a
truthy `currentUser` object as signed in, because that object also exists for
the anonymous realm.

**No flash for signed-in users.** The hook does not expose an "initialized"
flag, and the hook is deliberately **not modified**. The component derives one
locally from the addon's `currentUser` observable instead:

- A lazy `useState` initializer reads `cloud.currentUser?.value` **during the
  first render**, so a user who is already signed in never sees a frame of the
  banner.
- A `useEffect` then subscribes to that observable, flipping `initialized` to
  `true` on its first emission.
- If no cloud is configured at all, the state settles immediately as signed out.

**Dismissal.** "Not now" sets in-memory React state only. It is deliberately
**not** written to the synced database, nor to `localStorage`/`sessionStorage`
(which would outlive the load), so the banner returns on the next app load.

**Hides on sign-in without a reload.** `shouldShowBanner()` checks `signedIn`
*before* `dismissed`, so signing in hides the banner regardless of the dismiss
state.

**Styling.** The theme has no dedicated warning token, so the banner uses the
tokens already defined in `tailwind.config.js` — `bg-accent-subtle` (defined
per theme, light and dark), `border-border` and `text-content-primary` — plus
the `text-amber-500` icon colour already used for the `warn` tone in
`SyncAccountPanel`. That keeps it readable in all four themes in both modes.
Full width on desktop; buttons sit beside the text at `sm` and above, and stack
below it under 768px. Both keep the 44px touch target used elsewhere, and
`role="status"` is set for assistive technology.

**Verification** — `scripts/verify-app-invariants.mjs` (also run by
`npm run verify`) renders the real component through `react-dom/server` against
a **mocked account hook**, a **mocked `currentUser` observable** and mocked
icons. It covers: hidden while loading, shown when signed out, hidden when
signed in, the anonymous-`currentUser` trap in both directions, "Not now"
hiding it and returning on a fresh load with nothing persisted, the required
markup/role/responsive classes, and that only `DashboardPage` mounts it.


**Settings → Sync** offers sign in, the signed-in email, live status
(synced / syncing / offline / error) and sign out. Signing out erases the local
database, so it requires an explicit acknowledgement checkbox, offers an
"Export backup first" button, and is blocked entirely while sync is
incomplete (offline, syncing or error) to avoid losing unpushed changes.

> **Login state must be read from `db.cloud.currentUser.value.isLoggedIn`,**
> never from `db.cloud.currentUserId`. `currentUserId` is a non-empty string
> even for the anonymous/private realm, so testing it for truthiness reports a
> never-signed-in user as signed in and "synced" (the local database is trivially
> in sync with itself). The panel also carries a Diagnostics disclosure showing
> logged-in yes/no, the user id, the cloud host and `window.location.origin`.
> `tryUseServiceWorker: false` is set because this app ships its own
> vite-plugin-pwa service worker; the addon's SW transport needs a
> Dexie-Cloud-specific worker.

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

> **Thinking blocks.** `extractThinking()` (pure, in `src/features/ai/thinking.ts`)
> splits each assistant reply into its reasoning and its answer: tagged blocks
> (`<think>`, `<thinking>`, `<reasoning>`, tolerant of case/attributes and of an
> unclosed streaming tag) plus the provider-native `reasoning_content` /
> `reasoning` field, which `aiClient` reads into `ChatMessage.reasoning` and
> `appendMessage` persists on the row (never replayed to the model). The stored
> content stays verbatim; `toViewMessages` projects the answer into `text` and
> the reasoning into `thought`. `AssistantChat` renders a `ThoughtBlock` above
> the answer only when `thought` exists — collapsed by default, showing
> "💭 Thought process" with a chevron and a one-line preview. Standard models
> produce neither source, so `thought` stays `undefined` and their messages
> render exactly as before.
>
> **Gemini does not use tags — it flags parts.** The default model
> (`gemini-3.1-flash-lite`) returns reasoning as content parts marked
> `"thought": true`, with the real answer in the unflagged parts. Those parts
> must be **split, not concatenated**: joining them left the reasoning inline in
> the visible reply as untagged prose, so `extractThinking` found no tags,
> `thought` was null, and the block never rendered — the reasoning was silently
> shown as part of the answer. `readContent()` now returns `{ body, reasoning }`
> and drops thought parts from the body; a `thoughts` sibling array and the
> `reasoning_content` field are also read, and all three sources are **combined**
> rather than treated as alternatives, since a provider can legitimately send
> more than one.
>
> **`max_tokens` must cover reasoning too.** Thinking tokens come out of the same
> budget as the answer, so the old 900-token cap could be spent entirely on
> reasoning and return an empty reply. It is now 4096.

**Image panes and strict feature parity.** `image` is a first-class `PaneKind`
(alongside `pdf`), with its own `imageId` and its own controls registry, so a
pane is never handed another view's toolbar. The document dropdown lists images
in their own `<optgroup>` and filters them with the viewer's OWN
`previewKindFor()` — sharing the detector is what stops the picker offering
something the viewer then refuses to render.

**The parity rule: one component, two hosts.** `ResourceViewer` is already the
single host for both the Library modal and a split pane (the `embedded` prop
selects the chrome), so parity is achieved by extending that shared component
rather than building a parallel one. `ImageViewer` follows the exact contract
`PdfViewer` already used:

| Host | Behaviour |
| --- | --- |
| Library modal (`embedded=false`) | Viewer draws its own control bar |
| Split pane (`embedded=true`) | Viewer **publishes** the row to `PaneHeader` |

The row is a single `useMemo` value published through `onRegisterControls`, so a
pane never grows a second toolbar, and the parent cannot be forced into a
register/render loop. Host callbacks are read through refs so they never
invalidate the memo. `ImageViewer` offers zoom out / level % / zoom in / **Fit** /
**1:1** / **Rotate** / **Download**, and sizes the image from one proportional
box (`{ w: base.h, h: base.w }` when rotated) with `object-contain` as a
belt-and-braces guard — never `width: 100%`.

**Zoom keeps the point you are looking at.** Changing the scale re-lays-out the
stack at a new size, and the browser leaves `scrollTop`/`scrollLeft` at the old
pixel offset — so without help the view slides toward the top-left and the text
under the cursor is no longer under the cursor. Every zoom therefore goes
through one `applyZoom()`-style entry point that:

1. captures the focal point in content coordinates **before** the scale
   changes (`scrollLeft + clientWidth / 2`, `scrollTop + clientHeight / 2`);
2. records `ratio = clampedTarget / previousZoom` — from the **clamped** value,
   so a gesture that runs into a zoom limit does not try to restore an offset
   for a scale that never happened;
3. reapplies it in a `useLayoutEffect`, before the browser paints the
   intermediate position.

Two details make it actually hold:

- **The anchor survives a clamped write.** pdf.js reports page sizes
  asynchronously, so an early pass can be clamped by a scroll area that has not
  grown yet. The anchor is cleared only once the write actually took; otherwise
  it stays armed and the next layout pass re-applies it. This terminates,
  because the effect only runs when the geometry changes.
- **The page-sync effect defers.** Otherwise it would snap the view to the page
  top and immediately undo the anchor, and the two effects would fight over the
  scroll position on every zoom frame.

**A centred image needs a different anchor than a page stack.** The image is
centred in its scroll surface, so the naive `scroll = centre * ratio - half` is
only correct once the image is wider than the viewport — the centring offset
scales too, and scaling a content coordinate alone ignores that.
`ImageViewer` therefore stores the point in **image-local** pixels and re-derives
the offset from the new size each time. A numeric check confirms it: with an
off-centre cursor at x=300 the correct anchor holds x=300, while the naive
formula lands on 400.

**Pinch-to-zoom on images.** A trackpad pinch arrives as a `wheel` event with
`ctrlKey` set; it is intercepted with a `{ passive: false }` listener (without
which `preventDefault` is ignored and the browser page still zooms behind the
viewer) and mapped onto the image's own scale as
`zoom - deltaY * 0.01`. A wheel **without** `ctrlKey` is left completely alone,
so the image can still be panned. Two-finger touch pinch is tracked natively —
React's synthetic touch events do not expose the distance between fingers — and
is always measured against the **original** gesture start, so repeated moves
cannot compound and run away to the clamp. Zoom is bounded to **0.5×–5×**.

**Scroll health: never cancel what you do not own.** A viewer that "locks" or
freezes is almost always a handler cancelling events it should have let through.
Both viewers follow one rule:

- **Wheel.** Only a modifier gesture is claimed — `!e.ctrlKey && !e.metaKey`
  returns immediately, **before** any `preventDefault()`. A pinch sets
  `ctrlKey`; macOS Cmd+wheel (and some trackpads) set `metaKey`; both are
  handled. Every other wheel falls through to the browser, so normal
  vertical/horizontal scrolling stays 100% native. The listener stays
  `{ passive: false }` — that is what makes `preventDefault` legal at all.
- **Touch.** `e.touches.length !== 2` returns before `preventDefault()`, so a
  one-finger pan is never cancelled. `touchstart` is registered `passive: true`
  because nothing is cancelled there. No `touch-action: none` is set anywhere;
  that would kill one-finger panning outright.
- **Instant programmatic scrolls.** The focal-point correction assigns
  `scrollLeft`/`scrollTop` directly. It brackets the write with
  `scrollBehavior = 'auto'` (restoring the previous inline value afterwards),
  so a `scroll-behavior: smooth` — ours, inherited, or added by a theme later —
  cannot animate the assignment and fight the next zoom frame. That is the
  snap-back.
- **No CSS snap or scroll anchoring.** Both scroll surfaces carry
  `[scroll-snap-type:none]` and `[overflow-anchor:none]`. Browser scroll
  anchoring adjusts `scrollTop` on its own whenever content above the viewport
  changes size — precisely what a zoom does — and it fights the correction.

**Gestures run on the compositor, not in React.** A `wheel`/`touchmove` handler
that calls `setZoom` re-renders the whole page stack and re-issues a pdf.js
render task for every visible page, on *every event*. That is the single
biggest source of pinch hitch. So a gesture is split in two:

- **During** the gesture, `applyLive()` writes ONE inline `transform` /
  `transformOrigin` on the content wrapper. That is a compositor-only change:
  no state, no layout, no reflow, no re-render, so the gesture holds 60fps. The
  wrapper carries `will-change: transform` to keep it on its own layer. The
  `transformOrigin` is expressed in content coordinates — the same expression
  the commit path reconstructs — which is what makes the hand-off seamless.
- **After** it settles, `commitLive()` clears the transform and folds the scale
  into real `zoom` state at the same focal point, so the anchor effect restores
  the identical view. Wheel gestures commit on a **150ms debounce** (a trackpad
  pinch is a burst of events — committing per event would reintroduce the very
  hitch the transform removes); touch gestures commit on `touchend`.

Buttons and the keyboard skip the transform entirely and go straight to the
anchoring setter — a single discrete change has nothing to debounce.

**Unlocked flex ancestors.** A flex item defaults to `min-height: auto` /
`min-width: auto`, so it refuses to shrink below its content. Without explicit
`min-h-0 min-w-0` on the ancestors, a growing child (a zoomed page, a large
image) pushes the box outward instead of scrolling inside it, and the scrollbar
appears frozen or locked. Every flex ancestor of a scroll area in
`PaneContainer`, `PaneContent`, `ResourceViewer`, `PdfViewer` and `ImageViewer`
now carries `min-h-0 min-w-0 h-full w-full`.

**A zoom write is not a user scroll.** Assigning `scrollLeft`/`scrollTop` fires a
real `scroll` event. Left unguarded that event is indistinguishable from a drag,
so the viewer recomputes the page in view and calls `setPage` — a re-render and
a page-indicator flicker in the middle of a zoom. Two refs keep them apart:

- `isZoomingRef` is raised immediately before the write and released in a
  `requestAnimationFrame` — after the browser has had the chance to dispatch the
  event. A microtask would be too early.
- `zoomWriteRef` records the position the write asked for. A scroll event that
  matches it is our own late echo and is dropped.

Anything else is the user, and then any **still-armed anchor is discarded**. This
matters because an anchor survives a clamped first write while it waits for
pdf.js to report the new page sizes; re-applying it over a user drag is exactly
the "snapping" this guards against. The user always wins.

**The focal math only runs on a real scale change, and only after reflow.**
`applyZoom` never writes a scroll position — it clamps the target, arms a ref,
and calls `setZoom`. The write happens in a `useLayoutEffect`, so
`scrollWidth`/`scrollHeight` already reflect the resized content. The anchor is
armed only when `clamped !== prev`, so an unchanged scale does no scroll work at
all, and a plain drag/wheel/swipe never triggers the focal math.

Note the restore is `focal * ratio - half`, not the centre-only
`(scroll + client/2) * ratio - client/2`. The general form is a superset: the
centre formula is exactly the case where the focal point *is* the centre, which
is what buttons and the keyboard use. Gestures pass a cursor or finger midpoint
and get a better result than centring would give.

**Never write a scroll position against a stale extent.** The page stack is
re-laid-out *asynchronously* — pdf.js reports each page's size a frame or more
after the zoom — so on the first layout pass `scrollWidth` still describes the
OLD scale. Writing `scrollLeft` then is silently clamped by the browser to
whatever the stale extent allows, and the next pass moves the view again. That
clamp-then-correct pair is the landing jump. So:

1. `applyZoom` captures the focal point as a **fraction of the current
   scrollable extent** (`(scrollLeft + focal) / scrollWidth`), plus the extent
   the new layout is *expected* to reach. A fraction stays valid across the
   resize; an absolute pixel target does not.
2. A **readiness gate** refuses to write until the *measured* extent has
   actually reached the new scale. The gate compares in both directions —
   growing for zoom-in, shrinking for zoom-out, since the extent can never
   exceed the old one when zooming out.
3. Only then is the target computed **from the measured extent**, so rounding
   and any `minWidth` clamp are absorbed instead of baked into the anchor.

**Scroll anchoring is disabled with priority.** Both surfaces carry
`[scroll-snap-type:none]` and `![overflow-anchor:none]` — the `!` **prefix**,
which is Tailwind v3's important modifier (the v4 suffix form `[…]!` compiles
here but emits no `!important`, so it would lose to any competing rule).
Browser scroll anchoring adjusts `scrollTop` on its own whenever content above
the viewport changes size, which is exactly what a zoom does.

**Canvas resolution follows the real device pixel ratio.** The render scale uses
the display's actual `devicePixelRatio` (previously capped at 2, which left text
soft on 3x screens), so glyphs are rasterised at native density instead of being
upscaled by the browser. It is bounded by a **pixel budget**
(`MAX_CANVAS_PIXELS`, ~16 MP): uncapped, an A4 page at 4x zoom on a 3x display is
~76 MP — roughly 300 MB for one canvas — which would take the tab down. The
budget trims only what cannot be afforded; a normal page at a normal zoom uses
the full device ratio untouched.

**Header overflow.** `PaneHeader` scrolls horizontally with the scrollbar hidden
in both the WebKit and standard-property forms, `overscroll-x-contain` stops a
flick chaining out to the page behind, and every group is
`flex-shrink-0 whitespace-nowrap` over a `min-w-max` row — so a squeezed split
half or a phone can swipe to reach controls that would otherwise wrap or clip.

## 1.14 Two-pane split view

`src/features/split/` hosts a two-pane layout where **either** pane can show the
Dashboard, a PDF preview, topic notes, the assistant chat, or be **empty**.

**The split is an app-level overlay, not a view owned by a tab.** `App.tsx`
renders it through `AppLayout`'s `overlay` slot, layered above whichever tab is
active (Dashboard, Library, Calendar, Shifts, Focus, Settings) and below the top
bar. Opening or closing it never touches `activeTab`, so closing returns to
exactly the tab that was showing.

**The top-bar icon is the usual generic entry point.** A `Columns2` button sits
next to the profile avatar, visible on every tab and at every width including
mobile, with `aria-pressed` reflecting the state. It opens an **empty split** —
two panes, each a dashed border with *"Choose what to show in this pane:
Dashboard, a PDF, Notes, or Assistant."* plus its own picker — and toggles
closed when clicked again. It is the only entry point a USER can reach by
accident from any tab. The same generic transitions are also driven by two
deliberate non-UI paths: the assistant's `manage_split_screen` tool, which
queues a command that `App` applies through `addSecondPane` / `setPane` /
`swapPanes` (see "AI-driven split commands" below), and the Library's
per-resource **"Split with notes"** *contextual* shortcut: it
opens the split with that PDF and its topic notes immediately, from whatever tab
the button is on, without navigating to the Dashboard.

| File | Role |
| --- | --- |
| `splitModel.ts` | Pure reducer: pane slots, swap, close, maximize, ratio clamp, active-pane focus |
| `SplitView.tsx` | Container, draggable divider, owns the shared PDF-controls registry |
| `PaneHeader.tsx` | The universal pane header + wrapper, rendered for every pane kind |
| `PaneContent.tsx` | Dispatches a slot to its renderer |
| `NotesPane.tsx` | The Library notes editor in a narrow layout |
| `useResourceFullScreen.tsx` | Shared hook + `ResourceFullScreen` for non-PDF full screen |
| `FullScreenPreview.tsx` | Full-screen overlay for one non-PDF resource |
| `useSplitCommandStore.ts` | zustand bridge (in `src/stores/`): queues `manage_split_screen` commands for `App` to apply |

**One header per pane, and one controls registry.** `usePdfControls()` is a
hook, so it owns state and must be called **exactly once, at the top of
`SplitView`**, which then passes `registerPdfControls` / `pdfControlsFor` down to
the split body. The single-pane and split bodies are mutually exclusive but are
separate components; calling the hook inside each would silently give them two
independent registries. The mounted `PdfViewer` publishes its toolbar upward via
`onRegisterControls`, and `PaneHeader` renders it — so a PDF pane has exactly one
control row whether the header is the pane's own or the viewer's (Library modal).

`onCloseSplit` deliberately does **not** reach `PaneHeader`: the close-split
button lives on the **divider**, between the panes, where it can never overlap
pane content. The header's own X is "back to the dashboard" (`setPane` back to
`initialSplitState`), a different action.

**All pane chrome is theme-token driven — never Tailwind's fixed `slate-*`
palette.** The header bar, its dropdowns, the icon buttons, the divider pill and
the injected PDF toolbar all use `bg-bg-surface` / `bg-bg-elevated`,
`border-border` / `border-border-strong` and `text-content-*`. A hardcoded
`bg-slate-900` bar stayed dark in **Light Mode** and clashed with every status
theme, so the tokens are what let the chrome follow `data-theme` (and the
light/dark override) with no contrast breaks. Both hosts of the PDF controls
share one token-driven `ctrl` class, so the pane header and the Library modal
cannot drift.

**The header scrolls sideways when a pane is narrow.** The bar is
`overflow-x-auto` with `overscroll-x-contain` and a hidden scrollbar in both the
WebKit (`[&::-webkit-scrollbar]:hidden`) and standard (`[scrollbar-width:none]`)
forms; the inner row is `min-w-max` and every group is `flex-shrink-0
whitespace-nowrap`, so a squeezed pane (a split half, or a phone) can be swiped
to reach controls that would otherwise wrap or clip. This is what lets a PDF
pane keep the whole control set — page nav, zoom, Fit, rotate, download and
full screen — on one 44px row at any width.

**Nothing is persisted.** The split, the ratio, which pane holds what and any
maximized pane are React state only — `splitModel.ts` references no storage or
Dexie at all — so a refresh always returns to a single full-width dashboard.

> **Active-pane focus.** `SplitState.activePane` (null until touched) records
> which pane the user is working in. The glow is a **child overlay** with
> **inset** shadows, not a ring on the pane box: a ring or outer `box-shadow`
> paints outside the element's border box, and the split pane wrapper is
> `overflow-hidden` — so it was drawn and then clipped away, which is why the
> glow was invisible. The overlay is `absolute inset-0`, rendered after the
> content (so the pane's own background cannot cover it) and
> `pointer-events-none`, with `inset 0 0 0 2px` plus a soft inner bloom in the
> full-strength `--accent-primary` (`--accent-subtle` is 0.15 alpha and far too
> faint). Claiming a pane uses `onPointerDownCapture` / `onFocusCapture` so a
> child that stops propagation cannot swallow it — though an `<iframe>` still
> cannot be crossed, so the Drive preview must be claimed from the chrome around
> it. `setActivePane` is no-op-safe, so focus chatter causes no re-render churn.
> The glow also shows in single-pane mode, where it marks "focus is here" rather
> than distinguishing two panes.

**AI-driven split commands.** The assistant's `manage_split_screen` tool
(`action` open/close/swap, optional `pane` left/right, `viewType` one of
pdf/notes/dashboard/assistant, optional `resourceId`) never touches layout
itself: `manageSplitScreen()` in `tools.ts` validates the args (a real resource
only — never a guessed id; a PDF needs a resource that actually has a stored
blob; notes need a topic) and then only **queues** a command in
`useSplitCommandStore`. A tool cannot reach React state, and moving the split
into a store would have broken the "React state only, never persisted" rule
above, so `App` subscribes to the queue and applies each command through the
same `splitModel` functions the UI uses — AI-driven and user-driven splits are
literally the same reducer. `settle(id)` clears by id, so a command queued while
the previous one is being applied is never swallowed, and `App` also publishes a
`SplitSnapshot` so a future tool can report what is on screen rather than what
it merely asked for.

The tool is **not** confirmation-gated: it is layout, not data, and is undone by
picking something else. While it runs, `useAssistantStore.activeTool` shows a
transient ⚡ pill in place of "Working…" — the label comes from
`describeToolCall()`, which delegates to `describeSplitCommand()` for split calls
("Opening the PDF in the left pane…"), and it is cleared in a `finally` so a
throwing tool can never leave it stuck.

Side by side on desktop, **stacked under 768px** (`matchMedia`), with a
`role="separator"` divider that is draggable by pointer and arrow-key operable.
The ratio is clamped to 0.2–0.8. Each pane header carries a content picker
(Dashboard / PDF / Notes / Assistant) plus **one** document dropdown — a single
control on every pane kind, with `<optgroup>`s for PDFs and for Notes, rather
than two sub-pickers that only appeared for those two kinds — plus the swap,
close, maximize and open-split controls. Close collapses to a single full-width
pane holding the other pane's content.

A PDF's half-screen mode is just a starting state: `splitWithNotes(resourceId,
topicId)` opens the split with that PDF in one pane and **its own topic notes**
in the other, both still changeable through their own pickers. Reached from the
Library resource row's "Split with notes".

> **Page scrolling.** The page surface is a real scroll container holding a spacer
> as tall as every page, with the current page's canvas offset to its own band, so
> the **mouse wheel and touch drags (with momentum) scroll continuously** between
> pages like a normal PDF viewer. Scrolling derives the page in view and feeds it
> into the same `goToPage()` path, so the render-cancellation fix, zoom and
> rotation all still apply, and the page indicator always shows the page in view.
> A `scrollDrivenRef` distinguishes a scroll-originated page change (left alone,
> so the view does not snap back) from a nav-button or page-input change (which
> snaps to the page top). The band height is recomputed on zoom, rotation and
> document change. `overscroll-contain` keeps a flick from scrolling the app
> behind. Next/previous, the page-number input and the arrow keys all remain.
>
> **A page is never stretched.** The canvas box is derived from ONE measurement:
> the layout stores `pageSizes: { w, h }` per page — never a lone height — and
> the JSX applies `width` and `height` together. Three separate defects used to
> combine into visible distortion:
> 1. The canvas took its height from the layout but its width from an imperative
>    write, so a page whose height was still the A4 *estimate* while its width
>    was already real rendered at a different scale. Two sources, two answers.
> 2. `canvas.style.maxWidth = '100%'` squeezed the width while the height stayed
>    fixed — a guaranteed non-uniform scale — and silently shrank a zoomed page
>    back to fit so the overflow could never be scrolled to.
> 3. `overflow-x-hidden` on the scroll surface then clipped whatever overflowed,
>    hiding the outer columns entirely.
>
> Now the width and height are committed together, `max-width` is gone, the
> surface is `overflow-x-auto`, and the spacer carries
> `minWidth: contentWidth` so a page zoomed past Fit is fully reachable with
> native scrollbars. The backing store (`canvas.width`/`height`, from
> `viewport.width`/`height` at `scale: cssScale * dpr`) is still recomputed on
> every render, so text stays crisp rather than upscaled.

**Three deliberately separate zoom levels.** Pane maximize hides the other pane
with `display:none` but keeps it **mounted**, so it retains its page/zoom/
rotation and restores instantly. **A PDF's full screen reuses the very same
mounted `PdfViewer`** — the viewer calls `requestFullscreen()` on its own wrapper
element, so exactly one viewer instance is ever in the DOM and the same page, zoom
and rotation carry into (and back out of) full screen. There is no second
`PdfViewer` and nothing to unmount; the split underneath is never disturbed, so
exiting returns to exactly the layout that was active. `FullScreenPreview` is for
**non-PDF** resources only (images), reached through the shared
`useResourceFullScreen()` hook that both the Library preview and the split view
use. Each pane mounts its own `PdfViewer`, so the same file can be open in both
panes at once with completely independent state. The assistant pane mounts the
shared `AssistantChat` (same history, same tools); the notes pane mounts the
shared `MarkdownNotes` and writes through the same `updateTopicNotes()`.

### 1.3.3 The drill-down file picker (v14)

**Why it exists.** A flat list of file names stops working the moment files are
called `1-introduction.pdf`. With subjects, nested groups and several lecture
series, that name repeats, and a `<select>` of titles cannot say which one is
which. So the picker drills: **subject, then groups at any depth, then files**,
and every row shows its full path.

**Two files, one concern each.** `filePickerData.ts` owns every rule and never
touches React; `FilePicker.tsx` renders and queries no table. That split is what
makes the rules testable without a DOM, and it is asserted directly
(`verify-file-picker` fails if the component ever calls `db.`).

- `getChildren(node, want, currentId)` — one level of children. `node` is `null`
  for the root, which is the subject list. A subject shows its top-level groups
  **and** its ungrouped files together, so a subject with no folders goes
  straight to its files. A group shows its subgroups and the resources directly
  inside it. An empty list is a real answer, not a failure.
- `searchAll(query, want)` — every subject, group and file at once, each hit
  carrying its full path.
- `pathToResource(id)` — the breadcrumb from the subject down to a file,
  **including the file's own group**, so the picker opens where the user is.
- `lastLocation(slotKey)` / `rememberLocation(slotKey, path)` — where each pane
  was left. Keyed per pane, not global.
- `labelForResource(id)` — the title **and** path, for the header button.
- `getRecentNodes()` / `noteOpened()` — the last five files, newest first,
  storing the resource so a row is tappable rather than a dead label.

Decisions worth stating:

- **Navigation is one array, the path from the root.** Not a variable per level.
  Any depth therefore works with the same code, and Back is "drop the last
  element". Adding a sixth level would need no new state.
- **The tree rules are NOT re-implemented here.** Parents, depths and paths come
  from the shared `groupTree` module (`getChildGroups`, `getAncestors`,
  `getDescendants`, `pathOf`, `parentOf`), the same one the Library tree and the
  AI tools read. The picker cannot drift from either of them.
- **Natural sort everywhere, but a saved `order` wins when one exists.** A group
  the user reordered appears in its new place rather than snapping back to
  alphabetical.
- **A file whose bytes are not on this device is shown, dimmed, with the literal
  reason "File not available on this device."** File blobs are not synced (see
  1.13), so such a row is real. Hiding it would make files silently disappear
  depending on which device you are on; showing it plainly explains itself. The
  blob check runs *before* the type check, because a synced row has no MIME to
  judge and would otherwise be mislabelled "Not a PDF".
- **Per-viewer filtering** via `want`: `'pdf'` lists PDFs, `'image'` lists
  images. Two different rules, on purpose: a file of the **wrong type** is
  dropped entirely (the PDF viewer listing every PNG would bury the PDFs in rows
  that cannot open), while a file of the **right type with no bytes** is listed
  dimmed. Search applies the stricter rule, so a search never returns a row that
  cannot open.
- **Rendered in a portal** on the shared `Z` scale, so no scrolling pane or card
  can clip it. Bottom sheet on a phone, centred dialog on a desktop. Rows are
  44px; arrows, Enter, Backspace and Escape work. Backspace is "go back" only
  when the search box is empty, so it can still delete a character.
- **Where it opens**, in order: the currently open file's own folder, then the
  last place that pane was left, then the root.

**Notes live in the same tree, under their subject.** `'note'` is a node kind
alongside `subject`, `group` and `resource`. `getChildren(subject)` returns the
subject's child groups, its ungrouped resources AND its notes together.

- **A note is never inside a group.** A group holds resources only, so a note
  always sits directly under its subject. This is a data fact, not a display
  convenience, and the tests assert a group never lists a note.
- **A note belongs to a subject, and optionally to a topic.** Topics do not nest,
  so a note has no parent topic; when one was created "inside a topic" it is
  still listed under the subject, which is the folder a person browses by. Its
  path is therefore the subject name, and `pathOfNote()` is what computes it.
- **Two notes with the same title are told apart by their subject.** That is the
  same failure the picker already solved for duplicate file names.
- Notes get their own **note icon**, never the file glyph, so a note and a
  document of the same name are never confused.

**Row order within a level is: folders, then notes, then files.** Chosen and
fixed: a folder is something you go INTO, so it comes first; a note is material
belonging to the subject itself, while a file is an attachment, so the note sits
between them. Within a kind, natural sort (`Week 2` before `Week 10`), except
groups, where a saved `order` wins when one exists. Search uses the same
hierarchy: files, then notes, then groups, then subjects.

**`kinds` says what the caller can OPEN; `want` narrows the files.** They answer
different questions and both are needed:

| Selector | `kinds` | `want` | Result |
| --- | --- | --- | --- |
| PDF viewer | `['resource']` | `'pdf'` | PDFs only, never a note |
| Image viewer | `['resource']` | `'image'` | Images only, never a note |
| Split pane open menu | `['resource', 'note']` | viewer-dependent | Files AND notes |

`DEFAULT_KINDS` is `['resource']`, so a caller that forgets the prop behaves the
way it did before notes existed: a viewer is never handed a note it cannot open.
The prop also filters the **Recent** list, so a PDF viewer does not list a note
merely because the user opened one in the other pane.

**Search covers note TITLES only, never note content.** A search that reached into
a note's body would return a note whose title says nothing about the word that
matched, and the row would be indistinguishable from a file.

**"Start where I am" works for a note too.** `pathToTopic(id)` gives the one-
element path (the subject), so a notes pane opens on the open note's subject and
highlights it, exactly as a PDF pane opens on its folder. `labelForNote(id)`
gives the header the same `{ title, path }` shape a file gets, so the pane header
shows "Thermodynamics's Notes" over "Thermodynamics" and truncates on a narrow
split half like any other row.

**Wired into `PaneHeader`.** The document `<select>` is gone; the file button now
opens the picker and shows the current file's name **with its path**, truncated
so it survives a narrow split half. A chosen file switches the pane to the
matching view, using the same `previewKindFor` detector the picker filtered
with, so the pane cannot try to render something the picker withheld. Each pane
passes `slotKey={`pane-${index}`}`, so the two panes browse and remember
independently.

**The flat notes `<select>` is gone too.** The same button now offers notes as
well as files (`kinds={['resource', 'note']}`), and choosing a note goes through
the same `select()` the view dropdown uses, so it is the same state change as
choosing Notes there. It used to be a global dropdown of every note's title in
the app, which is exactly the flat-list problem this picker exists to fix.

**Selectors that can open a note, and what happened to each**

| Where | State |
| --- | --- |
| `PaneHeader` notes dropdown | **Swapped.** Removed; notes come from the picker. |
| `PaneHeader` document control | **Swapped** in Phase 3; now also offers notes. |
| PDF and image selectors | Unchanged. `kinds={['resource']}`, so they can never offer a note. |
| `SubjectDetail` (Library) | Left alone. Opens notes from its own per-subject topic grid, which is already scoped; a global picker there would be a different job. |
| AI `searchLibrary` | **Updated.** Notes now carry `path` (the subject name) in both the flat `topics` list and the bucketed view, so two same-titled notes are distinguishable to the model. |
| AI `manage_split_screen` | **Updated.** A notes pane can be opened from a note id or title directly, resolved through the shared `resolveItem` with `kind: 'note'`, returning candidates on ambiguity. Previously a note was only reachable by borrowing a resource's topic, so the note itself was not addressable. The original resource-derived path still works. |


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
│   │   │   ├── TopBar.tsx       # clock + light/dark toggle + ProfileMenu
│   │   │   ├── ProfileMenu.tsx  # avatar + account/status/theme menu
│   │   │   └── BottomNav.tsx    # mobile nav (< md)
│   │   └── ui/
│   │       ├── Card.tsx
│   │       └── Modal.tsx        # dialog (bottom sheet on mobile)
│   ├── db/
│   │   ├── db.ts                # Dexie instance, table definitions, db.cloud.configure()
│   │   ├── cloudConfig.ts       # Dexie Cloud URL, unsyncedTables, blobMode
│   │   ├── backup.ts            # export/import all tables as one JSON file
│   │   └── defaultData.ts       # aiProviders seed + code defaults (synced tables not seeded)
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
│   │   │       ├── SignInBanner.tsx     # not-signed-in warning (dashboard only)
│   │   │       ├── signInBannerState.ts # pure shouldShowBanner() decision
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
│   │   │       ├── ResourceViewer.tsx # Preview modal: image/pdf/drive/opaque dispatch
│   │   │       ├── PdfViewer.tsx     # shared pdf.js page renderer (code-split)
│   │   │       ├── ImageViewer.tsx   # shared image zoom/fit/rotate (modal AND pane)
│   │   │       ├── previewKind.ts     # pure preview-type + Drive URL detection
│   │   │       ├── TopicModal.tsx
│   │   │       ├── AssessmentModal.tsx
│   │   │       ├── MarkdownNotes.tsx   # read-only renderer + note title field
│   │   │       ├── NotesEditorBody.tsx # shared autosave wrapper (both note views)
│   │   │       ├── NoteToolbar.tsx     # LEGACY textarea toolbar — unused, kept for reference
│   │   │       ├── noteEditor/         # the live Tiptap editor
│   │   │       │   ├── NoteEditor.tsx        # editor + toolbar + shortcuts hint
│   │   │       │   ├── FontSize.ts          # custom size-preset extension
│   │   │       │   ├── mathNode.ts          # $math$ node (the KaTeX seam)
│   │   │       │   ├── mathRender.ts        # math -> HTML, isolated
│   │   │       │   ├── markdownToHtml.ts    # legacy markdown -> editor HTML
│   │   │       │   ├── sanitizeHtml.ts      # strict allowlist (in AND out)
│   │   │       │   └── noteFormatShared.ts  # palette shared with the legacy path
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
│   │   ├── split/                # two-pane split view + full-screen preview
│   │   │   ├── splitModel.ts     # pure pane reducer (swap/close/maximize/ratio/active pane)
│   │   │   ├── SplitView.tsx     # container, draggable divider, shared PDF-controls registry
│   │   │   ├── PaneHeader.tsx    # universal pane header + wrapper (every pane kind)
│   │   │   ├── PaneContent.tsx   # dispatches a pane to its renderer
│   │   │   ├── NotesPane.tsx     # topic notes in a narrow layout
│   │   │   ├── useResourceFullScreen.tsx # shared non-PDF full-screen hook + host
│   │   │   └── FullScreenPreview.tsx # one non-PDF resource, full screen
│   │   ├── ai/                  # global AI assistant (schema v6/v7)
│   │   │   ├── aiProviderRepo.ts # provider CRUD + getDefaultProvider()
│   │   │   ├── aiClient.ts      # OpenAI-compatible chat/completions + tool loop
│   │   │   ├── chatRepo.ts      # chat sessions/messages (Dexie, verbatim raw)
│   │   │   ├── toolRuntime.ts   # shared ToolError + argument validation
│   │   │   ├── tools.ts         # original tools + merged spec list/dispatch
│   │   │   ├── toolsExtended.ts # library/calendar/status functions
│   │   │   ├── types.ts         # ToolSpec / ChatMessage
│   │   │   ├── thinking.ts      # extractThinking(): tagged/native reasoning split
│   │   │   └── components/
│   │   │       ├── AssistantLauncher.tsx   # floating bottom-right button
│   │   │       ├── AssistantChat.tsx       # transcript + composer (shared)
│   │   │       ├── ThoughtBlock.tsx        # collapsible "Thought process" panel
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
│   │           ├── SyncAccountPanel.tsx      # shared account+sync UI (menu + settings)
│   │           ├── useCloudAccount.ts        # single source of truth for account state
│   │           └── DataBackupSection.tsx
│   ├── hooks/
│   │   └── useThemeStatusMap.ts    # live status->theme mapping (synced) + save/reset
│   │   └── useUiState.ts           # live synced status/override row (no write-back)
│   ├── stores/
│   │   ├── useStatusThemeStore.ts   # per-device status/override/scheme + mapping (Zustand)
│   │   ├── usePomodoroStore.ts      # active timer state (Zustand)
│   │   ├── useAssistantStore.ts     # chat transcript, tool loop, confirmation
│   │   ├── useSplitCommandStore.ts  # AI split commands + transient action pill
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

- **Nested groups + file picker (v14):** `resourceGroups.parentGroupId` makes
  groups a tree, five levels deep. All the rules live in one pure module,
  `library/groupTree.ts`, shared by the Library tree, the repository and the AI
  tools, so the three cannot disagree. `GroupTree.tsx` renders the indented
  Library tree; the group's "move" control offers only valid destinations, so an
  illegal move cannot be reached. Deleting a group keeps its subgroups and
  resources, moving them up one level. The AI gained `moveGroup`, path-aware
  resolution and paths on every result. `filePickerData.ts` +
  `FilePicker.tsx` provide the drill-down picker, not yet swapped into the
  selectors. Verified by `verify-nestedgroups` (91), `verify-nestedgroupsai`
  (61) and `verify-filepicker` (49).
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

- **Note titles (schema v9):** a "note" is a `topics` row — `notes` is the body
  and `title` is its label. The field always existed but was hard-coded to the
  placeholder `'General'` and never surfaced, so every note looked identical.
  v9 indexes `title` and backfills the placeholder from the note's own first
  line (markdown stripped, ~60 chars) or `'Untitled note'` when empty. The
  upgrade never touches `notes`. New notes default to `'Untitled note'`. An
  editable title now sits at the top of both note views (Library and split
  pane), and `searchLibrary` already matched and returned titles, so the
  assistant can now find notes by name. Rules live in `src/db/noteTitle.ts`
  (pure, no Dexie) and are pinned by `scripts/verify-note-titles.mjs`.

- **Note formatting (no schema change):** notes gained font size, text
  alignment and text color while remaining **markdown at rest**. The toolbar
  wraps the selection with a small inline-HTML subset; the renderer sanitizes
  it through a strict allowlist (`span`/`div`; only `color`, `font-size`,
  `text-align`, each value-validated) and a rejected tag is dropped with its
  text intact. The pipeline sanitizes **before** the markdown and math passes,
  which is what lets a formula render correctly inside a colored span, a sized
  span, an aligned block, or with a tag covering only part of it. `renderLatex()`
  is a single seam, so real KaTeX can replace it later without touching the
  toolbar or the sanitizer. Palette colors are theme-aware CSS variables
  (`--note-c-*`) so they stay readable in both light and dark. The toolbar is
  shared by the standalone Library editor and the split-pane notes view, and
  scrolls horizontally with 40px targets on mobile. The AI reply renderer was
  left alone. Verified by `scripts/verify-note-formatting.mjs` (128 checks),
  which also pins that an unformatted note renders byte-identically to before.

- **Resource groups (schema v10):** added the `resourceGroups` table and an
  optional indexed `groupId` on `resources` — named, folder-like lanes for
  resources within a subject. A group is a *sibling* of `Topic`, not its child:
  a grouped resource keeps its own `topicId`, so notes, split-with-notes and
  topic deletes are untouched and grouping across topics works. The Library
  gains a "New group" button, per-group rename/delete/collapse, and a
  "Move to group" menu on every resource row (with "No group" and
  "New group…"). Every control is tap-driven with 40px targets — no drag, no
  long-press, no hover-only affordance. Deleting a group ungroups its members
  and never deletes them; moving a resource to another subject clears its
  `groupId`; deleting a subject deletes its groups. `searchLibrary` now
  reports each hit's `group` and also matches on the group name. Verified by
  `scripts/verify-resource-groups.mjs` (63 checks).

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
  which does not exist on the build server. Every table syncs, `aiProviders`
  included, so a provider and its key are available on each signed-in device;
  `UNSYNCED_TABLES` is empty and `resources` blobs use `blobMode: 'lazy'` with a
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

### 1.14 Profile menu (top bar)

`src/components/layout/ProfileMenu.tsx` — an avatar button at the far right of
the top bar that opens Account / **Mood and theme**, plus a Settings link.

- **Avatar.** First letter of the account email when signed in, a generic
  person icon otherwise, with a small dot for sync state (green synced, pulsing
  syncing, amber offline, red error, neutral signed out). Since the top bar no
  longer names the status, the avatar's `aria-label` and `title` read e.g.
  "Profile, Studying — Synced", and its **ring is tinted with the active theme's
  swatch**.
- **Layout.** A dropdown anchored to the avatar on desktop; a full-width bottom
  sheet under 768px. Closes on outside click, on Escape (returning focus to the
  trigger), and after any option that navigates. Uses `menu` / `menuitem` /
  `menuitemradio` roles for keyboard and screen-reader support.
- **Shared account state.** Both the menu and Settings → Sync render
  `SyncAccountPanel`, which reads one `useCloudAccount()` hook
  (`src/features/settings/components/useCloudAccount.ts`). There is a single
  subscription to the Dexie Cloud observables and no duplicated account state
  or sign-out rules. Settings keeps the diagnostics disclosure; the menu does
  not.

**"Mood and theme" section** (replaces the old separate Status / Theme rows):

- The four statuses as radio rows, each showing a **swatch of the theme it is
  currently mapped to** (read from `mappings[status]`, not a hardcoded colour).
  Picking one calls `setStatus()`, which sets the status and applies its mapped
  theme — the same action the removed top-bar pill used.
- **"Override colors"**: a row of theme swatches that applies a theme
  immediately *without changing the status*, via
  `updateMapping(currentStatus, theme, colorScheme)`. It stays until the user
  next picks a status.
- When an override is active (`currentTheme !== mappings[currentStatus].theme`),
  a "Using custom theme" note appears with a **"Back to status theme"** button
  that re-applies the current status's mapped theme.
- The light/dark toggle and the "Change status to theme mapping" link remain in
  this section.

**Status can be changed in exactly two places:** the profile menu, and the
"Current status" selector at the top of the **Settings → Status to Theme
Mapping** card. Both call the same `setStatus()` store action, so they cannot
drift out of sync.

**Top bar.** The status pill/dropdown was removed entirely (all leftover state,
markup and `lucide-react` imports deleted). What remains is the clock, the
light/dark toggle, and the profile avatar at every width.

## 6. AI upgrade branch (`ai-upgrade`)

Four phases: resilience against provider errors, a Stop button, one way to
identify items, and calendar tools for the new calendar. All schema changes are
additive (v13). `main` was not touched or merged. Nothing was reverted.

### The single request point

`chatCompletion()` in `src/features/ai/aiClient.ts` is the ONLY place a provider
request is made, for every provider. One user message costs **1 request if the
model answers at once, up to 6 if it keeps calling tools**: the turn loop runs
`for (round = 0; round <= MAX_TOOL_ROUNDS)` with `MAX_TOOL_ROUNDS = 4`, plus one
final no-tools "wrap up" request when the budget runs out. All retry logic lives
in that one function, so no caller can get a turn that neither retries nor can be
stopped.

### Phase 1: retry, backoff, optional fallback model

Up to 4 retries for 429, 500, 502, 503, 504 and network failures, at roughly
1s, 2s, 4s, 8s plus up to 500ms of jitter, honouring `Retry-After` when present.
400, 401, 403 and 404 are shown immediately. A 429 whose text says the daily
quota is spent is NOT retried, because no wait can fix it.

The retry re-sends a **byte-identical request body**. The loop never touches the
transcript, the stored rows or any tool result, so a retry can never re-run a
create, rename or delete, and can never send the user message twice. A tool that
has already run is not repeated.

`friendlyError()` turns any failure into plain language ("The model is
overloaded right now. Try again in a minute or switch model in Settings") with
the raw error kept behind a Details toggle, plus a Retry button that re-sends
without duplicating the user message. The store clears `busy` in a `finally`, so
the input can never be left disabled.

An **optional** `aiProviders.fallbackModel` (v13, off by default) is tried once
after the primary exhausts its retries, and the chat says which model replied.

To reduce load, each tool result sent to the model is capped at 4000 characters
with a `[truncated]` marker, and history is limited to the last 20 messages. A
200-row search result drops from 24434 to 4083 characters.

### Phase 2: the Stop responding button

One `AbortController` per user turn. Stop aborts the in-flight fetch, rejects
the backoff wait so no further retry is issued, and is re-checked before each
round so no new tool call starts. A tool already running is left to finish,
because aborting a database write halfway is worse than finishing it.

A pending Confirm card is **cancelled** as if the user had pressed Cancel, and a
synthetic tool response is recorded so the next turn stays well-formed: an
unanswered `tool_call` makes Gemini reject the following request with HTTP 400.

The composer stays enabled while working, so the next message can be typed;
Enter does not send until the turn ends. Escape stops, scoped to the chat input.

### Phase 3: one resolver for every tool

There were **three** different lookup implementations: id-only `db.get()` in
`toolsExtended.ts`, `resolveByIdOrName` in `toolsLibrary.ts`, and a third
hand-rolled copy in the split-screen tool. All now route through one
`resolveItem({ kind, ref, rows, nameOf, label, kind, scope })`, with `kind`
mapping to exactly one table through `ITEM_KINDS`, so an id of one kind can never
resolve as another.

Order is exact id, then exact case-insensitive name, then a UNIQUE partial
match. Several matches return candidates with ids; no match returns a message
naming what was searched plus the closest names.

`searchLibrary` was also fixed to return what the model needs in order to chain
a call: the subject bucket had only a NAME and no `subjectId` at all, and
assessments carried no `id` whatsoever, so there was no way to act on one.

### Phase 4: calendar tools

New `toolsCalendar.ts` with 17 tools, all using the Phase 3 resolver and all
returning `{ kind, id, name }` of what they touched. Read: `getDayAgenda`,
`listEvents`, `getWeekTimetable`, `findFreeSlots`, `listPeriods`,
`listAssessments`, `getUpcoming`. Write: `createEvent`, `updateEvent`,
`moveEvent`, `setEventSubject`, `deleteEvent`, `createAssessment`,
`updateAssessment`, `deleteAssessment`, `createRecurringEvents`,
`deleteEventSeries`.

Period times always come from the shared `PERIODS` constant, never from the
model, so the form and the assistant cannot disagree. A period on a non-teaching
kind is rejected. A clash in a taken period is a WARNING, and the event is still
created. `createRecurringEvents` returns a preview and creates NOTHING until
`confirmPending` re-invokes it in its confirmed form, capped at 60 events, all
sharing one `seriesId` so the series can be deleted as a unit.

`WEEK_STARTS_ON` is now declared once in `categories.ts` and shared by the
calendar, the shifts page and the tools. `dateRules.ts` holds the ISO
validation and the date context injected into the system prompt on every
request, so the model can turn "tomorrow" into an exact date.

Two latent bugs were found and fixed by these tests: `saveEvent` and
`saveAssessment` normalize a whole row, so the update tools had to merge onto
the existing row; and `normalize()` builds an explicit field list, so `seriesId`
was being silently dropped on write.

### Verification

`npx tsc -b` clean, `npm run verify` exits 0, `npm run build` succeeds, and four
new suites pass: `verify:retry` (47), `verify:stop` (43), `verify:resolve` (56)
and `verify:calendartools` (95). The store-level Stop suite drives the REAL
store against a Dexie stub, so it covers the shipping turn loop rather than a
copy of it.

## 5. Calendar update branch (`calendar-update`)

A five-phase improvement pass on the assistant composer, the subject dialog,
the calendar, event-to-subject linking and assessments. Nothing was reverted.
All schema changes are **additive only**. `main` was not touched or merged.

### Phase 1 — Assistant composer: Shift+Enter

**Cause of the bug:** the composer was a single-line `<input>` element, and
its key handler sent on any Enter. An `<input>` cannot hold a newline at all,
so Shift+Enter had nowhere to insert one.

**Fix:** an auto-growing `<textarea>` that follows its content up to about six
lines and then scrolls, so a long message cannot swallow the conversation.
Enter sends; Shift+Enter inserts a newline. The `event.isComposing` check is
kept, so an IME composition (choosing a CJK character) is never mistaken for
Enter-to-send. On mobile, Enter inserts a newline and the Send button is the
way to send, because a soft keyboard gives no reliable signal for a deliberate
send; a keydown carrying `keyCode === 229` is treated as the soft keyboard, so
a hardware keyboard still sends. The input keeps focus after sending.

### Phase 2 — One z-index scale, and dialogs through portals

**Cause of the bug:** the subject edit dialog was rendered inside the subject
view's own stacking context, so the subject panel painted over it. The dialog
was reachable only by navigating away and back.

**Fix:** a single shared `components/ui/zIndex.ts` scale (`Z.backdrop`,
`Z.modal`, `Z.menu`, `Z.toast`, and so on), and dialogs render through
`createPortal` to `document.body`, which lifts them out of any local stacking
context or `overflow: hidden` container. This works identically in standalone
view and in a split pane, at every width, because none of those ancestors can
capture a node that is no longer their descendant. The other dialogs and menus
were checked and moved onto the same scale.

### Phase 3 — Full day view and query optimization

Replaced "first two events and +x more" as a dead end. Tapping a day now opens
a **day panel**: a right-hand side panel on desktop and a bottom sheet on
mobile (one component, so the two layouts cannot drift). It lists **all**
events of that day in time order with title, time, subject and kind, and
offers edit, delete and add without leaving the calendar. The "+x more" chip
is now a real button that opens that same panel.

The month grid shows up to 2 compact event chips in the subject's colour plus
a "+x" chip, all real `<button>`s so they work by tap and by keyboard, with no
hover-only affordances.

**Optimization:** live queries fetch only the visible range. `date` is
indexed, so `between` walks the index; a second filtered read picks up
recurring series regardless of anchor, because a weekly lecture anchored in
January still occurs in October. Non-recurring events anchored outside the
range are never fetched. Per-day grouping and shift tints are memoised on
their exact inputs, and the range is keyed by a formatted string so a query
only re-runs when the visible window actually moves. Recurring-event
expansion is untouched.

### Phase 4 — Events linked to subjects, with kind and period

Reuses the **existing** `subjectId` link on events; no second way to store it.
The create and edit form gains a Subject dropdown, then a Type dropdown
(Studying, Lecture, Section, Lab). For Lecture, Section or Lab a Period
dropdown (1 to 6) appears and fills the start and end times from the fixed
timetable.

**`PERIODS` lives in one place** — `features/calendar/categories.ts` — and is
imported by the event form, the day panel, and the AI calendar tools, so the
three cannot disagree:

| Period | Start | End |
| --- | --- | --- |
| 1 | 08:30 | 10:10 |
| 2 | 10:20 | 12:00 |
| 3 | 12:10 | 13:50 |
| 4 | 14:00 | 15:40 |
| 5 | 15:50 | 17:30 |
| 6 | 17:40 | 19:20 |

Each period is 1 hour 40 minutes with a 10 minute break before and after. While
a period is set the time fields show those times and are read-only, with a
small "Custom time" switch to override. Studying, and events with no subject,
use the normal time fields and show no period.

**Schema:** `eventKind` (`studying` | `lecture` | `section` | `lab` | none) and
`period` (1 to 6 | none) were added to `calendarEvents` beside `subjectId`,
with a Dexie version bump and an upgrade function that only adds fields. No
row was rewritten. Existing events have neither field and behave exactly as
before.

A **warning, not a block**, appears when a new lecture, section or lab falls in
a period already taken that day.

The **AI calendar tools** accept the same `eventKind` and `period`, import the
same `PERIODS`, and their descriptions and the system prompt were updated to
match. The assistant's existing behaviour is unchanged when the new fields are
omitted.

### Phase 5 — Assessments on the calendar

Assessments are **derived live**, never copied into the events table. The month
grid, week view and day panel all read `assessmentsByDate`, computed from a
live query on `assessments` and filtered to rows with a chosen date. Changing
or clearing an assessment's date therefore updates the calendar immediately,
and nothing is duplicated or synced twice. An assessment with no date does not
appear on the calendar.

An assessment with a date renders as a visually distinct dashed chip labelled
with its type and name ("Quiz: Midterm Quiz"), tinted with its subject's
colour, in both the month grid and the day panel. Tapping it sends the user to
the subject that owns it.

**Schema:** the assessment `date` became **optional** (additive; the field
already existed, only its requirement changed). An assessment with no date is
still listed in its subject, marked "No date", and is simply absent from the
calendar.

The subject view now also shows upcoming assessments sorted by date with a
**days left** countdown, computed in whole calendar days rather than 24-hour
spans, so an assessment on the 30th reads "Today" for the whole of the 30th.

### Verification

`npx tsc -b` clean, `npm run verify` exits 0, `npm run build` succeeds, and
five real-browser Chromium suites cover the phases: `verify:composer`,
`verify:dialog`, `verify:calendar`, `verify:period`, and
`verify:assessments` (6/6, including the derivation test that edits an
assessment's date and asserts the chip moves rather than duplicates). What
genuinely cannot be tested without hardware is listed in `PROGRESS.md`.

