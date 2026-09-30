# Overnight work progress

Branch: `overnight-features` (based on `3d09007` from `ai-pdf-reading`).
No merge into `main` will be attempted. No deploy commands will be run.

## Phase status

| Phase | Status |
| --- | --- |
| 0. PDF viewer crash cleanup | skipped, already complete before this run |
| 1. Fix "New group" doing nothing | done |
| 2. AI assistant tools | partly done, core delivered |
| 3. Notes editor rich text | not started, see report |

## Phase 0: skipped

Checked `PdfViewer.tsx`, `ImageViewer.tsx`, `useZoomAnchor.ts` and
`ViewerErrorBoundary.tsx` for `probeBefore`, `probeAfter`, `[zoomdbg]`,
`ZOOM_DEBUG`, `frameCounter`, `zdbg`, `canvas-size` and `previewAtRelease`.
Zero remnants. The error boundary already renders stack frames. This cleanup
landed in commit `3d09007`, so the phase is skipped rather than repeated.

## Phase 1: fix "New group" doing nothing

### Cause, diagnosed rather than guessed

The Dexie write was never the problem. Three defects stacked up so that
creating a group looked like a no-op:

1. **The render guard hid it, and this is the actual cause.**
   `SubjectDetail.tsx` did `if (members.length === 0) return null;` for each
   group. A brand-new group has no members, so the row was written to Dexie and
   then never drawn. The list query was already live (`useLiveQuery`) and
   already filtered by the right `subjectId`: the group existed, it simply was
   not rendered.
2. **The button was unreachable in an empty topic.** The entire group UI,
   New group included, sat inside the `topicResources.length === 0 ? ... :`
   ternary, so a topic with no resources could not host a group at all.
3. **Failures were swallowed.** Create, rename, delete and move were all
   `void someWrite(...)` with no `await` and no `catch`, so a rejected write
   disappeared and any real failure looked identical to "nothing happened".

### Ruled out

The primary-key theory in the brief was checked and is **not** the cause.
`resourceGroups: 'id, subjectId, order, createdAt'` already declares a string
`id` primary key, identical to every other synced table, and no table anywhere
uses `++id`. v10 is the current version and already has an `.upgrade()`. The
same audit was run against the other recently added schema: note titles are a
field on `topics` (no new table, no key change), so there is no second instance
of this mistake to fix.

### Fixes

- Groups always render, including with zero members, with an inline hint so an
  empty folder reads as a folder rather than a failure.
- The New group control moved outside the "no resources" branch.
- Every group write is awaited through `runGroupAction`, which catches and
  toasts "Could not create group: <reason>" and the rename, delete and move
  equivalents. Success toasts were added as well.
- No `window.prompt` anywhere: naming uses the existing inline input, which is
  not unmounted before the name is submitted.

### Verified

`scripts/verify-groups-ui.mjs`, 35 checks, all passing. It drives the real
repository functions against an in-memory Dexie stub and **reads the data back
after every action**: create, rename, move, delete, subject change, subject
delete. It pins the data-safety rules: deleting a group ungroups its resources
and never deletes them (row count and content asserted), and deleting a
subject deletes its groups. It also asserts the render guard is gone, that
failures are reported, and that no table uses an autoincrement key.

`verify-resource-groups.mjs` had one check asserting the pre-rename function
names; it now asserts the handlers actually wired, with a comment saying why.

### Not testable here

No browser or phone is available. The inline name input on a real touchscreen,
the toast appearing on a phone, a group appearing immediately after creation,
and the tap targets are verified by code inspection and unit checks only, not
by real interaction. Please click "New group" and confirm an empty group shows
at once.

## Phase 2: AI assistant tools

### Existing tool inventory, read from the code

23 tools across two files: 6 in `tools.ts`, 17 in `toolsExtended.ts`.
`M` = listed in `MUTATING_TOOL_NAMES` (changes stored data), `C` = listed in
`CONFIRMATION_TOOL_NAMES` (pauses for an explicit UI Confirm).

| Tool | Required params | M | C |
| --- | --- | --- | --- |
| getTodaysSchedule | none | | |
| getUpcomingDeadlines | none | | |
| searchLibrary | query | | |
| addOrUpdateWeeklySchedule | none | M | C |
| startPomodoroSession | durationMinutes | M | |
| stopPomodoroSession | none | M | |
| manage_split_screen | none | | |
| listSubjects | none | | |
| listTopics | subjectId | | |
| getWeekSchedule | weekStartDate | | |
| getFocusStats | range | | |
| getSubjectProgress | subjectId | | |
| getCurrentStatus | none | | |
| setStatus | status | M | |
| addCalendarEvent | title, date, category | M | |
| addResourceLink | topicId, title, url | M | |
| createSubject | name | M | |
| createTopic | subjectId, title | M | |
| markTopicStatus | topicId, status | M | |
| addTopicNote | topicId, content | M | |
| addAssessment | subjectId, name, type, date | M | |
| addPTO | date | M | C |
| addOneOffShiftException | date, startTime, hours | M | C |
| deleteCalendarEvent | eventId | M | C |

Notably already present: `createSubject` and `createTopic` exist, so Phase 2
adds only what is missing and does not duplicate them.

### Existing confirmation gate (reused, not rebuilt)

`useAssistantStore.ts` already implements the two-step pattern the brief asks
for. Calls in `CONFIRMATION_TOOL_NAMES` are split out of the tool batch at line
387, held as a `pendingAction`, and executed only by `confirmPending()`. The
model's own repeat call cannot perform the action; a declined action is fed back
to the model as "The user moved on without confirming this action". Any new
delete tool is added to that set and therefore inherits the guarantee instead of
relying on the model to behave.

## Decisions taken without asking

- Show empty groups rather than only non-empty ones, because the brief requires
  a group to be visible immediately after creation.
- Use toasts for write failures, because the app already has a toast store for
  this and the failing row may have scrolled out of view.
- Keep `moveResourceToGroup` returning silently in the repository (a guarded
  no-op for a cross-subject move) and surface only genuinely thrown errors, so
  a correctly-refused cross-subject move does not nag.

