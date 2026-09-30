/**
 * About / Help page verification.
 *
 * This page is a user-facing DESCRIPTION of the app, so its failure mode is
 * silent: it drifts out of date and nobody notices. These checks make drift
 * loud in two ways.
 *
 *  1. STRUCTURE — the required sections are present, the copy lives in ONE data
 *     file rather than JSX, the build date is really injected, and the page uses
 *     theme tokens.
 *  2. ACCURACY — every AI tool the runtime actually registers must be described
 *     on the page, and the copy must not misstate how uploads sync.
 *
 * Run this after any feature change; see the maintenance rule in PROJECT.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

const content = read('src/features/about/helpContent.ts');
const page = read('src/features/about/AboutPage.tsx');
const sidebar = read('src/components/layout/Sidebar.tsx');
const bottomNav = read('src/components/layout/BottomNav.tsx');
const app = read('src/App.tsx');
const settings = read('src/features/settings/SettingsPage.tsx');
const vite = read('vite.config.ts');

// ---------------------------------------------------------------- structure
check('the page is registered as a nav tab', /id: 'about'/.test(sidebar));
check('the tab is routed in App', /case 'about'/.test(app) && /<AboutPage \/>/.test(app));
check('About is hidden from the PHONE bar on purpose', /hideOnMobile/.test(sidebar) && /hideOnMobile/.test(bottomNav));
check('About is still reachable on a phone, via Settings',
  /onOpenAbout/.test(settings) && /onOpenAbout=\{\(\) => setActiveTab\('about'\)\}/.test(app));

check('the version is shown', /Version \{APP_VERSION\}/.test(page) && /APP_VERSION\s*=\s*'/.test(content));
check('the build date is shown', /built \{buildDateLabel\(BUILD_DATE\)\}/.test(page));
check('the build date is injected by Vite', /__BUILD_DATE__/.test(vite) && /toISOString\(\)/.test(vite));
check('the build date has a dev fallback (never throws)', /typeof __BUILD_DATE__ === 'string'/.test(content));
check('a quick start is shown at the top', /Quick start/.test(page) && /QUICK_START/.test(content));
check('the quick start comes before the sections',
  page.indexOf('items={QUICK_START}') > -1
  && page.indexOf('items={QUICK_START}') < page.indexOf('HELP_SECTIONS.map'));

// ------------------------------------------------- content lives in one file
check('the page component holds no feature copy', !/Library is|Sudjects are|Groups are|Ctrl \/ Cmd/.test(page));
check('the content is one data module', /export const HELP_SECTIONS/.test(content) && /export const QUICK_START/.test(content));
check('the page imports its copy from the data module', /from '\.\/helpContent'/.test(page));

// -------------------------------------------------------- required sections
const ids = [...content.matchAll(/^\s+id: '([a-z]+)',$/gm)].map((m) => m[1]);
for (const want of ['library', 'notes', 'calendar', 'shifts', 'focus', 'themes', 'split', 'ai', 'sync', 'pwa', 'gestures', 'limitations']) {
  check(`section present: ${want}`, ids.includes(want));
}
check('Library covers groups', /Groups/.test(content));
check('Library covers PDF and image viewing', /PDF viewer/.test(content) && /Image viewer/.test(content));
check('Notes covers the formatting controls', /Font size/.test(content) && /Alignment/.test(content) && /Colour/.test(content));
check('the limitations section is honest about non-typeset math', /Math is not typeset/.test(content));
check('the limitations section is honest about plain-text AI replies', /Assistant replies are plain text/.test(content));

// --------------------------------------------------------- mobile + theming
check('sections are collapsible (native details/summary)', /<details/.test(page) && /<summary/.test(page));
check('each section is anchored for deep links', /id=\{section\.id\}/.test(page));
check('section headers meet a thumb-sized touch target', /min-h-\[56px\]/.test(page));
check('the page is single-column and scrollable on a phone', /max-w-2xl mx-auto/.test(page));
check('long words cannot overflow', /break-words/.test(page));
check('the page uses theme tokens, not raw colours', !/bg-(slate|gray|zinc|neutral|white|black)-\d/.test(page));
check('the page uses the theme text/border tokens', /text-content-primary/.test(page) && /border-border/.test(page));
check('the divider chevron is decorative', /aria-hidden/.test(page));

/* ------------------------------------------- ACCURACY: the AI tool coverage
 * Every tool the runtime actually registers must be described on the page, or
 * the assistant can do something the documentation never mentions. */
const toolSrc = ['src/features/ai/tools.ts', 'src/features/ai/toolsExtended.ts'].map(read).join('\n');
const toolNames = [...new Set([...toolSrc.matchAll(/name: '([a-z][a-zA-Z]*)'/g)].map((m) => m[1]))];

// Each tool mapped to copy that must exist for it. A tool with no entry here is
// treated as undocumented, so adding a tool without updating this list fails.
const TOOL_PROOF = {
  listSubjects: /List your subjects/i,
  listTopics: /their topics/i,
  getWeekSchedule: /work roster for any week/i,
  getTodaysSchedule: /today's work shift, calendar events and focus minutes/i,
  getFocusStats: /total your focus time/i,
  getSubjectProgress: /progress/i,
  getCurrentStatus: /current status/i,
  setStatus: /switch your current status/i,
  addCalendarEvent: /Add a calendar event/i,
  addResourceLink: /attach a link/i,
  createSubject: /Create a subject/i,
  createTopic: /add a topic/i,
  addTopicNote: /append to a topic/i,
  addAssessment: /add an assessment/i,
  markTopicStatus: /mark a topic as not started, studying or confident/i,
  addPTO: /log paid time off/i,
  addOneOffShiftException: /one-off shift exception/i,
  deleteCalendarEvent: /delete one/i,
  searchLibrary: /search the library by keyword/i,
  getUpcomingDeadlines: /upcoming deadlines/i,
  addOrUpdateWeeklySchedule: /roster for a week/i,
  startPomodoroSession: /Start or stop a focus timer/i,
  stopPomodoroSession: /Start or stop a focus timer/i,
  manage_split_screen: /split view/i,
};
const undocumented = toolNames.filter((n) => !TOOL_PROOF[n] || !TOOL_PROOF[n].test(content));
check('every AI tool the runtime registers is described on the page', undocumented.length === 0,
  undocumented.length ? `undocumented: ${undocumented.join(', ')}` : `${toolNames.length} tools covered`);

/* --------------------------------------------- ACCURACY: the sync wording
 * The copy must NOT claim uploads stay on the device that added them:
 * `blobMode: 'lazy'` offloads them to cloud storage on first sync. */
const syncSection = content.slice(content.indexOf("id: 'sync'"), content.indexOf("id: 'pwa'"));
check('sync page says uploads ARE offloaded to the cloud', /offloaded to cloud storage/.test(syncSection));
// The FALSE claim to catch is a positive assertion that an upload stays local.
// A sentence that *corrects* the misconception ("not only on the device that
// added it") is accurate and must not trip this, so match an assertion rather
// than the words "the device" anywhere in the section.
check('sync page does NOT wrongly claim uploads stay local',
  !/uploads? (stay|remains?|stays?) (local|on this device)|stay on the device that uploaded|never leave the device/.test(syncSection));
check('sync page says everything is local and unsynced when signed out', /entirely local/.test(syncSection));
check('sync page mentions the 20 MB warning the code actually has',
  /20 MB/.test(syncSection) && /LARGE_BLOB_WARNING_BYTES = 20 \* 1024 \* 1024/.test(read('src/db/cloudConfig.ts')));
check('sync page states the AI provider key also syncs', /including the API key/.test(syncSection));

console.log(`\nabout-help: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);