/**
 * Phase 5: assessments on the calendar.
 *
 * The load-bearing requirement is that calendar items are DERIVED from the
 * assessments table, never copied into calendarEvents. So the test does not just
 * check that a chip appears: it CHANGES the assessment's date and asserts the
 * chip moves to the new day and leaves the old one, which is only possible if
 * nothing was duplicated.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAhead = (n) => ymd(new Date(Date.now() + n * 86400000));

async function dismissFirstRun(page) {
  for (const t of ['Not now', '✕']) {
    const l = page.locator(`button:has-text("${t}")`).first();
    if (await l.count()) { await l.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); }
  }
}

const toLibrary = (page) =>
  page.locator('button:has-text("Library"):visible').first().click({ timeout: 8000 }).catch(() => {})
    .then(() => page.waitForTimeout(1500));

const toCalendar = (page) =>
  page.locator('button:has-text("Calendar"):visible').first().click({ timeout: 8000 }).catch(() => {})
    .then(() => page.waitForTimeout(1800));

async function makeSubject(page, name) {
  await toLibrary(page);
  const nb = page.locator("button:has-text('New subject'), button:has-text('Create your first subject')").first();
  if (!(await nb.count())) return false;
  await nb.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const ni = page.locator("input[placeholder*='Advanced Algorithms']").first();
  if (!(await ni.count())) return false;
  await ni.fill(name);
  await page.locator("button:has-text('Create subject')").first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1600);
  return true;
}

/** Create an assessment through the subject's own form. */
async function makeAssessment(page, subjectName, name, date) {
  await toLibrary(page);
  await page.locator(`button:has-text('${subjectName}')`).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // The card's action button is labelled simply "Assessment" (a Plus icon
  // precedes it), not "New assessment".
  const add = page.locator("button:has-text('Assessment'), button:has-text('New assessment'), button:has-text('Add assessment')").first();
  if (!(await add.count())) return false;
  await add.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const dlg = page.locator("[role='dialog']");
  if (!(await dlg.count())) return false;
  await dlg.locator("input").first().fill(name);
  await dlg.locator('select').first().selectOption('quiz');
  await dlg.locator("input[aria-label='Date']").fill(date);
  // The real button label is "Add assessment", not "Create"/"Save".
  await dlg.locator("button:has-text('Add assessment'), button:has-text('Create'), button:has-text('Save')").last()
    .click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  // The dialog must be gone, otherwise the assessment was never saved.
  return (await page.locator("[role='dialog']").count()) === 0;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2200);
await dismissFirstRun(page);

const subjectName = 'Assessment Subject';
check('phase5: a subject was created', await makeSubject(page, subjectName));

const dateKey = daysAhead(3);
const newKey = daysAhead(9);

check('phase5: an assessment with a date was created',
  await makeAssessment(page, subjectName, 'Midterm Quiz', dateKey));

// The subject view should show a countdown.
await toLibrary(page);
await page.locator(`button:has-text('${subjectName}')`).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
const subjectText = await page.locator('body').innerText();
check('phase5: the subject view shows a "days left" countdown',
  /In \d+ days|Tomorrow|Today/.test(subjectText),
  subjectText.match(/In \d+ days|Tomorrow|Today/)?.[0] ?? 'none');

// The calendar must show it on its date.
await toCalendar(page);
const onTarget = page.locator(`[data-day-cell="${dateKey}"] [data-month-assessment]`);
check('phase5: the assessment appears on the calendar on its date',
  await onTarget.count() > 0, `${await onTarget.count()} chips on ${dateKey}`);
const chipText = (await onTarget.count())
  ? (await onTarget.first().innerText()).replace(/\s+/g, ' ')
  : '';
check('phase5: the chip is labelled with the assessment type and name',
  /Quiz/i.test(chipText) && /Midterm/.test(chipText), chipText.slice(0, 60));

// THE DERIVATION TEST: change the date; the chip must MOVE, not duplicate.
await toLibrary(page);
await page.locator(`button:has-text('${subjectName}')`).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator("button[aria-label='Edit assessment']").first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(900);
const edlg = page.locator("[role='dialog']");
if (await edlg.locator('input[aria-label="Date"]').count()) {
  await edlg.locator("input[aria-label='Date']").fill(newKey);
  await edlg.locator("button:has-text('Save'), button:has-text('Add assessment'), button:has-text('Create')").last()
    .click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
await toCalendar(page);
await page.waitForTimeout(1200);
const onOld = await page.locator(`[data-day-cell="${dateKey}"] [data-month-assessment]`).count();
const onNew = await page.locator(`[data-day-cell="${newKey}"] [data-month-assessment]`).count();
check('phase5: changing the date MOVES the chip (derived, not copied)',
  onOld === 0 && onNew > 0, `old=${onOld} new=${onNew}`);

await browser.close();
console.log(`\nassessments-calendar: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);