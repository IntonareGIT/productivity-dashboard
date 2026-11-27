/**
 * Screenshot the notes header after the transport moved into it.
 *
 * Starts the dev server, seeds one subject and one long note straight into
 * Dexie, then drives the real Library card and the real split pane with a fake
 * speech engine (headless Chromium has no voices). Prints the measurements that
 * prove the header is pinned, so the result is checkable without eyeballing.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 5191;
const BASE = `http://localhost:${PORT}`;
mkdirSync('shots', { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const stopServer = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };

async function waitForServer() {
  for (let i = 0; i < 160; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev server did not start');
}

const para = (n) => `Section ${n}. A vibrating system is described by its displacement, velocity and acceleration, and every one of them is a function of time. The response depends on the mass, the stiffness and the damping, and on nothing else.`;

const NOTE = [
  '# 1. Fundamentals of vibration',
  '',
  'Vibration is the motion of a body about a reference position. In mechanical systems it is described by displacement, velocity and acceleration, and every one of them can be written as a function of time.',
  '',
  '## 1.1 Elements of a vibrating system',
  '',
  '- **Mass or inertia**: stores kinetic energy, $T = \\frac{1}{2} m \\dot{x}^2$',
  '- **Spring**: stores potential energy, $U = \\frac{1}{2} k x^2$',
  '- **Damper**: removes energy, $c$ is the damping coefficient',
  '',
  'The number of degrees of freedom is the number of independent coordinates needed to describe the motion. A single coordinate means a single degree of freedom, and the simplest case is the spring-mass system.',
  '',
  '## 1.2 Natural frequency',
  '',
  '$$ \\omega_n = \\sqrt{\\frac{k}{m}} $$',
  '',
  'The natural frequency depends only on stiffness and mass, never on the amplitude of the motion. Halving the mass raises the natural frequency by a factor of 1.41.',
  '',
  ...Array.from({ length: 14 }, (_, i) => [`## 1.${i + 3} Worked example ${i + 1}`, '', para(i + 1), '', `$$ k_{${i + 1}} = \\frac{F}{\\delta} = \\frac{2000}{${i + 1}} $$`, ''].join('\n')),
  '## Self-check',
  '',
  '1. What happens to the natural frequency when the spring stiffness is quadrupled?',
  '2. A 2 kg mass hangs on a 800 N/m spring. Find the natural frequency.',
  '',
  '**Answers:** 1. It doubles, because wn is proportional to the square root of k. 2. wn = 20 rad/s.',
].join('\n');

const FAKE_SPEECH = () => {
  const fake = {
    speaking: false,
    paused: false,
    onvoiceschanged: null,
    _timer: 0,
    _utt: null,
    getVoices: () => [
      { name: 'Google US English', lang: 'en-US', voiceURI: 'Google US English', localService: false, default: true },
    ],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak(u) {
      this.speaking = true;
      this._utt = u;
      window.clearTimeout(this._timer);
      // Long enough that the state is stable for the screenshot.
      this._timer = window.setTimeout(() => { this.speaking = false; u.onend?.(new Event('end')); }, 20000);
    },
    cancel() { window.clearTimeout(this._timer); this.speaking = false; this._utt = null; },
    pause() { this.paused = true; window.clearTimeout(this._timer); },
    resume() { this.paused = false; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
};

await waitForServer();
const browser = await chromium.launch();
const errors = [];
const log = (...a) => console.log(...a);

const openPage = async (viewport, mobile = false) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(FAKE_SPEECH);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return page;
};

const seed = async (page) => page.evaluate(async (note) => {
  const { db } = await import('/src/db/db.ts');
  const now = new Date().toISOString();
  await db.topics.clear();
  await db.subjects.clear();
  await db.subjects.add({ id: 'sub-vib', name: 'Mechanical Vibrations', color: '#6366f1', notes: '', createdAt: now, updatedAt: now });
  await db.topics.add({
    id: 'top-1', subjectId: 'sub-vib', title: '1-Fundamentals of vibration', notes: note,
    status: 'studying', order: 0, createdAt: now, updatedAt: now,
  });
  return { subjects: await db.subjects.count(), topics: await db.topics.count() };
}, NOTE);

const openLibraryNote = async (page) => {
  await page.getByRole('button', { name: 'Library' }).first().click();
  await page.waitForTimeout(900);
  await page.getByText('Mechanical Vibrations').first().click();
  await page.waitForTimeout(1500);
};

const measure = async (page) => page.evaluate(() => {
  const main = document.querySelector('main');
  const listen = Array.from(document.querySelectorAll('button')).find((b) => /^(Listen|Pause|Resume)$/.test(b.textContent.trim()));
  const header = listen ? listen.parentElement.parentElement : null;
  const hl = window.CSS && CSS.highlights && CSS.highlights.get('notes-listen');
  return {
    mainScrollTop: main ? Math.round(main.scrollTop) : null,
    noteScrollTop: (() => { const b = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto'); return b ? Math.round(b.scrollTop) : null; })(),
    listenVisible: !!listen,
    listenTop: listen ? Math.round(listen.getBoundingClientRect().top) : null,
    headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
    headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : null,
    highlight: hl ? String(Array.from(hl)[0] ?? '').slice(0, 60) : null,
    viewportH: window.innerHeight,
  };
});

// ---------- Desktop: the Library notes card ----------
const page = await openPage({ width: 1440, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
log('seeded', JSON.stringify(await seed(page)));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await openLibraryNote(page);
await page.screenshot({ path: 'shots/header-library-idle.png' });
log('idle', JSON.stringify(await measure(page)));

await page.locator('button:has-text("Listen")').first().click();
await page.waitForTimeout(800);
log('playing', JSON.stringify(await measure(page)));
await page.screenshot({ path: 'shots/header-library-playing.png' });

// Scroll the note deep: the header must stay, with the transport in it.
await page.evaluate(() => {
  const box = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto');
  if (box) box.scrollTop = 1200;
});
await page.waitForTimeout(900);
log('scrolled', JSON.stringify(await measure(page)));
await page.screenshot({ path: 'shots/header-library-scrolled.png' });

// ---------- Phone: the same card ----------
const phone = await openPage({ width: 390, height: 844 }, true);
await phone.goto(`${BASE}/`, { waitUntil: 'load' });
await phone.waitForTimeout(1200);
log('seeded phone', JSON.stringify(await seed(phone)));
await phone.reload({ waitUntil: 'load' });
await phone.waitForTimeout(1200);
await phone.getByRole('button', { name: 'Library' }).first().click();
await phone.waitForTimeout(900);
await phone.getByText('Mechanical Vibrations').first().click();
await phone.waitForTimeout(1500);
await phone.screenshot({ path: 'shots/header-phone-idle.png' });
await phone.locator('button:has-text("Listen")').first().click();
await phone.waitForTimeout(800);
await phone.evaluate(() => {
  const box = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto');
  if (box) box.scrollTop = 1200;
});
await phone.waitForTimeout(900);
log('phone', JSON.stringify(await measure(phone)));
await phone.screenshot({ path: 'shots/header-phone-scrolled.png' });

// ---------- Split view: the notes pane ----------
try {
  await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; });
  await page.locator('[aria-label="Open split view"]').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shots/header-split-open.png' });
  const addPane = page.locator('[aria-label="Open split view"]');
  if (await addPane.count() > 1) await addPane.nth(1).click();
  await page.waitForTimeout(900);
  const contentSelects = await page.locator('select[aria-label^="Pane"][aria-label$="content"]').count();
  log('panes', contentSelects);
  const idx = contentSelects >= 2 ? 2 : 1;
  await page.selectOption(`select[aria-label="Pane ${idx} content"]`, 'notes');
  await page.waitForTimeout(700);
  await page.locator(`[aria-label="Pane ${idx} document"]`).click();
  await page.waitForTimeout(700);
  const search = page.locator('input[aria-label="Search files and folders"]');
  if (await search.count()) await search.first().fill('Fundamentals');
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"] button').filter({ hasText: '1-Fundamentals of vibration' }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shots/header-split-notes.png' });
  const paneListen = page.locator('button:has-text("Listen")').first();
  await paneListen.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('div')).filter((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY === 'auto');
    scrollers.forEach((s) => { s.scrollTop = 900; });
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shots/header-split-playing.png' });
  log('split', JSON.stringify(await measure(page)));
} catch (e) {
  errors.push(`split: ${e.message}`);
  await page.screenshot({ path: 'shots/header-split-failed.png' });
}

log('ERRORS', JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();
stopServer();
process.exit(0);
