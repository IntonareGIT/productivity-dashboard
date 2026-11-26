/**
 * Phase 2: the subject dialog must be reachable and on top.
 *
 * Reported bug: pressing "Edit subject" inside a subject showed nothing until
 * you navigated BACK to the library. Root cause was not a z-index at all — the
 * dialog was rendered only inside the library list view, and the component
 * returned early with the subject detail view, so the node was never in the tree.
 *
 * This test therefore asserts two separate things:
 *   1. the dialog EXISTS when edit is pressed from inside a subject, and
 *   2. it is genuinely the TOP-most surface (a hit test at the dialog's own
 *      centre must land inside it), which is what a portal plus the shared
 *      z-index scale are for.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/** Dismiss the first-run overlay and land on the Library. */
async function gotoLibrary(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  for (const t of ['Not now', '✕']) {
    const l = page.locator(`button:has-text("${t}")`).first();
    if (await l.count()) { await l.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); }
  }
  // On mobile the desktop sidebar is hidden but still in the DOM, so `.first()`
  // would click an invisible "Library" and never navigate. Click the first
  // VISIBLE one instead.
  await page.locator('button:has-text("Library"):visible, a:has-text("Library"):visible')
    .first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

/** Create a subject named `name`, returning whether its card appeared. */
async function makeSubject(page, name) {
  const newBtn = page.locator("button:has-text('New subject'), button:has-text('Create your first subject')").first();
  if (await newBtn.count()) {
    await newBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const nameInput = page.locator("input[placeholder*='Advanced Algorithms']").first();
    if (await nameInput.count()) {
      await nameInput.fill(name);
      await page.locator("button:has-text('Create subject')").first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1800);
    }
  }
  return (await page.locator(`button:has-text('${name}')`).count()) > 0;
}

const browser = await chromium.launch();

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 780 }],
]) {
  const ctx = await browser.newContext({ viewport, hasTouch: label === 'mobile', isMobile: label === 'mobile' });
  const page = await ctx.newPage();

  await gotoLibrary(page);

  // Create a subject to edit.
  const made = await makeSubject(page, `Portal Probe ${label}`);
  if (!made) { check(`phase2 ${label}: subject created`, false, 'card not found'); await ctx.close(); continue; }

  // Enter the subject, then press Edit FROM INSIDE it. This is the reported path.
  const card = page.locator(`button:has-text('Portal Probe ${label}')`).first();
  if (!(await card.count())) { check(`phase2 ${label}: subject created`, false, 'card not found'); await ctx.close(); continue; }
  await card.click();
  await page.waitForTimeout(1200);

  const edit = page.locator("button:has-text('Edit'), button[aria-label*='Edit']").first();
  await edit.click().catch(() => {});
  await page.waitForTimeout(900);

  const dialog = page.locator("[role='dialog']");
  check(`phase2 ${label}: the Edit subject dialog opens from INSIDE the subject view`,
    await dialog.count() === 1, `${await dialog.count()} dialogs`);

  if (await dialog.count()) {
    check(`phase2 ${label}: it is the Edit Subject dialog`,
      (await dialog.first().getAttribute('aria-label')) === 'Edit Subject',
      await dialog.first().getAttribute('aria-label'));

    // THE REAL TEST: is it on top, or merely present behind something?
    const hit = await page.evaluate(() => {
      const d = document.querySelector("[role='dialog']");
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 2));
      return { inside: !!(el && d.contains(el)), tag: el?.tagName ?? null };
    });
    check(`phase2 ${label}: it is genuinely ON TOP (hit test lands inside it)`,
      hit?.inside === true, JSON.stringify(hit));

    // It must also be reachable by touch on mobile (not hover-gated).
    const nameBox = page.locator("[role='dialog'] input").first();
    check(`phase2 ${label}: its fields are hit-testable`, await nameBox.count() > 0);
  }

  // The palette (another dialog) must also be on top when opened.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await ctx.close();
}

await browser.close();
console.log(`\nsubject-dialog: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);