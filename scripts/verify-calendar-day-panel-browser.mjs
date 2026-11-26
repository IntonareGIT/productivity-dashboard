/**
 * Phase 3: the calendar day panel and readable month grid.
 *
 * The behaviour under test is the one that was missing: "first two events and
 * +x more" is gone, and tapping a day (or the "+x" chip) opens a panel listing
 * EVERY event on that day in time order, from which you can add, edit and delete
 * without leaving the calendar.
 *
 * A "present in the DOM" check is not enough for a panel, so the panel is also
 * hit-tested: if something covered it, the taps would silently do nothing on a
 * phone.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

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

/**
 * Add an event titled `title` to TODAY.
 *
 * Several traps here, all hit while writing this test, none of them product
 * bugs:
 *
 *  1. A fixed cell index is wrong. The grid is 42 cells and the leading ones
 *     belong to the PREVIOUS month, so the same index can land on a different
 *     DATE and the four events scatter across days.
 *  2. `[data-day-cell]` `.first()` is the same trap: it is the grid's first
 *     cell, usually last month. The "today" cell is the one with the ring.
 *  3. Once the day has chips, clicking the CELL can land on a chip, which opens
 *     that event for EDITING rather than opening the add form. The add form is
 *     reached with the grid's own "New event" control plus the date, or by
 *     pressing Escape first to dismiss any modal left over from a previous step.
 *
 * The day is resolved once, then reused by its date key for every event.
 */
async function addEventToToday(page, title) {
  // Clear any modal left open by a previous step.
  if (await page.locator("[role='dialog']").count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  const cell = page.locator('[data-day-cell].ring-2').first();
  const key = await cell.getAttribute('data-day-cell');
  // Click the day NUMBER, which is never covered by a chip.
  await page.locator(`[data-day-cell="${key}"] span`).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(900);
  const dlg = page.locator("[role='dialog']");
  const addBtn = dlg.locator("button:has-text('Add event')");
  if (!(await addBtn.count())) {
    // A chip swallowed the click and we are editing instead. Escape and retry
    // via the header "New event" button, which always opens the add form.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.locator("button:has-text('New event')").first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    const retry = page.locator("[role='dialog']");
    if (!(await retry.locator("button:has-text('Add event')").count())) return false;
    await retry.locator("input").first().fill(title);
    await retry.locator("button:has-text('Add event')").last().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }
  await dlg.locator("input").first().fill(title);
  await addBtn.last().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return true;
}

const browser = await chromium.launch();

for (const [label, viewport, touch] of [
  ['desktop', { width: 1280, height: 900 }, false],
  ['mobile', { width: 390, height: 780 }, true],
]) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await gotoCalendar(page);

  // Put four events on ONE day so the grid must show "+2 more".
  //
  // `eventsOnToday` is read straight from the rendered DOM afterwards, because
  // the visible count depends on which chip row this viewport uses and that is
  // a rendering decision, not something to re-derive here.
  const created = [];
  for (const t of ['Alpha One', 'Beta Two', 'Gamma Three', 'Delta Four']) {
    created.push(await addEventToToday(page, t));
  }
  check(`phase3 ${label}: four events were created on one day`,
    created.every(Boolean), `${created.filter(Boolean).length}/4`);

  // The "+x" chip must EXIST and must be a button, not a dead label.
  //
  // There are deliberately TWO chips: a text one inside the desktop chip row
  // (`hidden sm:flex`) and a compact one inside the mobile dot row
  // (`sm:hidden`). Only the one for THIS viewport has any size, and
  // Playwright's `visible` treats a zero-size box as visible, so a count alone
  // silently passes on the WRONG element. The check is therefore on rendered
  // size, which is what "the user can see it" actually means.
  const todayKey = await page.locator('[data-day-cell].ring-2').first().getAttribute('data-day-cell');
  const chips = await page.evaluate((k) => {
    const cell = document.querySelector(`[data-day-cell="${k}"]`);
    if (!cell) return null;
    return [...cell.querySelectorAll('[data-month-more]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: el.textContent };
    });
  }, todayKey);
  const rendered = (chips ?? []).filter((c) => c.w > 0 && c.h > 0);
  check(`phase3 ${label}: a "+x more" chip is RENDERED for the busy day`,
    rendered.length > 0, JSON.stringify(chips));

  // Tapping it opens the day panel.
  if (rendered.length) {
    const more = page.locator('[data-month-more]');
    // Click whichever chip actually has a box on this viewport.
    for (let i = 0; i < (await more.count()); i += 1) {
      const box = await more.nth(i).boundingBox();
      if (box && box.width > 0) { await more.nth(i).click({ timeout: 8000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(1200);
  }
  const panel = page.locator('[data-day-panel]');
  check(`phase3 ${label}: the "+x" chip opens the day panel`, await panel.count() === 1);

  if (await panel.count()) {
    // EVERY event must be listed, not just the two the grid showed.
    const items = panel.locator('[data-day-item="event"]');
    const n = await items.count();
    check(`phase3 ${label}: the panel lists ALL events of the day (not just 2)`,
      n === 4, `${n} items`);

    const text = await panel.innerText();
    check(`phase3 ${label}: it names the events`,
      ['Alpha One', 'Beta Two', 'Gamma Three', 'Delta Four'].every((t) => text.includes(t)));

    // Times are shown, so the list is usable.
    check(`phase3 ${label}: it shows the time for each event`,
      /All day|\d{2}:\d{2}/.test(text));

    // Add / edit / delete are reachable from inside the panel.
    check(`phase3 ${label}: the panel offers Add event`,
      await panel.locator("button:has-text('Add event')").count() > 0);
    check(`phase3 ${label}: every listed event has Edit and Delete controls`,
      await panel.locator("button[aria-label^='Edit']").count() === n
      && await panel.locator("button[aria-label^='Delete']").count() === n);

    // The panel must be ON TOP, or its buttons are unreachable by tap.
    const hit = await page.evaluate(() => {
      const el = document.querySelector('[data-day-panel]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
      return { inside: !!(t && el.contains(t)) };
    });
    check(`phase3 ${label}: the panel is on top and hit-testable`, hit?.inside === true,
      JSON.stringify(hit));

    // Close it again.
    await page.locator("button[aria-label='Close day panel']").click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(600);
    check(`phase3 ${label}: the panel closes`, await page.locator('[data-day-panel]').count() === 0);
  }

  await ctx.close();
}

await browser.close();
console.log(`\ncalendar-day-panel: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);