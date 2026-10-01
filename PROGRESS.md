# Notes: default titles from the subject, and notes in the file picker

**Branch:** `nested-groups-picker`. **`main` was NOT touched, merged, or
force-pushed.** Working tree was clean at the start, so there was nothing to
checkpoint.

## Summary

| Phase | What it asked for | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Default note title is `<Subject>'s Notes`, numbering, v15 migration, follows a subject rename | **done** | `verify:note-titles` 87/87 (was 42), `tsc -b` 0, `build` clean, full `verify` clean. |
| 2 | Notes as a `'note'` node kind in the existing picker, notes selector swapped, AI paths | **done** | `verify:filepicker` 101/101 (was 77), `verify-split-view` 296/296 (was 294), `verify-extended-tools` passing, `tsc -b` 0, `build` clean, full `verify` clean. |
| Docs | PROJECT.md, About/Help, this file | **done** | `verify:about-help` 44/44. |

**Reverted:** nothing. **Partly done:** nothing in the code. **Could not be
tested in a real browser:** everything interactive. See the last section.

**Any manual Dexie Cloud action: NONE.** v15 adds no field, no table and no
index, so there is nothing for the cloud schema to learn. No new database, no
console command, no migration script. Existing notes simply gain a better title
the first time you open the app, and those titles sync back as ordinary row
updates.

## Phase 1: the default note title

**Where titles are created:** `ensureDefaultTopic` (libraryRepo.ts), `saveTopic`
via `TopicModal`, and the AI's `createNote`. **Displayed** in `MarkdownNotes`,
`NotesEditorBody`, `SubjectDetail`, the pane notes selector and `searchLibrary`.

**A note IS a `Topic` row.** There is no separate notes table, `Topic.subjectId`
links it to a subject, and topics do not nest, so a note has a subject and no
parent topic. **The old default was `'Untitled note'`**, with the legacy
placeholder `'General'` beneath it.

**One function owns the rule.** `getDefaultNoteTitle(subject)` in
`src/db/noteTitle.ts`, plus `uniqueDefaultNoteTitle`, `generatedNoteTitleNumber`
and `noteTitleForNumber`. The UI, the AI tools and the migration all call it, so
they cannot drift. The awkward possessive is deliberate and exact:
`"Thermodynamics's Notes"`.

**Numbering fills the gap.** `{"A's Notes", "A's Notes 3"}` yields
`"A's Notes 2"`, not `"A's Notes 4"`. Comparison is case-insensitive.

**A rename follows the subject without a new field.** The check is textual: a
title equal to the old subject's default, or that default plus a number, is
ours. `renameGeneratedNoteTitles` rewrites those in the SAME transaction as the
subject rename, carrying the number across. A typed title returns `null` and is
never touched.

### Bugs the tests caught (and I fixed)

1. **A blank title in the Topic dialog was a hard error.** It now falls back to
   the subject default, so a UI-created note and an AI-created one are named
   identically.
2. **`setTopicTitle` with an empty title used the generic constant.** It now
   resolves the subject default, numbered against the note's siblings (excluding
   the note itself, which would otherwise always collide with itself).
3. **A subject count of 0 would break numbering.** `ensureDefaultTopic` only
   runs when a subject has no notes at all, but `createNote` numbers against
   existing siblings, which is the case that actually repeats.

### Migration safety, pinned by tests

- Only titles the app generated are rewritten: empty, `'General'`,
  `'Untitled note'`. A typed title is never changed.
- **Note content is byte-for-byte untouched**, including `contentHtml` and
  `contentFormat`; every write is `{ ...t, title }`.
- **Running it twice changes nothing**, including `updatedAt`.
- A note whose subject is gone falls back rather than throwing.
- The v15 predicate is deliberately SEPARATE from v9's `needsTitleBackfill`,
  because v9's rule was broader and reusing it would touch notes v9 left alone.

### Three of my own test expectations were wrong

Corrected the tests, not the code: `Lectures` counts 1 (one subgroup, no files),
Thermodynamics counts 4 (one folder plus three openable files), and the image
viewer's count is 3 because it also lists the blob-less row.

## Phase 2: notes in the picker

**Selectors that can open a note, and what I found.** `PaneHeader`'s notes
`<select>` (a flat GLOBAL list of every note title in the app), the document
control in the same header, the Library's `SubjectDetail` grid, and the AI's
`manage_split_screen`. **The flat notes dropdown was swapped and removed.** The
Library grid was left alone: it is already scoped to one subject, so a global
picker there is a different job. `manage_split_screen` was extended.

- **`'note'` is a node kind** in the existing `PickerNode`, reusing the same
  `getChildren` / `pathOf` / search. No second picker, no duplicated helpers.
- **A note is never inside a group.** A group holds resources only, so notes
  always appear at the subject level. The tests assert this directly.
- **A note belongs to a subject and optionally to a topic.** Since topics do not
  nest, a note has no parent topic; one created "inside a topic" is still listed
  under its subject, with the subject as its path.
- **`kinds` (what the caller can open) is separate from `want` (which files).**
  PDF and image selectors pass `['resource']` and can never offer a note; the
  split pane passes `['resource', 'note']`. `DEFAULT_KINDS` is files-only so a
  caller that forgets is safe, and the prop also filters the Recent list.
- **Search covers note TITLES only**, never content.
- **`pathToTopic` and `labelForNote`** make "start where I am" and the header
  label work for notes exactly as for files.
- **Row order: folders, then notes, then files**, natural-sorted within a kind.
  Written into PROJECT.md as the fixed rule.

### Bugs the tests caught (and I fixed)

1. **`searchLibrary`'s flat `topics` list had no `path`.** I added it to the
   bucketed view first and the tests still failed: the model reads the FLAT list,
   so that was the one that mattered. Both carry it now.
2. **An unresolved resource id threw before note resolution could run.** A notes
   pane legitimately takes a note id, which is not a resource, so that hard
   error now applies only when a file is what the pane needs.
3. **A recent note would have been offered to a file-only picker.** Recent rows
   are filtered by `kinds` in the component.
4. **`noteOpened` ignored notes entirely**, so a note could never appear in
   Recent.

## What I could not test in a real browser

No browser or phone is available here. **Every interactive claim is read from
the source and asserted statically, not observed.** Please check:

### On your phone

1. That the picker still opens as a bottom sheet and is never clipped.
2. That a note row is tappable with a thumb and opens the notes view.
3. That the pane header shows the note title and its path, truncated, on a
   narrow screen.
4. Arrow keys and Enter are desktop-only, so skip those here.

### On your laptop

5. That **the v15 migration runs on your real database** and renames only the
   placeholder notes, leaving your own titles alone. This is the single most
   important check: `fake-indexeddb` is not a dependency, so the Dexie upgrade
   transaction itself was never executed here.
6. That a note with real content keeps it byte-for-byte after the migration.
7. That renaming a subject renames only its untouched default notes.
8. That the Recent section, the breadcrumb and the highlight work with notes.
9. That the two panes still browse independently with notes in the picker.
10. That the split pane's single button replaces both old dropdowns and nothing
    is stranded.

Nothing about zoom, pinch, scroll or split-view geometry was changed.


**Branch:** `nested-groups-picker` (created from `ai-upgrade`, pushed). **`main`
was NOT touched, merged, or force-pushed.**

## Summary

| Phase | What it asked for | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Nested groups, data + Library UI | **done** | `verify:nestedgroups` 91/91, `tsc -b`, `build`, full `verify` all clean. |
| 2 | AI group tools updated for nesting | **done** | `verify:nestedgroupsai` 61/61. |
| 3 | Drill-down file picker | **done, and now swapped into the viewer selectors** | `verify:filepicker` 77/77, `verify-split-view` 294/294, `tsc -b`, `build`, full `verify` all clean. |

**Reverted:** nothing. **Partly done:** nothing in the code. **Not
browser-tested:** every UI claim below. See "What I could not test in a browser".

## Why Phase 3 looked unfinished last time

It was **not reached, and nothing failed or was reverted.** Commit `59f9399`
shipped the data layer, the portal component and their tests, and the run then
stopped on purpose before the swap. The reason, recorded in the previous version
of this file, was that `PaneHeader`'s document `<select>` multiplexed PDFs,
images *and* notes in one control, while the picker models
`subject -> group -> file`. Adopting it there would have meant inventing a
`topic` node kind, and `verify-split-view.mjs` pinned the old markup.

**That cause is now fixed.** Rather than teach the tree about notes, the file
part became the picker and the notes dropdown stayed a dropdown. A topic is not
a file and does not live in a group, so a fourth node kind would have been a
lie about the data. `verify-split-view.mjs` was rewritten in the same commit as
the swap: each assertion keeps the property it was protecting and checks it
against the picker now.

### Bugs this round's tests caught (and I fixed)

1. **The Recent section was five dead labels.** `noteOpened` stored only the id,
   name and path, so tapping a recent row had no `resource` to hand back. It
   stores the whole node now.
2. **Recent REPLACED step 1 instead of heading it.** The old component made the
   recent list the entire root list, so with nothing opened you saw a Recent
   heading and no subjects at all. It is now a section above the subjects, and
   it hides during a search, where the heading would be a lie.
3. **Group badges undercounted.** A group counted only its direct files, so a
   folder holding only subgroups read "0". It counts both now, and the test
   pins a folder with no files of its own reporting 1.
4. **Subject badges counted files the viewer cannot open.** Now filtered by
   `want`, so the PDF and image views report different, correct numbers.
5. **Search missed subject names.** It searched groups and files only.
6. **Search offered rows that cannot open.** A blob-less file was excluded from
   the list but could appear in search. Search now applies the stricter rule.
7. **A synced file was labelled "Not a PDF".** The blob check ran after the type
   check, but a synced row has no MIME to judge. The order is now reversed, so
   the message names the real problem.
8. **The dropdown rendered the literal text `Select file\u2026`.** JSX does not
   interpret a `\uXXXX` escape in text, so the escape reached the screen.
   Replaced with a real ellipsis.

### Three of my own test expectations were wrong, not the code

Worth stating plainly, because I changed the test rather than the behaviour:
the `Lectures` badge is 1 (one subgroup, no files of its own, not 2); the
subject badge is 4 (one folder plus three openable ungrouped files, not 2); and
the image viewer's is 3, because it also lists the blob-less row. Each was
checked against the fixture before being corrected.

## The picker

- **One array is the navigation state**, the path from the root. No per-level
  variable, so any depth works with the same code and Back is "drop the last
  element". A four-level tree and a nine-level tree run the same code.
- **The tree rules are reused, not re-implemented.** `getChildGroups`,
  `getAncestors`, `getDescendants`, `pathOf` and `parentOf` all come from
  `src/features/library/groupTree.ts`, the same module the Library tree and the
  AI tools read.
- **The data lives in one file.** `filePickerData.ts` queries the tables;
  `FilePicker.tsx` queries none (asserted: the test fails if the component ever
  calls `db.`).
- **Two different hiding rules, on purpose.** A file of the wrong type is
  dropped; a file of the right type with no bytes is listed dimmed. Search
  applies the stricter rule.
- **Per-pane state.** Each pane passes its own `slotKey`, so browsing in one
  never moves the other.

### The other resource selectors, still not swapped

Found and reported rather than forced:

| Where | State |
| --- | --- |
| `PaneHeader` document control | **Swapped.** Now the picker, with the file name and path on the button. |
| `PaneHeader` notes dropdown | Left alone. A topic is not a file; see above. |
| `MoveToGroupMenu` | Left alone. Already a tree, from the shared `buildGroupTree`. |
| `ResourceModal` group `<select>` | Left alone. A one-level list, so it is unclear at depth but not broken. |
| `LibraryPage` global search | Left alone. A different job: it finds anything, not a file to open, and it already shows subjects. |
| AI `searchLibrary` | Left alone. Already carries `groupId` and `groupPath` from Phase 2. |
| AI attachments | **Do not exist.** There is no attach-a-file feature in the assistant; nothing to swap. |

## What I could not test in a browser

No browser or phone is available here. **Every interactive claim is read from
the source and asserted statically, not observed.** Specifically, please check:

1. That the picker opens as a popover on desktop and a bottom sheet on a phone,
   and is never clipped by a pane or the horizontally scrolling toolbar.
2. Arrow keys, Enter, Backspace and Escape, and that typing filters the search.
3. That the picker opens at the current file's folder and highlights that file.
4. That Recent appears at the top of step 1 after opening a few files, and that
   tapping a row opens it.
5. That two panes browse independently and each remembers its own place.
6. That the header button truncates cleanly on a narrow split half.
7. The exact truncation point of a long path in the breadcrumb.

Nothing about zoom, pinch, scroll or split-view behaviour was changed.

## Two decisions worth confirming

- **`MAX_GROUP_DEPTH = 5`** is my reading of "5 levels deep". If you meant five
  levels *below* the subject, that is `MAX_GROUP_DEPTH = 6` and one line in
  `groupTree.ts`.
- **The v14 upgrade normalises, it does not migrate.** It clears an impossible
  `parentGroupId` (a parent that is gone, in another subject, self-referential,
  or already part of a cycle) and writes an explicit `null` where the field was
  absent. It never rewrites a name, an order or a subject, and never deletes.
  So a repaired group surfaces at the top level rather than vanishing. If you
  would rather it did nothing at all, a no-op `void tx;` upgrade is correct
  here, because a missing `parentGroupId` already means "top level".


### Dexie Cloud: does the new field need any manual action?

**No.** `parentGroupId` is plain row metadata, added to the existing
`resourceGroups` row, so Dexie Cloud replicates it exactly like `name` and
`subjectId` already are. Concretely:

- **No new database to register.** Dexie Cloud mirrors the IndexedDB schema; a
  version bump in `db.ts` does not create or require a new cloud database.
- **No schema change in the cloud console.** The Dexie Cloud dashboard only
  matters for settings that are not stored per row (auth, access). Nothing here
  touches those.
- **No migration script.** Existing rows simply have no `parentGroupId`, which
  already means "top-level". `resourceGroups` stays in `UNSYNCED_TABLES` = empty,
  so it syncs as before.
- **Existing groups keep their ids**, so a group's `groupId` reference from any
  resource, any chat message, or any other device stays valid.

The one thing to do after deploying is nothing at all: open the app and the v14
upgrade runs on the client, clearing only an impossible `parentGroupId` (which
cannot exist yet, since nothing wrote one before this version).

### What the v14 upgrade actually does

It **normalises rather than creates**, mirroring the v10 upgrade that
normalised `resources.groupId`:

- a parent that no longer exists -> cleared (the group becomes top-level)
- a parent in another subject -> cleared
- a self-parent -> cleared
- a cycle already present in the data -> cleared
- `parentGroupId: undefined` -> written as explicit `null`

It never deletes a row, and it never rewrites `name`, `order`, `subjectId` or
`createdAt`. A group that had to be repaired stays **visible at the top level**
rather than disappearing into a branch nothing can render.



**Branch:** `ai-upgrade` (created from `calendar-update`, pushed). **`main` was
NOT touched, merged, or force-pushed.**

## Summary

| Phase | What it asked for | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Retry on transient provider errors | **done** | `npm run verify:retry` 47/47. |
| 2 | Stop responding button | **done** | `npm run verify:stop` 43/43. |
| 3 | One reliable way to identify items | **done** | `npm run verify:resolve` 56/56. |
| 4 | Calendar tools for the new calendar | **done** | `npm run verify:calendartools` 95/95. |

**Reverted:** nothing. **Partly done:** nothing. All schema changes additive
(v13). No user data deleted or overwritten.

**Could NOT be tested, stated plainly:**

- **The real Gemini API.** No key was available, so nothing here was tested
  against a live provider. Every check drives the real code against a MOCKED
  `fetch`. The retry policy, the abort path and the 400 handling are verified as
  logic; whether Gemini's real 503 bodies and real overload behaviour match is
  not.
- **Real touch input and a real soft keyboard.** Chromium emulates taps. The
  Stop button and Escape are verified in the DOM, but pressing them with a real
  thumb is not.
- **Multi-device Dexie Cloud sync** of the new `fallbackModel` and `seriesId`.
- **Your real data.** Every test ran against synthetic subjects and events.

**What you must test on your phone and laptop:**

1. Send a message while the model is busy. Watch for the "Model is busy,
   retrying (2/4)..." line, and confirm the answer still arrives with no
   duplicated message and no action run twice.
2. Send a long multi-tool request (for example "move my lecture to Thursday"),
   then press Stop mid-way. Nothing more should happen, and the partial answer
   should be kept and marked Stopped.
3. Press Stop while a delete confirmation card is open. The card should vanish
   and nothing should be deleted.
4. Send a message, press Stop, then immediately send another. The second should
   work with no error about a missing tool response.
5. Open a delete confirmation card, press Stop, and check nothing was deleted.
6. Ask "what do I have tomorrow" and "when am I free on Tuesday". Then ask for
   "add my lecture every week on Monday period 1": you should get a preview and
   a Confirm card, and nothing should be created until you press Confirm.
7. Ask the assistant to change an assessment's date, then open the Calendar and
   confirm the item moved and was not duplicated.
8. With a fallback model filled in in Settings, confirm the chat says
   "Answered by fallback model <name>" when it ever triggers.

**Manual action needed:** none for Dexie Cloud or Vercel. v13 is additive (two
unindexed optional fields, upgrade a no-op), so there is no new cloud database
version to register. The app is a static SPA with no new environment variables.

## Phase 1, step 1: the request point and the request count

**There is exactly ONE place a provider request is made for every provider:**
`chatCompletion()` in `src/features/ai/aiClient.ts`. It was a single bare
`fetch` with no retry, no abort and no timeout, which is why an overloaded
provider broke conversations mid-session.

**One user message costs 1 request if the model answers at once, up to 6 if it
keeps calling tools**: the turn loop is `for (round = 0; round <=
MAX_TOOL_ROUNDS)` with `MAX_TOOL_ROUNDS = 4`, plus one final no-tools "wrap up"
request when the budget runs out. Every one of those was a separate
`chatCompletion` call, so any of them could be the one that failed.

All retry logic now lives inside that one function.

### What the retry does and does not do

4 retries for 429/500/502/503/504 and network failures, at roughly 1s, 2s, 4s,
8s plus up to 500ms of jitter, honouring `Retry-After`. 400, 401, 403 and 404
are shown immediately. A 429 whose text says the daily quota is spent is NOT
retried, because no wait fixes it.

The loop re-sends a **byte-identical body**: it never touches the transcript,
the stored rows or any tool result. That is what makes the guarantee hold that a
retry cannot re-run a create, rename or delete, and cannot send the user message
twice. The test asserts all three request bodies are the same string.

### Load reduction, measured

A 200-row `searchLibrary` result went from 24434 to 4083 characters once tool
results are capped at `MAX_TOOL_RESULT_CHARS` (4000) with a `[truncated]` marker.
History is limited to `CONTEXT_WINDOW` (20) messages. The request-per-message
logging the brief asked for was added, measured, and then removed.

## Phase 2: what Stop actually cancels

One `AbortController` per user turn. Aborting it does three things at once: it
aborts the in-flight fetch, it rejects the backoff wait so no further retry is
issued, and the loop re-checks the signal before the next round so no new tool
call starts. A tool already running is left to finish, because aborting a
database write halfway is worse than finishing it.

A pending Confirm card is **cancelled** as if the user had pressed Cancel, and a
synthetic tool response is written so the next turn stays well-formed: an
unanswered `tool_call` makes Gemini reject the following request with HTTP 400.

## Phase 3, step 1: the diagnosis, before any code changed

**There were THREE different lookup implementations, which is the root of the
reported bug.**

- `toolsExtended.ts`: id-only, via `db.subjects.get(key)` / `db.topics.get(key)`
  in `requireSubject()` and `requireTopic()`. A NAME could never work. The file's
  own header comment claims "when an argument references an entity by name we
  resolve it to an id and fail loudly on ambiguity", which was not true of the
  code.
- `toolsLibrary.ts`: `resolveByIdOrName`, id then name then substring. Used by
  all 15 note and group tools.
- `tools.ts` `manage_split_screen`: a third hand-rolled copy of the same idea.

**What the search returned.** `searchLibrary` returned, per subject bucket,
`{ subject: <NAME>, topics: [{id, title, ...}], resources: [{id, title, ...}],
assessments: [{name, type, date}] }`. Two concrete defects: the subject bucket
had **no `subjectId` at all**, so a subject id could not be obtained from a
search; and assessments had **no `id`**, and no tool could act on an assessment
anyway because no `updateAssessment` or `deleteAssessment` existed. The ids that
WERE returned are the exact Dexie primary keys, not truncated and not display
indexes.

## Phase 4: the two latent bugs the new tests found

1. **`saveEvent` and `saveAssessment` normalize a whole row.** The update tools
   were passing only the changed fields, which threw on the first required field
   they omitted. They now merge onto the existing row.
2. **`normalize()` in eventsRepo builds an explicit field list**, so anything
   not named is silently dropped on write. `seriesId` was being dropped, which
   meant a bulk series had no grouping and could never be deleted as a unit.

Both were real defects that only a test exercising the write path would catch.


## Phase 3, step 1: the diagnosis, before any code changed

**There is exactly ONE place a provider request is made for every provider:**
`chatCompletion()` in `src/features/ai/aiClient.ts`, reached through
`buildChatCompletionsUrl(provider.baseUrl)`. Before this work it was a single
bare `fetch` with no retry, no abort and no timeout.

**Requests per user message:** the store's turn loop is
`for (round = 0; round <= MAX_TOOL_ROUNDS)` with `MAX_TOOL_ROUNDS = 4`, so one
user message produces **1 request if the model answers immediately, up to 6 if it
keeps calling tools** (5 tool rounds plus a final no-tools "wrap up" request when
the round budget runs out). Each of those was previously a separate
`chatCompletion` call, which is exactly why an overloaded provider could break a
conversation mid-chain.

### Every tool that takes an item reference, and how it looks the item up

Two INCOMPATIBLE conventions exist today. This is the root of the reported bug.

**Group A, `toolsExtended.ts` (18 tools): ID ONLY, via a raw `db.get()`.**
`requireSubject()` (line 326) and `requireTopic()` (line 337) do
`db.subjects.get(key)` / `db.topics.get(key)` and throw
`No subject has id "X". Call listSubjects()...` when it misses. A NAME passed here
can NEVER work. Tools affected: `listTopics`, `getSubjectProgress`,
`addCalendarEvent` (subjectId), `createTopic`, `addAssessment`, `addResourceLink`,
`markTopicStatus`, `addTopicNote`, `deleteCalendarEvent` (eventId).
`startPomodoroSession` (in `tools.ts`) is also id-only.

**Group B, `toolsLibrary.ts` (15 tools): id-then-name via the shared resolver.**
`resolveByIdOrName(rows, ref, nameOf, label)` in `toolResolve.ts` tries the exact
id, then an exact case-insensitive name, then a unique substring, and returns
candidates on ambiguity. All 15 note and resource-group tools use it through a
`need()` helper.

**Group C, `manage_split_screen` (in `tools.ts`): a THIRD implementation.**
Lines 562-582 do its own `db.resources.get()`, then its own exact-then-partial
title/fileName matching. Same idea as Group B, written a third time.

### What the search and list tools actually return

`searchLibrary` (tools.ts:320) returns, per subject bucket:
`{ subject: <NAME>, matchedSubject, topics: [{id, title, status, excerpt}],
resources: [{id, title, kind, dueDate, group}], assessments: [{name, type, date}] }`.

Two concrete defects:

1. **The subject bucket is keyed by NAME, not id.** There is no `subjectId` field
   anywhere in the `searchLibrary` result, so the model cannot get a subject id
   from a search at all. `listSubjects` does return ids.
2. **Assessments are returned with no `id` field at all** (only `name`, `type`,
   `date`), and no tool can act on an assessment, because there is no
   `updateAssessment` or `deleteAssessment` anywhere in the codebase.

The `id` values that ARE returned (`topics[].id`, `resources[].id`) are the exact
Dexie primary keys (`t1`, `r1` style in fixtures, `newId()` UUIDs in production),
not truncated and not display indexes. So the ids themselves are sound; what is
missing is `kind`, and a consistent way to route them.

### Reproducing the reported bug

The reported symptom, "passes the id and the tool says it cannot find the item",
is reproducible whenever a model reaches a Group A tool with something that is
not a raw id, and the reverse happens in `deleteCalendarEvent`, which is id-only
and is reached with an event the model only ever saw a NAME for. `toolsExtended.ts`
even documents a behaviour it does not have: its header comment claims "when an
argument references an entity by name we resolve it to an id and fail loudly on
ambiguity", but there is no name resolution in that file at all.

# Calendar update: report

**Branch:** `calendar-update` (created from the working branch, pushed). **`main` was NOT touched, merged, or force-pushed.**

**Final state:** `npx tsc -b` clean, `npm run verify` **exits 0**, `npm run build`
succeeds, and the four real-browser suites below **exit 0** in real Chromium.
No data was deleted or rewritten. No deployment settings were changed.

## Summary

| Phase | What it asked for | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Shift+Enter inserts a newline in the assistant composer | **done** | `<input>` was the cause; now an auto-growing `<textarea>`. `npm run verify:composer` passes in Chromium. |
| 2 | The subject edit dialog must appear above the subject view | **done** | One shared `zIndex` scale plus portals. `npm run verify:dialog` passes in Chromium, standalone and split. |
| 3 | Full day view and calendar optimization | **done** | Day panel, 2 compact chips plus "+x", range-scoped live queries. `npm run verify:calendar` passes in Chromium. |
| 4 | Link events to a subject with a kind and a period | **done** | One shared `PERIODS` constant; additive `eventKind` and `period`. `npm run verify:period` passes in Chromium. |
| 5 | Assessments on the calendar | **done** | Derived live, never copied. `npm run verify:assessments` passes 6/6 in Chromium. |
| Docs | PROJECT.md, About/Help, this report | **done** | `verify-about-help` 44/44. |

**Reverted:** nothing. **Could not be tested:** see the honest list below.

### Phase 5: the derivation is the load-bearing part

The month grid, the week view and the day panel all read
`assessmentsByDate`, which is computed from the live `assessments` table and
filtered to rows with a date. Nothing is ever written into
`calendarEvents`, so a changed or cleared date moves the chip immediately and
nothing is duplicated or synced twice.

The browser test asserts exactly that rather than just "a chip appears": it
creates an assessment, finds it on its date, then **edits the date** and
checks the old day now has 0 chips and the new day has 1. That test is the
only thing that would catch a copy-into-events implementation.

### Schema changes: additive only, one version bump

The new event fields are `eventKind` (`studying` / `lecture` / `section` /
`lab` / none) and `period` (1 to 6 or none). They were added beside the
existing `subjectId` link, with a Dexie version bump and an upgrade function
that only adds fields. No row was rewritten, no index was dropped, and no
existing data was deleted or overwritten. Existing events have neither field
and behave exactly as before.

The assessment date became **optional** (additive, nothing rewritten), so an
assessment with no date is still listed in its subject as "No date" and
simply does not appear on the calendar.

### What I could NOT test

- **Real touch input.** Chromium emulates taps. It does not reproduce a real
  finger, a real soft keyboard, or a real iOS/Android date picker. The mobile
  bottom sheet, the day panel by tap, and the mobile Enter behaviour all need
  your thumb.
- **Hardware-keyboard detection on a phone.** The composer treats a keydown
  with `keyCode === 229` as a soft keyboard and never sends on Enter. The
  detection logic is verified; that it matches your specific keyboards is not.
- **Multi-device Dexie Cloud sync** of the two new event fields.
- **Your real data.** Every test ran against synthetic subjects and events.

### What you must test on your phone

1. Open the assistant. Type a long multi-line message: the box should grow to
   about six lines and then scroll. Enter sends, Shift+Enter adds a line.
2. On a phone, tap into the box and press Enter. It should add a line, not
   send. Tap Send to send. With a Bluetooth or case keyboard, Enter should
   send.
3. Open the Calendar and tap a day. The sheet should rise from the bottom,
   list everything on it, and let you edit, delete and add without leaving.
4. Create a Lecture event, pick period 3, and confirm the times fill in as
   12:10 to 13:50 and lock. Turn on "Custom time" and confirm you can
   override them.
5. Add an assessment with a date to a subject, then open the Calendar and
   confirm it appears on that date. Change the date and confirm the chip
   moves and does not stay behind in the old day.
6. Open a subject's edit window from both the standalone view and the split
   pane and confirm it is fully visible and on top of everything.

### Dexie Cloud / Vercel: no manual action needed

Every schema change is additive, so Dexie Cloud replicates the new fields as
plain row data. There is no new cloud database version to register and no
migration to run. Nothing needs doing in the Dexie Cloud console.

Vercel needs nothing either: the app is a static SPA with no new environment
variables. The `calendar-update` branch is pushed, so you can preview it from
the Vercel branch deploy if you want to check it before merging.

# Overnight work: report

**Branch:** `overnight-features` (pushed). **`main` was NOT touched, merged, or
force-pushed.**

**Final state:** `npx tsc -b` clean, `npm run verify` **exits 0**,
`npm run verify:editor` **exits 0** (63/63 in real Chromium), `npm run build`
succeeds. Nothing was deployed and no deployment settings were changed.

## Summary

| Step | What it asked for | Status | Evidence |
| --- | --- | --- | --- |
| 0 | Get a real browser | **done** | Playwright Chromium installed; `npm run verify:editor` drives a real page. |
| 1 | Tiptap WYSIWYG editor in both places | **done** | Editor renders in Library and split pane; title, autosave and indicator kept. |
| 2 | Sizes, colour popover, alignment, clear | **done** | Portal popover, swipeable toolbar, active states; verified at phone width. |
| 3 | Storage (`contentHtml` + `contentFormat`) | **done** | Dexie **v11**, additive, no row rewritten; markdown backup never touched. |
| 4 | Typing shortcuts + hint line | **done** | `# `, `**`, `- `, backticks and `$math$` all verified in the browser. |
| 5 | Note AI tools + Confirm counts | **done** | 4 note tools added; `deleteNote` gated; every Confirm card names the counts. |

**Two bugs found and fixed while testing, that the checks alone would have missed:**

1. **`searchLibrary` could not see anything typed in the new editor.** It
   matched on the markdown `notes` field, but a converted note's real text lives
   in `contentHtml`. The assistant would have reported "no results" for text the
   user could see on screen. Both search paths now read `topicPlainText`, which
   picks the right format, and a test pins both directions.
2. **Three verify scripts were passing against dead code.** They asserted on the
   old textarea toolbar and the old textarea `NotesEditorBody`, neither of which
   is imported by anything any more. Those checks had been green while guarding a
   component that never renders. They now point at the live editor, and a new
   check fails if anything imports the legacy toolbar again.

**What I could NOT test — genuinely untested, not smoke-tested:**

- **Real touch input.** Chromium emulates taps; it does not reproduce a real
  finger. The palette's open/close and the toolbar swipe need your thumb.
- **Your actual notes.** Every conversion test ran against synthetic notes. Your
  real notes have formatting, maths and length that no fixture reproduces.
- **Multi-device Dexie Cloud sync** of the two new fields.
- **Your fonts at your sizes** — four presets look different per device.

**What you must test:**

1. Open an **old** note you wrote before this change. It should look identical
   to before. Edit it, save, and confirm your words are all still there.
2. On a new note: select words and press Bold, Italic, Underline, each size,
   each colour, and each alignment. No tag code should ever appear.
3. Tap the colour button on a **phone**; confirm the palette is not clipped and
   closes when you tap elsewhere.
4. Type `# `, `**bold**`, `- `, `` `code` `` and `$x$`; confirm each behaves as
   the hint under the toolbar claims.
5. Ask the assistant to delete a topic and a note. The Confirm card must show
   the counts, and nothing may change until you press Confirm.

### Dexie Cloud: no manual action needed

The schema change is **additive only** (two new fields, no index, no row
rewritten). Dexie Cloud replicates rows as they are, so new fields sync with no
server-side change, no new database version in the cloud console, and no
migration to run. **Nothing is required from you.**

The one thing to confirm is ordinary: that sync still works after this release.
Because conversion is lazy, a note only leaves the old format once you *edit*
it, so two devices can legitimately show a note differently until then — the
markdown is still there on both, and the editor body wins once written.

---

## Earlier phases (unchanged)

| Phase | Status | One-line outcome |
| --- | --- | --- |
| 0. PDF viewer crash cleanup | **skipped** | Already complete in `3d09007`; verified zero debug remnants. |
| 1. "New group" does nothing | **done** | Root cause was a render guard hiding empty groups, not a failed write. |
| 2. AI assistant tools | **done** | 12 library tools + id/name resolver + all deletes behind Confirm. |
| 3. Notes editor rich text | **done** | Colour/size bug fixed at root, then replaced by the Tiptap editor. |

### The three findings worth your attention

1. **"New group" was never a database problem.** The write always succeeded. A
   render guard (`if (members.length === 0) return null`) hid every new group,
   because a new group has no members. The button was also unreachable in an
   empty topic, and all four group writes were `void` with no `catch`, so real
   failures were invisible too.

2. **The note colour and size bugs were one bug, and it was not colour.** No
   toolbar button called `preventDefault` on `mousedown`, so the browser
   collapsed the text selection before `onClick` ran and every wrapper was
   inserted around **zero characters**. That produced a bare `<span>` in the
   textarea (the "size pastes tag code" report) and an invisible empty span (the
   "colour does nothing" report). Colour was provably fine in the sanitizer, the
   CSS variables and the renderer. One shared handler fixes both.

3. **`npm run verify` now exits 0 for the first time.** The two long-standing
   `verify-resource-preview` failures were stale assertions, not defects: one
   matched as a substring inside the legitimate `gestureStartZoomRef`, the other
   used a regex window too narrow for later code. No viewer behaviour changed.

### What I deliberately did not do

- **A split pane showing a tool-deleted resource is not auto-closed.**
- **Real KaTeX.** `$math$` still renders as highlighted text, not typeset maths.
  It is deliberately isolated in one place (`noteEditor/mathNode.ts` +
  `mathRender.ts`) so real KaTeX can be dropped in later as an editor extension
  without touching storage or the toolbar.
- **The legacy textarea editor was deleted from use but left on disk.**
  `components/NoteToolbar.tsx` and the old textarea `NotesEditorBody` inside
  `MarkdownNotes.tsx` are no longer imported by anything. They are kept only so
  the old behaviour can be read for reference. A verify check now fails if
  anything imports them again.

### Carried over from the earlier run, still worth repeating

1. **New group**: create one in a topic that already has resources, and one in a
   topic with none. The empty group must appear immediately.
2. **Assistant deletes**: ask it to delete a group / topic / resource / subject.
   It must show a Confirm card and change nothing until you press Confirm. Then
   test Cancel and confirm the data is still there.
3. **Group delete specifically**: delete a group and confirm its resources are
   still present, just ungrouped.
4. **Ambiguous names**: if you have two resources with the same name, ask the
   assistant to delete "that one" and confirm it asks which rather than guessing.
5. The PDF and image viewers are untouched, but the usual zoom, pinch,
   fullscreen and split-view checks are still worth repeating.

### Needs your manual action (I could not and did not do these)

- **Dexie Cloud**: no schema action needed (see above) — just confirm auth and
  sync still work after this release. `dexie-cloud.json` is gitignored and absent
  from the deployed repo, and I did not touch the cloud database or any
  credentials.
- **Vercel**: I did not deploy and did not change settings. `main` is still
  older than this branch, so **if Vercel is configured to deploy from `main`,
  merging this branch first is required** or production will not get these fixes.
- **Merge**: this branch is not merged. Review and merge when ready.

### Not tested at all

Everything is verified by TypeScript, by unit-level scripts that drive the real
repository functions against an in-memory Dexie, and by 63 checks in real
Chromium. What remains untested is listed under "What I could NOT test" at the
top: real touch input, your real notes, multi-device cloud sync, and your fonts.
Treat that list as genuinely untested, not as smoke-tested.

## Phase status

| Phase | Status |
| --- | --- |
| 0. PDF viewer crash cleanup | skipped, already complete before this run |
| 1. Fix "New group" doing nothing | done |
| 2. AI assistant tools | partly done, core delivered |
| 3. Notes editor rich text | Step 1 done (colour bug fixed); rewrite NOT attempted |

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

### What was added

New module `src/features/ai/toolsLibrary.ts` with 12 tools, wired into `tools.ts`
(specs, dispatcher, describe wording, both sets):

- Groups: `listGroups`, `createGroup`, `renameGroup`, `deleteGroup`,
  `moveResourceToGroup`
- Subjects: `renameSubject`, `deleteSubject`
- Topics: `renameTopic`, `deleteTopic`
- Resources: `renameResource`, `moveResource`, `deleteResource`

`createSubject` and `createTopic` already existed, so they were NOT duplicated, and
a verify check asserts they are still absent from the new module.

New module `src/features/ai/toolResolve.ts`: id-or-name resolution. An exact id
wins, then a case-insensitive exact name, then a substring. If more than one row
matches it returns the candidate list WITH ids instead of guessing. Every
rejection says "Nothing was changed" so the model does not retry blindly.

### Safety design

The delete guarantee is structural, not a prompt instruction.
`useAssistantStore` filters names in `CONFIRMATION_TOOL_NAMES` out of the tool
batch and breaks the loop BEFORE `runTool`, so the model calling a delete twice
cannot perform it: only `confirmPending()`, driven from the Confirm button,
executes it. `deleteSubject`, `deleteTopic`, `deleteResource` and `deleteGroup`
were added to that set through a spread of `LIBRARY_CONFIRM_TOOL_NAMES`, so the
classification lives next to the handlers and a new delete cannot be added
without also being gated. No delete tool accepts a `confirmed` boolean, so there
is no parameter the model could set to skip the gate.

`deleteGroup` is deliberately gated even though it only ungroups: it still
removes a row the user made. Its description and Confirm wording both state that
resources are kept, and the result reports `deletedResources: 0`.

### Verified

`scripts/verify-ai-tools-library.mjs`, 54 checks, all passing. The behavioural
checks run the real repository functions and read the data back:

- every group tool works, by id AND by name
- `deleteGroup` keeps every resource and reports zero deletions
- subject delete cascades to topics, resources and groups and leaves other
  subjects untouched; topic delete removes its resources only
- `moveResource` clears `groupId`; a cross-subject move is refused, no change
- an ambiguous name returns both candidates with ids and deletes nothing
- every delete is gated, the store filters gated calls before executing them,
  and only `confirmPending` executes them

### Not done in Phase 2

Called out rather than half-built:

- `setNoteTitle`, `createNote`, `renameNote`, `deleteNote` were NOT added. Note
  content handling is entangled with the Phase 3 editor format change, so these
  would need rewriting again shortly.
- The system prompt tool list and the About/Help tool list were NOT updated. The
  tools are registered and callable, but the prompt does not advertise them, so
  the model will only reach them if the user names one.
- The Confirm card shows the description text, not deletion COUNTS yet.
- Closing a split pane showing a tool-deleted resource was not wired.
- Turn order and action pills were not re-verified for the new tools; they reuse
  the existing `runTool` path the Gemini 400 fix already covers.

### Not testable here

No browser or phone is available. The Confirm card, the action pill per call and
the Confirm/Cancel buttons on a phone are covered by code inspection only. Please
ask the assistant to delete a group and confirm it asks first, and that Cancel
changes nothing.

## Also fixed: the two stale verify-resource-preview assertions

Both pre-dated this run, and `npm run verify` now exits 0 for the first time.
Neither was a real defect:

1. "committed zoom must never be multiplied into the running ratio" was a
   substring false positive: the banned pattern matched inside the legitimate
   `gestureStartZoomRef.current * liveScaleRef.current`, and the comment
   explaining the old bug survived comment stripping. Fixed by anchoring the
   pattern and filtering comment lines. The invariant it guards is intact.
2. "the focal point is captured once and never re-taken" used a 300-character
   window that stopped reaching the assignment after staged-swap aborting was
   added to the first-tick guard. `focalRef` is still assigned exactly once. The
   window was widened to 900, with a comment saying why.

No viewer behaviour was changed.

## Phase 3: notes editor

### Step 1, the colour bug: root cause found and fixed

The brief listed four candidate causes. Three were ruled out by testing, and
the fourth turned out to be none of them:

- NOT stripped by the sanitizer. `sanitizeTag` on a colour span returns
  `<span style="color:var(--note-c-rose)">` unchanged.
- NOT rejected by value validation. `COLOR_TOKEN` matches the palette token, and
  the palette token is exactly what `colorVar` emits.
- NOT an unresolved CSS variable. All eight `--note-hue-*` variables are defined
  in `themes.css`, and the eight `--note-c-*` variables resolve in both `:root`
  and `html.light`.
- NOT overridden by a higher-specificity theme rule. The rendered output is
  `<span style="color:var(--note-c-rose)">` inside the note paragraph, verified
  by running the real `renderNoteHtml` pipeline, and inline style beats a class.

**The actual cause was the selection, not the colour.** No toolbar button had
`onMouseDown` / `preventDefault`. Pressing a button fires `mousedown` FIRST, which
moves focus off the textarea and COLLAPSES the selection to a caret. By the time
`onClick` ran, `api.read()` returned `start === end`, so `wrapSelection` inserted
the wrapper around ZERO characters.

That explains BOTH reported symptoms with one cause: the user saw a bare `<span>`
tag dumped into the textarea with nothing inside it (the "size pastes tag code"
report), and for colour the empty span rendered nothing visible at all (the
"colour does not work at all" report). Colour and size were never broken in the
pipeline; both were being applied to an empty selection.

Fix: a shared `keepSelection` handler calling `preventDefault` on `mousedown`,
added to all five formatting buttons (size x4 via the preset map, alignment x3,
colour x8 via the palette map, colour opener, and clear formatting). It is on
`mousedown` deliberately; preventing the default of `click` is too late.

Seven regression checks were added to `verify-ai-tools-library.mjs`, including
one asserting the editor is still a textarea, so a future reader can tell this
fix from the rewrite that was not attempted.

### Step 2, the Tiptap rewrite: NOT attempted, on purpose

I stopped rather than half-build this, for these reasons:

1. The bug the brief asked me to fix in Step 1 is now fixed at its root. A
   Tiptap editor would have hidden the symptom without identifying the cause, and
   the cause is now documented and guarded by a regression test.
2. Step 3 requires a content-format migration across every existing note. That is
   the single highest-risk change in this whole brief ("Notes must never be lost
   or corrupted"), and it should not be done unattended by an agent that cannot
   open a browser to check the result on a real note.
3. It is not a small diff. A custom FontSize extension, a new toolbar, a
   `contentHtml` field with a format marker, a Dexie version bump, a converter
   proven to preserve text, and a strict HTML sanitizer on load, all at once,
   with no way to visually confirm any of it.

Attempting it half-finished would have left notes in a mixed-format state with
no way to verify recovery, which is strictly worse than the current working
editor. Rule 4 says revert a phase that cannot be finished safely rather than
leave the app broken; here the safe action was to not start it.

Also note Step 2 would need `npm install @tiptap/react @tiptap/starter-kit
@tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-text-align`.
Tiptap 3.31.3 is available on the registry and no Tiptap package is installed yet.

### What you get today

Selecting text and pressing Size, Colour, Align or Clear formatting now wraps
the text you actually selected. The tags remain visible in the textarea while
editing, which is inherent to a markdown textarea and is the honest reason the
brief wanted a WYSIWYG editor in the first place. The view side is unaffected.

## Decisions taken without asking

- Show empty groups rather than only non-empty ones, because the brief requires
  a group to be visible immediately after creation.
- Use toasts for write failures, because the app already has a toast store for
  this and the failing row may have scrolled out of view.
- Keep `moveResourceToGroup` returning silently in the repository (a guarded
  no-op for a cross-subject move) and surface only genuinely thrown errors, so
  a correctly-refused cross-subject move does not nag.

