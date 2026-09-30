/**
 * Capture reference screenshots of the note editor.
 *
 * Development aid, not part of `npm run verify`: it produces PNGs in `shots/`
 * so the editor can be eyeballed without opening the app. Run with the dev
 * server up: `npx vite --port 5199` then `npm run shots`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.EDITOR_URL ?? 'http://localhost:5199/editor-test.html';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();

const type = async (page, text) => {
  await page.click('.ProseMirror');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.waitForTimeout(350);
};

// Desktop: a note using most of the toolbar at once.
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await type(page, '# Study notes\nBare words stay readable. Select text and press a button.\n'
  + '- first bullet\n- second bullet\n\nInline maths $x^2$ and subscripts $y_1 + z$ both render.');
await page.evaluate(() => window.__noteEditor.chain().focus().selectAll().setFontSize('1.25em').run());
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/editor-desktop.png' });

// Colour applied. Picking a swatch leaves the palette OPEN (the user may want to
// try another colour without reopening it), so close it explicitly before the
// next step: a blind `click` on the already-open trigger would otherwise wait for
// it to become actionable and hang.
await page.evaluate(() => window.__noteEditor.chain().focus().selectAll().run());
await page.click('[aria-label="Text color"]');
await page.waitForSelector('[data-color-popover]');
await page.click('[aria-label="Color amber"]');
await page.waitForTimeout(250);
await page.screenshot({ path: 'shots/editor-palette.png' });
await page.keyboard.press('Escape');
await page.waitForSelector('[data-color-popover]', { state: 'detached' });
await page.waitForTimeout(150);

// Light theme.
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'studying'));
await page.mouse.click(5, 5);
await page.waitForTimeout(250);
await page.screenshot({ path: 'shots/editor-light.png' });
await page.close();

// Phone width, palette open, which is the clipping case that mattered.
const phone = await browser.newPage({ viewport: { width: 390, height: 780 } });
await phone.goto(BASE, { waitUntil: 'load' });
await phone.waitForSelector('.ProseMirror');
await type(phone, '# Phone test\nThis is the toolbar at a small screen width.');
await phone.evaluate(() => window.__noteEditor.chain().focus().selectAll().run());
await phone.click('[aria-label="Text color"]');
await phone.waitForSelector('[data-color-popover]');
await phone.screenshot({ path: 'shots/editor-phone.png' });
await phone.close();

await browser.close();
console.log('screenshots written to shots/');
