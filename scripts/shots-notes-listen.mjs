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

const desktop = await open({ width: 1180, height: 900 });
await desktop.screenshot({ path: 'shots/listen-desktop-idle.png' });
await desktop.screenshot({ path: 'shots/listen-desktop-full.png', fullPage: true });

// Play: the counter should move off zero and Pause should appear.
await desktop.locator('button:has-text("Listen")').first().click();
await desktop.waitForTimeout(500);
const playingLabel = await desktop.locator('button:has-text("Pause")').count();
const counter = await desktop.locator('span.tabular-nums').first().innerText();
console.log('after play ->', { pauseButton: playingLabel, counter });
await desktop.screenshot({ path: 'shots/listen-desktop-playing.png' });

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

const phone = await open({ width: 390, height: 844 });
await phone.screenshot({ path: 'shots/listen-phone-idle.png' });
await phone.locator('button:has-text("Listen")').first().click();
await phone.waitForTimeout(500);
await phone.screenshot({ path: 'shots/listen-phone-playing.png' });
await phone.close();

await browser.close();
stop();
console.log('page errors:', errors.length ? errors : 'none');
console.log('screenshots written to shots/');
process.exit(0);
