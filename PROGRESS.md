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

