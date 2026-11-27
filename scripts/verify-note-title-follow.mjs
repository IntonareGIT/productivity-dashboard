/**
 * Real-browser checks that the note TITLE follows the note.
 *
 * The title input owns a local draft so typing is smooth, and it has to adopt
 * changes from outside that draft. There are two kinds, and they pull in
 * opposite directions:
 *
 *  - a DIFFERENT note is open now: the title must always follow it, whatever
 *    the draft says. Before this check existed the input compared its draft
 *    against the NEW note's stored title, saw a difference, read it as "the user
 *    has unsaved edits", and kept the old note's title on screen while the body
 *    under it changed. That is the glitch this verifies.
 *  - the SAME note's stored title changed (a sync landing, a rename made
 *    elsewhere): adopt it only when the user has no unsaved edits of their own.
 *
 * Requires the dev server: `npx vite --port 5199`, then
 * `node scripts/verify-note-title-follow.mjs`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.TITLE_URL ?? 'http://localhost:5199/title-test.html';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// `CHROME_PATH` lets this run where Playwright's bundled Chromium is not
// installed; without it the default browser is used.
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);

const title = (page) => page.inputValue('[aria-label="Note title"]');
const body = (page) => page.textContent('#body');

const errors = [];
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[aria-label="Note title"]', { timeout: 15000 });

  const shotDir = process.env.SHOT_DIR;
  if (shotDir) mkdirSync(shotDir, { recursive: true });

  // ---- 1. the first note is shown in full -------------------------------
  check('1 first note: title shown', (await title(page)) === "Fluid Mechanics II's Notes", await title(page));
  check('1 first note: body shown', (await body(page)).includes('Pumps, motors'), (await body(page)).trim());
  if (shotDir) await page.locator('#pane').screenshot({ path: `${shotDir}/note-a.png` });

  // ---- 2. switching note: the title must follow the body ---------------
  await page.click('#next');
  await page.waitForTimeout(150);
  const switchedTitle = await title(page);
  const switchedBody = await body(page);
  check('2 switch: body changed to the other note', switchedBody.includes('Conduction'), switchedBody.trim());
  check('2 switch: title changed to the other note', switchedTitle === "Heat Transfer's Notes", switchedTitle);
  if (shotDir) await page.locator('#pane').screenshot({ path: `${shotDir}/note-b.png` });

  // ---- 3. and back -----------------------------------------------------
  await page.click('#next');
  await page.waitForTimeout(150);
  check('3 switch back: title follows', (await title(page)) === "Fluid Mechanics II's Notes", await title(page));
  check('3 switch back: body follows', (await body(page)).includes('Pumps, motors'), (await body(page)).trim());

  // ---- 4. an external rename of the OPEN note is adopted ----------------
  await page.click('#rename');
  await page.waitForTimeout(150);
  check('4 external rename: title adopted', (await title(page)) === "Fluid Mechanics II's Notes (renamed)", await title(page));

  // ---- 5. ... but never over the user's own unsaved typing -------------
  await page.fill('[aria-label="Note title"]', 'My own title');
  await page.click('#rename');
  await page.waitForTimeout(150);
  check('5 rename vs typing: the user\'s text wins', (await title(page)) === 'My own title', await title(page));

  // ---- 6. a switch still wins over that typing -------------------------
  // The typed text belongs to the note being left, so the new note's title is
  // what belongs on screen now.
  await page.click('#next');
  await page.waitForTimeout(150);
  check('6 switch after typing: the new note\'s title wins', (await title(page)) === "Heat Transfer's Notes", await title(page));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await page.close();
  await browser.close();
}

console.log(`\nnote-title-follow: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
