/**
 * Phase 4: subject / type / period in the event form.
 *
 * Asserts the RULES rather than the styling:
 *  - Type only appears once a subject is chosen, and Period only for the
 *    timetabled kinds (lecture / section / lab), never for Studying;
 *  - choosing a period fills the time fields with the shared PERIODS times and
 *    makes them read-only, and "Custom time" re-enables them;
 *  - a second lecture in the same period WARNS but still saves.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/** The six timetabled periods, mirrored here on purpose (see PERIODS). */
const PERIODS = [
  { n: 1, start: '08:30', end: '10:10' },
  { n: 2, start: '10:20', end: '12:00' },
  { n: 3, start: '12:10', end: '13:50' },
  { n: 4, start: '14:00', end: '15:40' },
  { n: 5, start: '15:50', end: '17:30' },
  { n: 6, start: '17:40', end: '19:20' },
];

async function gotoCalendar(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  for (const t of ['Not now', '✕']) {
    const l = page.locator(`button:has-text("${t}")`).first();
    if (await l.count()) { await l.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); }
  }
  await page.locator('button:has-text("Calendar"):visible').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

/** Make sure at least one subject exists, and return its name. */
async function ensureSubject(page) {
  await page.locator('button:has-text("Library"):visible').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1600);
  const nb = page.locator("button:has-text('New subject'), button:has-text('Create your first subject')").first();
  const name = 'Timetable Subject';
  if (await nb.count()) {
    await nb.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    const ni = page.locator("input[placeholder*='Advanced Algorithms']").first();
    if (await ni.count()) {
      await ni.fill(name);
      await page.locator("button:has-text('Create subject')").first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  return name;
}

/** Open the add-event form for today and return the dialog. */
async function openAddForm(page, todayKey) {
  await page.locator(`[data-day-cell="${todayKey}"] span`).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return page.locator("[role='dialog']");
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await gotoCalendar(page);
const subjectName = await ensureSubject(page);
await page.locator('button:has-text("Calendar"):visible').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1600);

const todayKey = await page.locator('[data-day-cell].ring-2').first().getAttribute('data-day-cell');
const dlg = await openAddForm(page, todayKey);

check('phase4: the form has a Subject dropdown',
  await dlg.locator('select[aria-label="Subject"]').count() === 1);
check('phase4: Type is hidden with no subject chosen',
  await dlg.locator('select[aria-label="Type"]').count() === 0);
check('phase4: Period is hidden with no subject chosen',
  await dlg.locator('select[aria-label="Period"]').count() === 0);

// Choosing a subject reveals Type.
await dlg.locator('select[aria-label="Subject"]').selectOption({ label: subjectName });
await page.waitForTimeout(700);
check('phase4: choosing a subject reveals Type',
  await dlg.locator('select[aria-label="Type"]').count() === 1);

// Studying must NOT show a period: it is self-directed.
await dlg.locator('select[aria-label="Type"]').selectOption('studying');
await page.waitForTimeout(600);
check('phase4: Studying shows NO period picker',
  await dlg.locator('select[aria-label="Period"]').count() === 0);

// Lecture shows it, and a period fills the times from the shared list.
await dlg.locator('select[aria-label="Type"]').selectOption('lecture');
await page.waitForTimeout(600);
check('phase4: Lecture shows the Period picker',
  await dlg.locator('select[aria-label="Period"]').count() === 1);

await dlg.locator('select[aria-label="Period"]').selectOption('3');
await page.waitForTimeout(700);
const start = dlg.locator('input[aria-label="Start time"]');
const end = dlg.locator('input[aria-label="End time"]');
const p3 = PERIODS[2];
check('phase4: the period sets the START time from PERIODS',
  (await start.inputValue()) === p3.start, `${await start.inputValue()} vs ${p3.start}`);
check('phase4: the period sets the END time from PERIODS',
  (await end.inputValue()) === p3.end, `${await end.inputValue()} vs ${p3.end}`);
check('phase4: the time fields are READ-ONLY while a period owns them',
  await start.evaluate((el) => el.readOnly) === true);

await dlg.locator("button:has-text('Custom time')").click({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(600);
check('phase4: "Custom time" re-enables the time fields',
  await start.evaluate((el) => el.readOnly) === false);

await dlg.locator("input").first().fill('Physics Lecture P3');
await page.waitForTimeout(300);
await dlg.locator("button:has-text('Add event')").last().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);

// A SECOND lecture in period 3 on the same day must warn, not block.
const dlg2 = await openAddForm(page, todayKey);
await dlg2.locator('select[aria-label="Subject"]').selectOption({ label: subjectName });
await page.waitForTimeout(600);
await dlg2.locator('select[aria-label="Type"]').selectOption('lecture');
await page.waitForTimeout(600);
await dlg2.locator('select[aria-label="Period"]').selectOption('3');
await page.waitForTimeout(1400);
const warned = await dlg2.innerText();
check('phase4: a duplicate period WARNS', /already has/i.test(warned),
  warned.match(/Period 3 already has[^\n]*/)?.[0] ?? 'no warning shown');
check('phase4: the warning does NOT block saving',
  await dlg2.locator("button:has-text('Add event')").last().isEnabled());

await dlg2.locator("input").first().fill('Clashing Lecture P3');
await dlg2.locator("button:has-text('Add event')").last().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1600);
check('phase4: the clashing event still saves (warn, not block)',
  await page.locator("[role='dialog']").count() === 0);

// The day panel must show subject, kind and "Period N".
// Two events fit the two chip slots, so there is no "+x" to press here; the day
// is opened by tapping the cell itself, which is the path a user takes anyway.
await page.locator(`[data-day-cell="${todayKey}"] span`).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(900);
// That opened the add form; close it and use the panel path instead.
if (await page.locator("[role='dialog']").count()) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}
// Open the day panel by pressing Escape-free path: the month view's "+x" is
// absent, so drive the panel through the same handler a tap would.
await page.evaluate((k) => {
  const el = document.querySelector(`[data-day-cell="${k}"]`);
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, todayKey).catch(() => {});
await page.waitForTimeout(600);
if (await page.locator('[data-day-panel]').count() === 0) {
  // Fall back: the day panel is reached from a chip-less cell only via "+x",
  // so create the third event to force one, then press it.
  const d3 = await openAddForm(page, todayKey);
  await d3.locator("input").first().fill('Third Lecture P3');
  await d3.locator("button:has-text('Add event')").last().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const more = page.locator('[data-month-more]');
  for (let i = 0; i < (await more.count()); i += 1) {
    const b = await more.nth(i).boundingBox();
    if (b && b.width > 0) { await more.nth(i).click({ timeout: 8000 }).catch(() => {}); break; }
  }
  await page.waitForTimeout(1300);
}
if (await page.locator('[data-day-panel]').count()) {
  const t = await page.locator('[data-day-panel]').innerText();
  check('phase4: the day panel shows the subject name', t.includes(subjectName));
  check('phase4: the day panel shows the KIND', t.includes('Lecture'));
  check('phase4: the day panel shows "Period 3"', /Period 3/.test(t),
    t.match(/Period 3[^\n]*/)?.[0] ?? '');
} else {
  check('phase4: the day panel opened', false, 'panel not found');
}

await browser.close();
console.log(`\nevent-kind-period: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);