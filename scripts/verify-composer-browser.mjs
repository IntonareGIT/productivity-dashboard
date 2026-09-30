/**
 * Phase 1: the assistant composer.
 *
 * Verifies in a REAL browser the behaviours that are easy to get wrong:
 * Enter sends, Shift+Enter inserts a newline, and the box grows then scrolls.
 *
 * Driven against `/composer-test.html`, a harness page that mounts the real
 * component with real CSS and a stubbed `send`. Seeding a fake provider row into
 * IndexedDB instead corrupted Dexie's schema, and the composer only reads two
 * plain store flags, so the harness sets those directly.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/composer-test.html';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/** What the stubbed send() recorded. */
const sentSoFar = (page) => page.evaluate(() => window.__sent ?? []);

const browser = await chromium.launch();

// ---- desktop -------------------------------------------------------------
const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(900);

const box = page.locator('textarea[aria-label="Message the assistant"]');
check('phase1: the composer is a TEXTAREA, not an <input>',
  (await page.locator('input[aria-label="Message the assistant"]').count()) === 0
  && (await box.count()) === 1);

if ((await box.count()) === 0) {
  console.log('composer not reachable; skipping interaction checks');
} else {
  await box.click();

  // 1. Shift+Enter must insert a newline and NOT send.
  await box.type('line one');
  await page.keyboard.press('Shift+Enter');
  await box.type('line two');
  const afterShift = await box.inputValue();
  check('phase1: Shift+Enter inserts a real newline',
    afterShift.includes('\n'), JSON.stringify(afterShift));
  check('phase1: Shift+Enter did NOT send (draft still present)',
    afterShift.startsWith('line one') && afterShift.trim().length > 0);
  check('phase1: Shift+Enter called send() zero times', (await sentSoFar(page)).length === 0);

  // 2. The box grows with content, then is capped so it can scroll.
  const h1 = await box.evaluate((el) => el.getBoundingClientRect().height);
  await box.fill('');
  for (let i = 0; i < 14; i += 1) {
    await box.type(`row ${i} of the composer`);
    await page.keyboard.press('Shift+Enter');
  }
  const h2 = await box.evaluate((el) => el.getBoundingClientRect().height);
  check('phase1: the composer GROWS with content', h2 > h1 + 10, `${Math.round(h1)} -> ${Math.round(h2)}`);
  check('phase1: the composer is CAPPED (can scroll, not infinite)',
    h2 <= 150, `${Math.round(h2)}px`);
  check('phase1: it actually scrolls once capped',
    await box.evaluate((el) => el.scrollHeight > el.clientHeight + 1));

  // 3. Enter sends and empties the box.
  await box.fill('send me this');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('phase1: Enter SENDS (draft cleared)', (await box.inputValue()).trim() === '');
  check('phase1: Enter sent exactly the trimmed text',
    JSON.stringify(await sentSoFar(page)) === JSON.stringify(['send me this']),
    JSON.stringify(await sentSoFar(page)));

  // 4. Focus is kept after sending.
  check('phase1: the composer keeps FOCUS after sending',
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label') === 'Message the assistant') === true);

  // 5. IME composition must NOT send.
  await box.fill('composing');
  const before = (await sentSoFar(page)).length;
  await box.evaluate((el) => {
    // Synthesize what a real IME does: keydown with isComposing set.
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { get: () => true });
    el.dispatchEvent(ev);
  });
  await page.waitForTimeout(300);
  check('phase1: Enter during IME composition does NOT send',
    (await sentSoFar(page)).length === before && (await box.inputValue()).trim() === 'composing',
    JSON.stringify(await sentSoFar(page)));
}

// ---- mobile --------------------------------------------------------------
const touch = await browser.newContext({
  viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true,
});
const tpage = await touch.newPage();
await tpage.goto(BASE, { waitUntil: 'load' });
await tpage.waitForTimeout(900);
const tbox = tpage.locator('textarea[aria-label="Message the assistant"]');
if (await tbox.count()) {
  await tbox.click();
  await tbox.fill('mobile draft');
  await tbox.press('Enter');
  await tpage.waitForTimeout(500);
  check('phase1: on TOUCH, Enter inserts a newline instead of sending',
    (await tbox.inputValue()).includes('\n'), JSON.stringify(await tbox.inputValue()));
  check('phase1: on touch the Send button is the way to send',
    await tbox.evaluate(() => !!document.querySelector('button[aria-label="Send message"]')));
} else {
  check('phase1: touch composer reachable', false, 'not found');
}
await touch.close();

// Dexie Cloud rejects a sync preflight from http://127.0.0.1:5173 with a CORS
// error, which surfaces as a "SchemaError: DexieError2" page error. That is a
// PRE-EXISTING local-dev condition (the cloud origin does not allow this
// origin), not a composer defect, so it is excluded here and reported instead.
const realErrors = pageErrors.filter(
  (e) => !/SchemaError: DexieError2/.test(String(e)),
);
check('phase1: no page errors from the composer itself', realErrors.length === 0,
  realErrors.slice(0, 2).join(' | '));
if (pageErrors.length !== realErrors.length) {
  console.log('NOTE  ignoring Dexie Cloud localhost CORS errors (pre-existing): '
    + `${pageErrors.length - realErrors.length}`);
}

await browser.close();
console.log(`\ncomposer-browser: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);