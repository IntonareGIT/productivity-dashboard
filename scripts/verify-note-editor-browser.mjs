/**
 * Real-browser checks for the rich-text note editor.
 *
 * These run against the LIVE editor in Chromium, not a simulation, so they cover
 * what a string assertion cannot: that pressing a button actually changes what is
 * on screen, that the selection survives the press, that the colour palette is
 * not clipped by the toolbar, and that the toolbar scrolls on a phone width.
 *
 * Requires the dev server: `npx vite --port 5199`, then `npm run verify:editor`.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.EDITOR_URL ?? 'http://localhost:5199/editor-test.html';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const browser = await chromium.launch();

/** Select the first `n` characters of the document text. */
const selectFirst = async (page, n) => {
  await page.evaluate((count) => {
    window.__noteEditor.chain().focus().setTextSelection({ from: 1, to: 1 + count }).run();
  }, n);
};

const stored = (page) => page.textContent('#stored');
const screenText = (page) => page.textContent('.ProseMirror');

/**
 * Run `fn` against a fresh page.
 *
 * A NEW CONTEXT per case, not a new page in a shared one: the harness has no
 * storage or service worker, but reusing a context lets state leak between cases
 * and made an early version of this script hang. Each context is closed in a
 * `finally`, because a leaked context keeps a Chromium process alive and the run
 * eventually stalls.
 */
async function withPage(fn, { width = 900, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.ProseMirror', { timeout: 15000 });
    await fn(page, errors);
  } finally {
    await context.close();
  }
  return errors;
}

// ---------------------------------------------------------------- 1. basics
{
  const errors = await withPage(async (page) => {
    check('editor: the ProseMirror surface mounted', await page.isVisible('.ProseMirror'));
    check('editor: initial content rendered', (await screenText(page)).includes('hello world'));
    check('editor: there is NO textarea anywhere', (await page.locator('textarea').count()) === 0);
    const tools = await page.locator('[role="toolbar"] button').count();
    check('editor: the toolbar has buttons', tools >= 14, `${tools} buttons`);
  });
  check('editor: no page errors on load', errors.length === 0, errors.slice(0, 2).join(' | '));
}

// ------------------------------------------------- 2. bold / italic / underline
for (const [label, aria, expectTag] of [
  ['bold', 'Bold', 'STRONG'],
  ['italic', 'Italic', 'EM'],
  ['underline', 'Underline', 'U'],
]) {
  await withPage(async (page) => {
    await selectFirst(page, 5); // "hello"
    await page.click(`[aria-label="${aria}"]`);
    const html = await stored(page);
    check(`${label}: pressing the button changes the stored HTML immediately`,
      html.toLowerCase().includes(expectTag.toLowerCase()), html.slice(0, 70));
    // The selection must SURVIVE the press, which is what preventDefault buys.
    const stillSelected = await page.evaluate(() => {
      const { from, to } = window.__noteEditor.state.selection;
      return to - from;
    });
    check(`${label}: the selection survived the button press`, stillSelected === 5, `selected ${stillSelected}`);
    check(`${label}: the button shows its active state`,
      (await page.getAttribute(`[aria-label="${aria}"]`, 'aria-pressed')) === 'true');
  });
}

// ------------------------------------------------------------- 3. size presets
{
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Font size Large"]');
    const html = await stored(page);
    check('size: Large applies an allowlisted font-size', /font-size:1\.25em/.test(html), html.slice(0, 80));
    check('size: the button reflects the active size',
      (await page.getAttribute('[aria-label="Font size Large"]', 'aria-pressed')) === 'true');
  });
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Font size Huge"]');
    check('size: Huge applies 1.6em', /font-size:1\.6em/.test(await stored(page)));
  });
}

// -------------------------------------------------------- 4. colour popover
{
  await withPage(async (page) => {
    check('palette: closed initially', (await page.locator('[data-color-popover]').count()) === 0);
    await page.click('[aria-label="Text color"]');
    await page.waitForSelector('[data-color-popover]', { timeout: 3000 });
    check('palette: opens on click', await page.isVisible('[data-color-popover]'));
    const swatches = await page.locator('[data-color-popover] button[aria-label^="Color"]').count();
    check('palette: has 8 swatches', swatches === 8, `${swatches}`);

    // It must not be clipped by the toolbar's overflow.
    const clipped = await page.evaluate(() => {
      const r = document.querySelector('[data-color-popover]').getBoundingClientRect();
      return r.width < 100 || r.height < 40 || r.right > window.innerWidth + 1 || r.top < 0;
    });
    check('palette: fully visible and inside the viewport', !clipped);

    // Outside tap closes it.
    await page.mouse.click(5, 5);
    await page.waitForTimeout(150);
    check('palette: closes on an outside click', (await page.locator('[data-color-popover]').count()) === 0);

    // Open again and apply a colour to a real selection.
    await selectFirst(page, 5);
    await page.click('[aria-label="Text color"]');
    await page.waitForSelector('[data-color-popover]', { timeout: 3000 });
    await page.click('[aria-label="Color teal"]');
    const html = await stored(page);
    check('palette: the colour is applied to the selection', /var\(--note-c-teal\)/.test(html), html.slice(0, 80));
    check('palette: no raw hex leaked in', !/#[0-9a-f]{3,6}/i.test(html));
  });
}

// ------------------------------------------------------------ 5. alignment
{
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Align center"]');
    check('align: centre applies text-align:center', /text-align:center/.test(await stored(page)));
    await page.click('[aria-label="Align right"]');
    check('align: right replaces it', /text-align:right/.test(await stored(page)));
    check('align: only one alignment survives',
      ((await stored(page)).match(/text-align:/g) || []).length === 1);
  });
}

// -------------------------------------------------------- 6. lists, heading
{
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Bullet list"]');
    check('list: bullet list wraps the paragraph in <ul>', /<ul>/.test(await stored(page)));
    await page.click('[aria-label="Bullet list"]');
    check('list: toggling off removes it', !/<ul>/.test(await stored(page)));

    await selectFirst(page, 5);
    await page.click('[aria-label="Numbered list"]');
    check('list: numbered list wraps in <ol>', /<ol>/.test(await stored(page)));

    await selectFirst(page, 5);
    await page.click('[aria-label="Heading"]');
    check('heading: applies an <h2>', /<h2>/.test(await stored(page)));
  });
}

// -------------------------------------------------- 7. clear formatting
{
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Bold"]');
    await page.click('[aria-label="Text color"]');
    await page.waitForSelector('[data-color-popover]');
    await page.click('[aria-label="Color rose"]');
    const before = await stored(page);
    check('clear: formatting is present before clearing', /<strong>|--note-c-rose/.test(before));
    await selectFirst(page, 5);
    await page.click('[aria-label="Clear formatting"]');
    const after = await stored(page);
    check('clear: removes the marks', !/<strong>/.test(after) && !/--note-c-rose/.test(after), after.slice(0, 60));
    check('clear: the WORDS survive', after.includes('hello'), after.slice(0, 60));
  });
}

// ------------------------------------------- 8. no tag code is ever visible
{
  await withPage(async (page) => {
    await selectFirst(page, 5);
    await page.click('[aria-label="Bold"]');
    const visible = await screenText(page);
    check('wysiwyg: the user never sees a tag',
      !visible.includes('<') && !visible.includes('style='), visible.slice(0, 60));
    check('wysiwyg: the user sees their text', visible.includes('hello'));
  });
}

// -------------------------------------------- 9. typing and input shortcuts
{
  const typingErrors = await withPage(async (page) => {
    await page.click('.ProseMirror');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('plain text');
    check('typing: characters land in the editor', (await stored(page)).includes('plain text'));

    // "# " heading shortcut
    await page.keyboard.press('Control+A');
    await page.keyboard.type('# Heading one');
    check('shortcut: "# " produces a heading', /<h[1-6]>/.test(await stored(page)), (await stored(page)).slice(0, 50));

    // "- " bullet shortcut
    await page.keyboard.press('Control+A');
    await page.keyboard.type('- first item');
    check('shortcut: "- " produces a bullet list', /<ul>/.test(await stored(page)), (await stored(page)).slice(0, 50));

    // "**bold**" shortcut
    await page.keyboard.press('Control+A');
    await page.keyboard.type('**strong words**');
    check('shortcut: "**" produces bold', /<strong>/.test(await stored(page)), (await stored(page)).slice(0, 50));

    // backtick code
    await page.keyboard.press('Control+A');
    await page.keyboard.type('some `code` here');
    const codeHtml = await stored(page);
    check('typing: backticks produce a <code> element', /<code>/.test(codeHtml), codeHtml.slice(0, 70));
    const codeVisible = await screenText(page);
    check('typing: the backticks are NOT shown to the user', !codeVisible.includes('`'), codeVisible.slice(0, 60));
    check('typing: the code words are shown', codeVisible.includes('code'), codeVisible.slice(0, 60));

    // $math$
    await page.keyboard.press('Control+A');
    await page.keyboard.type('value $x^2$ end');
    await page.waitForTimeout(250);
    // The formula lives in a `data-latex` ATTRIBUTE, and `#stored` only renders
    // text, so assert on the real serialisation and on the rendered span instead.
    const mathSource = await page.evaluate(() => window.__noteEditor.getHTML());
    check('typing: $x^2$ becomes a maths node', /data-latex="x\^2"/.test(mathSource), mathSource.slice(0, 80));
    check('typing: no stray $ delimiter is left behind', !/\$/.test(await stored(page)), await stored(page));
    check('typing: the maths node is visible in the editor',
      (await page.locator('.note-math').count()) >= 1);
    // $$block$$ must become a display maths node, not a half-consumed inline one.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('$$a+b$$');
    await page.waitForTimeout(250);
    const blockSrc = await page.evaluate(() => window.__noteEditor.getHTML());
    check('typing: $$…$$ becomes a display maths node',
      /data-display="true"/.test(blockSrc) && /data-latex="a\+b"/.test(blockSrc), blockSrc.slice(0, 90));
  });
  check('typing: no page errors', typingErrors.length === 0, typingErrors.slice(0, 2).join(' | '));
}

// ----------------------------------------------- 10. theme + phone width
{
  await withPage(async (page) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'studying'));
    await selectFirst(page, 5);
    await page.click('[aria-label="Text color"]');
    await page.waitForSelector('[data-color-popover]');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('theme: the light theme applies', bg !== 'rgba(0, 0, 0, 0)', bg);
    await page.click('[aria-label="Color blue"]');
    check('theme: a colour still applies in light mode', /--note-c-blue/.test(await stored(page)));
  });

  const phoneErrors = await withPage(async (page) => {
    // Toolbar must scroll horizontally, not wrap or clip.
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[role="toolbar"]');
      const cs = getComputedStyle(el);
      return {
        overflowX: cs.overflowX,
        whiteSpace: cs.whiteSpace,
        scrollable: el.scrollWidth > el.clientWidth,
        clientH: el.clientHeight,
      };
    });
    check('phone: the toolbar scrolls horizontally', bar.overflowX === 'auto', JSON.stringify(bar));
    check('phone: the toolbar does not wrap', bar.whiteSpace === 'nowrap', bar.whiteSpace);
    check('phone: the toolbar is one row tall, not stacked', bar.clientH < 90, `${bar.clientH}px`);

    // Controls must stay big enough for a finger.
    const small = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="toolbar"] button'));
      return btns.filter((b) => b.getBoundingClientRect().height < 38).length;
    });
    check('phone: every toolbar control is at least ~40px tall', small === 0, `${small} too small`);

    // The popover must still be fully on screen at phone width.
    await page.click('[aria-label="Text color"]');
    await page.waitForSelector('[data-color-popover]');
    const fits = await page.evaluate(() => {
      const r = document.querySelector('[data-color-popover]').getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 1 && r.width > 100;
    });
    check('phone: the colour palette is not clipped', fits);
  }, { width: 390, height: 780 });
  check('phone: no page errors at phone width', phoneErrors.length === 0, phoneErrors.slice(0, 2).join(' | '));
}

// ------------------------------------------------------- 11. paste safety
{
  await withPage(async (page) => {
    await page.click('.ProseMirror');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>ok <script>window.__pwned=1<\/script>'
        + '<img src=x onerror="window.__pwned=1">'
        + '<span style="color:#ff0000">bad</span>'
        + '<b onclick="window.__pwned=1">click</b></p>');
      document.querySelector('.ProseMirror').dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(350);
    const pwned = await page.evaluate(() => window.__pwned === 1);
    check('paste: no script executed', !pwned);
    const html = await stored(page);
    check('paste: no script tag survives', !/<script/i.test(html), html.slice(0, 90));
    check('paste: no onerror handler survives', !/onerror/i.test(html));
    check('paste: no onclick survives', !/onclick/i.test(html));
    check('paste: no img survives', !/<img/i.test(html));
    check('paste: a literal red hex is stripped', !/#ff0000/i.test(html));
    check('paste: the safe text survives', html.includes('ok'), html.slice(0, 90));
  });
}

await browser.close();
console.log(`\nnote-editor-browser: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

