/**
 * Autoscroll browser tests for the assistant command bar.
 *
 * Verifies on each surface (bubble, fullscreen, split):
 * 1. After sending, scrollTop equals the maximum (pinned to bottom).
 * 2. Scroll up and confirm it stays put (not auto-scrolling).
 * 3. Click "Jump to latest" and confirm it returns to the bottom.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:5176/autoscroll-test.html';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const testSurface = async (browser, surfaceName, url) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  const list = page.locator('[data-autoscroll-list]').first();
  const input = page.locator('textarea[aria-label="Message the assistant"]');
  const sendBtn = page.locator('button[aria-label="Send message"]');
  const jumpBtn = page.locator('button:has-text("Jump to latest")');

  // Wait for the component to be ready
  await page.waitForTimeout(500);

  check(`${surfaceName}: composer reachable`, await input.count() === 1);
  check(`${surfaceName}: send button reachable`, await sendBtn.count() === 1);
  check(`${surfaceName}: list reachable`, await list.count() === 1);

  if (await input.count() === 0) {
    console.log(`${surfaceName}: composer not reachable; skipping`);
    await context.close();
    return;
  }

  // 1. Send a message and verify autoscroll pins to bottom
  await input.fill('Test message for autoscroll');
  await sendBtn.click();
  await page.waitForTimeout(1000); // Wait for streaming to complete

  // Check scroll position - should be at bottom
  const atBottomAfterSend = await list.evaluate((el) => {
    return el.scrollTop >= el.scrollHeight - el.clientHeight - 5;
  });
  check(`${surfaceName}: after send, pinned to bottom`, atBottomAfterSend);

  // 2. Scroll up and verify it stays put (not auto-scrolling)
  await list.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(500);
  const scrolledUp = await list.evaluate((el) => el.scrollTop === 0);
  check(`${surfaceName}: can scroll up and stays put`, scrolledUp);

  // 3. Check if showJump state is true (via global test helper)
  await page.waitForTimeout(1000);
  const showJump = await page.evaluate(() => window.__assistantShowJump === true);
  check(`${surfaceName}: showJump state is true after scroll up`, showJump);

  // Also verify the button exists in DOM (or simulate jump manually)
  const jumpVisible = await jumpBtn.count() > 0;
  check(`${surfaceName}: Jump to latest button visible`, jumpVisible);
  if (jumpVisible) {
    await jumpBtn.click();
    await page.waitForTimeout(300);
    const atBottomAfterJump = await list.evaluate((el) => {
      return el.scrollTop >= el.scrollHeight - el.clientHeight - 5;
    });
    check(`${surfaceName}: Jump to latest returns to bottom`, atBottomAfterJump);
  } else {
    // Simulate jump manually by scrolling to bottom
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);
    const atBottomAfterJump = await list.evaluate((el) => {
      return el.scrollTop >= el.scrollHeight - el.clientHeight - 5;
    });
    check(`${surfaceName}: manual jump to latest returns to bottom`, atBottomAfterJump);
  }

  const realErrors = pageErrors.filter(
    (e) => !/SchemaError: DexieError2/.test(String(e)),
  );
  check(`${surfaceName}: no page errors`, realErrors.length === 0,
    realErrors.slice(0, 2).join(' | '));

  await context.close();
};

const run = async () => {
  const browser = await chromium.launch();

  // Test each surface
  await testSurface(browser, 'bubble', BASE + '?layout=bubble');
  await testSurface(browser, 'fullscreen', BASE + '?layout=fullscreen');
  await testSurface(browser, 'split', BASE + '?layout=split');

  await browser.close();
  console.log(`\nautoscroll-browser: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});