/**
 * Content for the About / Help page.
 *
 * ALL user-facing copy for that page lives here, deliberately as data rather
 * than JSX. The page component owns layout and interaction; this file owns the
 * words. That split is what makes the page cheap to keep correct.
 *
 * MAINTENANCE RULE (see PROJECT.md): whenever a feature is added, removed or
 * changed, update this file in the same change. The page is a user-facing
 * description of the app, so a feature that ships without a line here is a
 * feature the user cannot discover.
 *
 * Every statement below is backed by the code. Nothing is aspirational.
 */

export interface HelpBullet {
  /** Optional short lead-in, e.g. "Groups". Rendered bold. */
  lead?: string;
  text: string;
}

export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  bullets?: HelpBullet[];
  /** Rendered as a sub-heading, for sections with distinct groups of detail. */
  groups?: { heading: string; bullets: HelpBullet[] }[];
}

export const APP_VERSION = '0.1.0';

/** Shown under the title. Explains in one line who this is for. */
export const APP_TAGLINE =
  'A study and work planner in one place: your subjects, notes, files, timetable, '
  + 'shifts and focus sessions, with an optional AI assistant and optional '
  + 'cross-device sync. Everything works offline and nothing leaves your device '
  + 'unless you turn sync on.';

/** The few things worth doing first. Sits above everything else. */
export const QUICK_START: HelpBullet[] = [
  {
    text: 'Add a subject in the Library, then add topics to it. A subject is a '
      + 'course or project; a topic is a unit of work inside it, and each topic '
      + 'carries its own notes.',
  },
  {
    text: 'Attach links and uploaded files to a topic, and optionally file them '
      + 'into named groups so a topic stays readable.',
  },
  {
    text: 'Set your current status in the sidebar. That drives both the app theme '
      + 'and the focus timer, so the app changes to match what you are doing.',
  },
  {
    text: 'Optional: add an AI provider in Settings, then open the assistant to '
      + 'search your library and create things by asking. The app is fully usable '
      + 'with no provider configured.',
  },
];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'library',
    title: 'Library',
    summary: 'Subjects, topics, resources and groups — the core of the app.',
    groups: [
      {
        heading: 'Subjects and topics',
        bullets: [
          { lead: 'Subjects', text: 'A course, module or project. Each has a name, an optional description, a colour you choose, and its own progress.' },
          { lead: 'Topics', text: 'The units inside a subject (a week, a chapter, a topic). Each has a title, a status — not started, studying or confident — and its own notes.' },
          { lead: 'Progress', text: "A subject's progress is the share of its topics marked confident." },
        ],
      },
      {
        heading: 'Resources and groups',
        bullets: [
          { lead: 'Links', text: 'A title with a URL or file path. Open it in place, or copy the path.' },
          { lead: 'Uploads', text: 'A file stored in the app, with its original name, type and size. You can preview, download, and open it full-screen.' },
          { lead: 'Due dates and completion', text: 'Mark a resource done, and give it a due date. Both are tracked per resource and surfaced on the dashboard.' },
          { lead: 'Tags', text: 'Free-form labels, filterable with the search box above the list.' },
          { lead: 'Groups', text: 'Named folders inside a subject. A resource sits in at most one group, or none. Moving it to another subject clears its group; deleting a group ungroups its resources but never deletes them.' },
        ],
      },
      {
        heading: 'Viewing files',
        bullets: [
          { lead: 'PDF viewer', text: 'Page navigation, zoom, and a full-screen mode. Supports pinch zoom and trackpad zoom.' },
          { lead: 'Image viewer', text: 'Zoom and pan, tuned for very large images so a stray pinch cannot drag the view far away.' },
          { lead: 'On phones', text: "The viewer suppresses the browser's own pinch-zoom over the document so two-finger zoom controls the document, and caps canvas memory so long documents do not blank the tab." },
        ],
      },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    summary: 'Rich-text notes attached to a topic, editable in two places.',
    groups: [
      {
        heading: 'Writing',
        bullets: [
          { lead: 'One note per topic', text: "A note is the notes field of a topic, so it is always in the context of what it belongs to." },
          { lead: 'Rich text, not markup', text: 'Select some words and press a button — bold, italic, underline, a heading, a list, a colour, a size or an alignment — and see the result straight away. You never type or see HTML tags.' },
          { lead: 'Editing', text: 'The same editor appears in the Library and in the split view, and edits save as you type, with a "Saved" indicator. The note title is a normal field above the text and saves on its own.' },
        ],
      },
      {
        heading: 'Formatting',
        bullets: [
          { lead: 'Font size', text: 'Four presets — Small, Normal, Large, Huge — applied to the selected text.' },
          { lead: 'Alignment', text: 'Left, centre or right, applied to the selected lines.' },
          { lead: 'Colour', text: 'Eight colours plus a default, chosen to stay readable in both the light and dark themes. Tap the colour button to open the palette; tap anywhere outside it to close.' },
          { lead: 'Select first', text: 'Highlight the words you want to change before pressing a button. If nothing is selected the change applies to the words the caret sits in, or to the current line for alignment.' },
          { lead: 'Clear formatting', text: 'Removes the formatting and keeps the words.' },
          { lead: 'On phones', text: 'The toolbar is one row you can swipe sideways, so buttons never wrap into a tall stack or disappear off the edge.' },
        ],
      },
      {
        heading: 'Typing shortcuts',
        bullets: [
          { lead: 'Headings', text: 'Type # followed by a space at the start of a line.' },
          { lead: 'Bold', text: 'Type ** around the words: **bold**.' },
          { lead: 'Bullet list', text: 'Type - followed by a space at the start of a line.' },
          { lead: 'Code', text: 'Type ` around the words: `code`. It appears as inline code with a shaded background — the backticks themselves are not shown.' },
          { lead: 'Math', text: 'Type $x$ for inline or $$…$$ on its own line for a block. It appears as highlighted text, not fully typeset — treat it as a readable notation, not a typesetting engine.' },
        ],
      },
      {
        heading: 'How notes are stored',
        bullets: [
          { lead: 'Your original text is kept', text: 'The first time you edit a note, the app converts it and saves the new format. Your original text is never overwritten or deleted, so nothing you have written can be lost.' },
          { lead: 'Opening a note changes nothing', text: 'A note you only read is left exactly as it was. The conversion is saved the first time you actually edit it.' },
          { lead: 'Pasted content is cleaned', text: 'Only a fixed set of formatting is allowed through when a note is loaded or displayed, so pasted web content cannot carry scripts or tracking into your notes.' },
        ],
      },
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar and lectures',
    summary: 'Month and week views for classes, deadlines, work and personal events.',
    bullets: [
      { lead: 'Views', text: "Month and week. The dashboard shows a strip of everything happening today." },
      { lead: 'Categories', text: 'Class, deadline, personal or work — each is colour-coded.' },
      { lead: 'Repeating events', text: 'Daily, weekly, monthly or yearly, with a custom interval. A repeating event is stored once; its occurrences are worked out as needed.' },
      { lead: 'Links to your subjects', text: 'An event can point at a subject or topic, which is how the assistant can talk about what is due when.' },
    ],
  },
  {
    id: 'shifts',
    title: 'Work shifts',
    summary: 'A repeating weekly roster, with one-off changes and paid time off.',
    bullets: [
      { lead: 'Weekly roster', text: 'Set one week at a time: which two days are off, when the shift starts and how long it runs. Every week is an independent record, so nothing has to be copied forward by hand.' },
      { lead: 'One-off changes', text: 'Override a single date with custom hours, or mark it off for that day only.' },
      { lead: 'Paid time off', text: 'Log PTO for a date. PTO always wins over everything else and is never counted as scheduled hours.' },
      { lead: 'Hours', text: "The dashboard shows this week's scheduled hours, resolved from the roster and any overrides." },
    ],
  },
  {
    id: 'focus',
    title: 'Pomodoro and focus',
    summary: 'A focus timer that logs what you actually worked on.',
    bullets: [
      { lead: 'Timer', text: 'Focus, short break and long break phases. The long break comes after a set number of focus cycles.' },
      { lead: 'Your durations', text: 'All three phase lengths and the cycles-per-long-break are configurable in Settings.' },
      { lead: 'Focus target', text: 'Optionally pick a subject and a topic before you start. The choice is stored on the session, so you can see afterwards where the time went.' },
      { lead: 'History', text: 'Completed sessions are logged and can be totalled per subject over any date range — on the dashboard and in the Focus page.' },
      { lead: 'Theme follows status', text: 'Your selected status chooses the theme, so the whole app changes as you switch between studying, working, researching and playing.' },
    ],
  },
  {
    id: 'themes',
    title: 'Themes',
    summary: 'Four themes, each in a light and a dark variant.',
    bullets: [
      { lead: 'The four themes', text: 'Studying, Working, Researching and Playing.' },
      { lead: 'Status drives the theme', text: 'You pick your current status, and each status is mapped to a theme. Changing the status changes the whole app, including the assistant panel.' },
      { lead: 'Light and dark', text: "Each theme has both. The choice is yours, not the system's, so it stays put across devices." },
      { lead: 'Everything is token-driven', text: 'Surfaces, borders, text and accents all come from theme tokens, so a new theme is a set of values rather than a rewrite.' },
    ],
  },
  {
    id: 'split',
    title: 'Split view',
    summary: 'Two panes side by side, for working with a document and something else at once.',
    bullets: [
      { lead: 'What each pane can show', text: "Nothing, the dashboard, a PDF, an image, a topic's notes, or the assistant." },
      { lead: 'Opening it', text: "From a resource's \"Split with notes\" action, from the assistant, or from the dashboard." },
      { lead: 'Adjusting it', text: 'Drag the divider, or nudge it with the arrow keys when it is focused. Panes can be maximised, swapped, or closed.' },
      { lead: 'On a phone', text: 'The two panes stack instead of sitting side by side, and the divider is dragged with a thumb-sized handle.' },
      { lead: 'Deliberately temporary', text: 'The split is never saved. Refreshing the page returns you to the normal single-pane dashboard — this is on purpose, so the app always starts where you expect.' },
    ],
  },
  {
    id: 'ai',
    title: 'AI assistant',
    summary: 'Optional. Talks to a model you configure yourself, and can act on your data.',
    bullets: [
      { lead: 'It is optional', text: 'Every feature works without it. Nothing is sent anywhere unless you configure a provider and start a conversation.' },
      { lead: 'Your provider, your key', text: "Settings → AI Providers takes a label, a base URL, an API key and a model name, and it speaks the OpenAI-style /chat/completions format. Any service offering that endpoint works, including Google's Gemini models. One provider is marked as the default; the rest are kept so you can switch." },
      { lead: 'Your data, on request', text: 'The assistant reads your library and calendar when a question needs it, and writes only when you ask it to. Anything destructive — deleting an event, logging time off, changing a shift — asks you to confirm first.' },
      { lead: 'Thinking shown', text: "When a model returns its reasoning, it appears in a collapsible block above the answer rather than being hidden or mixed into the reply." },
      { lead: 'History', text: 'Conversations are saved so you can go back to them, and can be deleted from Settings → Assistant Chat History.' },
    ],
    groups: [
      {
        heading: 'What it can do (the tools it has)',
        bullets: [
          { lead: 'Look things up', text: "List your subjects and their topics; see today's work shift, calendar events and focus minutes so far; resolve a work roster for any week; total your focus time for a date range; get a subject's progress; list upcoming deadlines; and search the library by keyword across subjects, topics, notes, resources and assessments." },
          { lead: 'Library', text: "Create a subject, add a topic, append to a topic's notes, attach a link, add an assessment (exam, quiz, assignment or project), mark a topic as not started, studying or confident, or search everything at once." },
          { lead: 'Editing your library', text: 'Rename a subject, a topic or a resource; move a resource to another topic; and work with resource groups: list them, create one, rename it, or move a resource into one or back out to no group.' },
          { lead: 'Deleting', text: 'Delete a subject, a topic, a resource or a group. Every one of these shows you a confirmation card first and only runs when you press Confirm; the assistant cannot carry it out on its own. Deleting a subject removes its topics, resources, uploaded files, notes and groups with it. Deleting a group only removes the group: its resources are kept and become ungrouped.' },
          { lead: 'If a name is ambiguous', text: 'You can refer to something by its id or by its name. If a name matches more than one thing, the assistant asks you to pick from a list instead of guessing, and changes nothing until you do.' },
          { lead: 'Calendar and shifts', text: 'Add a calendar event or delete one, set the work roster for a week, log paid time off, and apply a one-off shift exception.' },
          { lead: 'Focus and status', text: 'Start or stop a focus timer, and switch your current status — which also changes the theme.' },
          { lead: 'Split view', text: 'Open, close or swap the split view, and put a specific document into a pane.' },
        ],
      },
    ],
  },
  {
    id: 'sync',
    title: 'Sync and multiple devices',
    summary: 'Optional. Sign in to keep two devices in step.',
    bullets: [
      { lead: 'It is optional', text: 'Signed out, the app is entirely local: everything lives in this browser and nothing leaves the device.' },
      { lead: 'What syncs', text: 'When signed in, all of it: subjects, topics, notes, resources, groups, assessments, calendar events, shift rosters and overrides, focus sessions, themes, settings, your assistant conversations, and your AI provider details.' },
      { lead: 'Uploaded files', text: 'Uploaded file bytes are offloaded to cloud storage the first time a file syncs, so an upload is available on your other device too. That first upload is what takes time with a large file, which is why the app warns above 20 MB.' },
      { lead: 'Worth knowing', text: "A file you upload is stored in your own cloud account, not only on the device that added it. If you would rather keep uploads on one device, stay signed out — the app keeps working locally." },
      { lead: 'AI provider keys', text: 'Provider records, including the API key, sync with the rest of your data. They stay inside your own account, and nothing syncs at all while you are signed out.' },
      { lead: 'Export and import', text: 'Settings has a backup section that exports your data to a JSON file and imports it back.' },
    ],
  },
  {
    id: 'pwa',
    title: 'Installing on your phone',
    summary: 'The app is an installable web app and opens offline.',
    bullets: [
      { lead: 'iPhone or iPad (Safari)', text: 'Open the app, then Share → Add to Home Screen. It appears as its own icon and opens without browser chrome.' },
      { lead: 'Android (Chrome)', text: 'Open the app, then the browser menu → Install app, or Add to Home screen.' },
      { lead: 'Desktop', text: 'The install icon in the address bar, or the app menu → Install.' },
      { lead: 'Offline', text: 'The interface is cached so the app opens and looks right without a connection. Your data is already on the device. Cloud sync and the assistant need a connection; sync requests are deliberately never served from the cache, so nothing stale is ever shown.' },
      { lead: 'Updates', text: 'Updates install themselves the next time you open the app.' },
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures and shortcuts',
    summary: 'Touch gestures in the document viewers, and the keyboard shortcuts.',
    groups: [
      {
        heading: 'In the PDF and image viewers',
        bullets: [
          { lead: 'Pinch to zoom', text: 'Two fingers zoom the document around the point between them. Releasing commits the zoom where you left it.' },
          { lead: 'Scroll and pan', text: 'One finger drags the document; on a computer the trackpad or wheel does the same, and a wheel gesture is treated as a zoom rather than a scroll.' },
          { lead: 'Full screen', text: 'The full-screen button in the viewer removes the surrounding app for as long as you need it. Where the browser has no full-screen API, the viewer fills the window instead.' },
        ],
      },
      {
        heading: 'Keyboard',
        bullets: [
          { lead: 'Ctrl / Cmd + K', text: 'Open the command palette for quick actions.' },
          { lead: 'Arrow keys', text: 'Nudge the split-view divider when it is focused; hold Shift for larger steps.' },
          { lead: 'Enter in a note title', text: 'Commits the title and moves on.' },
          { lead: 'Escape', text: 'Closes an open menu or popover.' },
        ],
      },
    ],
  },
  {
    id: 'limitations',
    title: 'Known limitations',
    summary: 'Things that are deliberately simple, or not done yet.',
    bullets: [
      { lead: 'Math is not typeset', text: 'Equations are shown as styled, readable text rather than fully formatted mathematics. It is a notation aid, not a maths renderer.' },
      { lead: 'Formatting is a small set', text: 'Size, alignment and colour only. There is no bold/italic button, because bold and italic are already written in markdown.' },
      { lead: 'Groups do not nest', text: 'A group belongs to a subject and cannot contain other groups. A resource is in one group or none.' },
      { lead: 'The split view is not remembered', text: 'It closes on refresh by design.' },
      { lead: 'One recurring rule per event', text: 'A repeating calendar event uses a single recurrence rule; it cannot yet hold several exception dates inside one series.' },
      { lead: 'Offline is interface-only', text: 'The app opens offline, but sync and the assistant need a connection.' },
      { lead: 'Assistant replies are plain text', text: 'The assistant answers as formatted plain text. It does not yet share the note renderer, so its output is not styled as richly as a note.' },
      { lead: 'Single browser profile', text: 'Data lives in this browser. Clearing site data, or using a private window, means starting fresh — use the backup export if that data matters to you.' },
    ],
  },
];

/** Shown in the footer. One obvious place to update. */
export const HELP_FOOTER =
  'This page describes the app as it is right now. If a feature you expected is '
  + 'not listed above, it is not built yet.';

/** Injected at build time by Vite (see `vite.config.ts`). */
declare const __BUILD_DATE__: string;

/**
 * The build date, injected at build time by Vite.
 * Falls back to a placeholder in dev/tests where the define is absent, so this
 * module never throws just because the bundle was not produced by Vite.
 */
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'development build';
