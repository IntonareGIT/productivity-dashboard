/**
 * Screenshot and click through the Listen control.
 *
 * Development aid, not part of `npm run verify`: it starts the dev server, opens
 * `listen-test.html` with a fake speech engine (headless Chromium has no voices),
 * drives the real component, and writes PNGs to `shots/`. It also prints the
 * state transitions it observed, so a broken queue shows up here rather than in
 * a screenshot nobody reads.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
mkdirSync('shots', { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stop = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/listen-test.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev server did not start');
}

await waitForServer();

const browser = await chromium.launch();
const errors = [];

const open = async (viewport, theme) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/listen-test.html?fake=1`, { waitUntil: 'load' });
  await page.waitForSelector('button:has-text("Listen")');
  if (theme === 'light') {
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    await page.waitForTimeout(200);
  }
  return page;
};

// The counter text ("4 / 23") and the highlight the browser is painting.
const counterOf = async (page, n = 0) =>
  (await page.locator('span.tabular-nums').nth(n).innerText()).replace(/\s+/g, ' ').trim();
const highlightState = (page) =>
  page.evaluate(() => {
    const reg = window.CSS && CSS.highlights;
    if (!reg) return { supported: false };
    const hl = reg.get('notes-listen');
    if (!hl) return { supported: true, present: false };
    const ranges = Array.from(hl);
    const first = ranges[0];
    return {
      supported: true,
      present: true,
      ranges: ranges.length,
      text: first ? String(first).replace(/\s+/g, ' ').trim().slice(0, 120) : null,
    };
  });

const desktop = await open({ width: 1180, height: 900 });
await desktop.screenshot({ path: 'shots/listen-desktop-idle.png' });
await desktop.screenshot({ path: 'shots/listen-desktop-full.png', fullPage: true });

// Play: the counter should move off zero and Pause should appear.
await desktop.locator('button:has-text("Listen")').first().click();
await desktop.waitForTimeout(500);
const playingLabel = await desktop.locator('button:has-text("Pause")').count();
const counter = await counterOf(desktop);
console.log('after play ->', { pauseButton: playingLabel, counter });
console.log('highlight after play ->', await highlightState(desktop));
await desktop.screenshot({ path: 'shots/listen-desktop-playing.png' });

// Navigation: next sentence advances the counter by one, previous goes back.
await desktop.locator('button[aria-label="Next sentence"]').first().click();
await desktop.waitForTimeout(250);
const afterNext = await counterOf(desktop);
await desktop.locator('button[aria-label="Next sentence"]').first().click();
await desktop.waitForTimeout(250);
const afterNext2 = await counterOf(desktop);
await desktop.locator('button[aria-label="Previous sentence"]').first().click();
await desktop.waitForTimeout(250);
const afterPrev = await counterOf(desktop);
// Next paragraph jumps several sentences at once.
await desktop.locator('button[aria-label="Next paragraph"]').first().click();
await desktop.waitForTimeout(250);
const afterParagraph = await counterOf(desktop);
const paragraphHighlight = await highlightState(desktop);
await desktop.screenshot({ path: 'shots/listen-desktop-paragraph.png' });
// Restart goes back to the first sentence.
await desktop.locator('button[aria-label="Start from the beginning"]').first().click();
await desktop.waitForTimeout(250);
const afterRestart = await counterOf(desktop);
console.log('navigation ->', { afterNext, afterNext2, afterPrev, afterParagraph, afterRestart, paragraphHighlight });

// Pause: the same button becomes Resume.
await desktop.locator('button:has-text("Pause")').first().click();
await desktop.waitForTimeout(200);
console.log('after pause ->', { resumeButton: await desktop.locator('button:has-text("Resume")').count() });
await desktop.screenshot({ path: 'shots/listen-desktop-paused.png' });

// Speed change while paused, then resume and stop.
await desktop.locator('select[aria-label="Reading speed"]').first().selectOption('1.5');
await desktop.locator('button:has-text("Resume")').first().click();
await desktop.waitForTimeout(300);
await desktop.locator('button[aria-label="Stop reading"]').first().click();
await desktop.waitForTimeout(200);
console.log('after stop ->', { listenButton: await desktop.locator('button:has-text("Listen")').count() });
await desktop.close();

const light = await open({ width: 1180, height: 640 }, 'light');
await light.locator('button:has-text("Listen")').first().click();
await light.waitForTimeout(400);
await light.screenshot({ path: 'shots/listen-desktop-light.png' });
await light.close();

// Start from a selection: select part of a sentence in note 2, then press
// Listen. The counter should start at that sentence, not at 1.
const selection = await open({ width: 1180, height: 900 });
await selection.locator('[data-testid="select-sentence"]').click();
await selection.waitForTimeout(150);
const selected = await selection.evaluate(() => String(window.getSelection() ?? ''));
await selection.locator('button:has-text("Listen")').nth(1).click();
await selection.waitForTimeout(400);
const selectionCounter = await counterOf(selection);
const selectionHighlight = (await highlightState(selection)).text;
console.log('selection start ->', { selected, selectionCounter, selectionHighlight });
await selection.screenshot({ path: 'shots/listen-desktop-selection.png' });
await selection.close();

const phone = await open({ width: 390, height: 844 });
await phone.screenshot({ path: 'shots/listen-phone-idle.png' });
await phone.locator('button:has-text("Listen")').first().click();
await phone.waitForTimeout(500);
await phone.screenshot({ path: 'shots/listen-phone-playing.png' });
console.log('phone highlight ->', await highlightState(phone));
await phone.close();

await browser.close();
stop();
console.log('page errors:', errors.length ? errors : 'none');
console.log('screenshots written to shots/');
process.exit(0);
