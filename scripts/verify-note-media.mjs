/**
 * Note rich-media verification.
 *
 * Covers the sanitizer changes that made images, highlights and callouts
 * possible. The sanitizer is the security boundary for stored note HTML, so this
 * script is weighted towards the REJECTION cases: every way an image `src` could
 * be abused, and every way the new `data-*` and `background-color` channels could
 * be used to smuggle something through.
 *
 * Run against the REAL module, not a re-implementation, so the regexes under test
 * are the ones that run in the browser.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'note-media-'));
const root = process.cwd().replace(/\\/g, '/');

const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `
export { sanitizeEditorHtml, safeImageSrc, sanitizeStyleAttr } from '${root}/src/features/library/noteEditor/sanitizeHtml';
export { NOTE_COLORS, NOTE_HIGHLIGHTS, CALLOUTS, ARROW_SYMBOLS, imageAlignAttr } from '${root}/src/features/library/noteEditor/noteFormatShared';
`);

const bundle = join(outDir, 'out.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'silent',
});

// A `file://` URL is required here: `import()` on a bare Windows path such as
// `C:/...` is rejected by the ESM loader as an unsupported URL scheme.
const m = await import(`file://${bundle.replace(/\\/g, '/')}`);
const { sanitizeEditorHtml, safeImageSrc, sanitizeStyleAttr } = m;

let pass = 0;
const fails = [];
const check = (name, got, want) => {
  const ok = got === want || (want instanceof RegExp && want.test(got));
  if (ok) pass++;
  else fails.push(`${name}\n     got:  ${got}\n     want: ${want}`);
};

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const HL = 'background-color:var(--note-hl-yellow)';
const RED = '<span style="color:var(--note-c-red)">x</span>';

// ---- 1. Highlight ---------------------------------------------------------
check('highlight token survives',
  sanitizeEditorHtml(`<p><mark style="${HL}">hi</mark></p>`),
  `<p><mark style="${HL}">hi</mark></p>`);
check('arbitrary background is stripped',
  sanitizeEditorHtml('<mark style="background-color:red">x</mark>'), '<mark>x</mark>');
check('background url() is stripped',
  sanitizeEditorHtml('<mark style="background-color:url(http://x)">x</mark>'), '<mark>x</mark>');
check('unknown highlight token is stripped',
  sanitizeEditorHtml('<mark style="background-color:var(--note-hl-pink)">x</mark>'), '<mark>x</mark>');

// ---- 2. Red text ----------------------------------------------------------
check('red text token survives', sanitizeEditorHtml(RED), RED);
check('palette contains red', m.NOTE_COLORS.includes('red'), true);
check('warning box is red', m.CALLOUTS.warning.border.includes('ef4444'), true);
// ---- 3. Image src allowlist ----------------------------------------------
check('data png allowed', safeImageSrc(PNG), PNG);
check('blob allowed', safeImageSrc('blob:1234abcd-00ff'), 'blob:1234abcd-00ff');
check('svg data url rejected', safeImageSrc('data:image/svg+xml;base64,PHN2Zz4='), null);
check('http rejected', safeImageSrc('http://evil.test/x.png'), null);
check('https rejected', safeImageSrc('https://evil.test/x.png'), null);
check('javascript rejected', safeImageSrc('javascript:alert(1)'), null);
check('data:text/html rejected', safeImageSrc('data:text/html,<script>x</script>'), null);
check('blank rejected', safeImageSrc(''), null);

// The sanitizer always emits an explicit `alt`, defaulting to empty, so a
// decorative image reads as decorative to a screen reader rather than as an
// unlabelled graphic.
const IMG = (extra = '') => `<img src="${PNG}"${extra}>`;
const IMG_OUT = (extra = '') => `<img src="${PNG}" alt=""${extra}>`;
check('img with good src survives',
  sanitizeEditorHtml(IMG(' alt="a"')), `<img src="${PNG}" alt="a">`);
check('img with evil src is removed entirely',
  sanitizeEditorHtml('<img src="https://evil.test/beacon.png">'), '');
check('img onerror is dropped', sanitizeEditorHtml(IMG(' onerror="alert(1)"')), IMG_OUT());
check('img class is dropped', sanitizeEditorHtml(IMG(' class="x"')), IMG_OUT());
check('img with bogus align is dropped', sanitizeEditorHtml(IMG(' data-align="middle"')), IMG_OUT());
check('img float align survives',
  sanitizeEditorHtml(IMG(' data-align="left"')), IMG_OUT(' data-align="left"'));

// ---- 3b. Resized image size --------------------------------------------
// A resized image persists its size as the standard width/height attributes, so
// the sanitizer must keep them -- bounded, so they cannot be used to blow up the
// layout.
const RESIZED = `<img src="${PNG}" alt="" width="250" height="125">`;
check('resized image keeps its size', sanitizeEditorHtml(RESIZED), RESIZED);
check('width is floored at 1', sanitizeEditorHtml(IMG(' width="-40"')), IMG_OUT(' width="1"'));
check('width is capped', sanitizeEditorHtml(IMG(' width="99999999"')), IMG_OUT(' width="100000"'));
check('non-numeric width is dropped', sanitizeEditorHtml(IMG(' width="abc"')), IMG_OUT());
check('css width is not smuggled through style', sanitizeEditorHtml(IMG(' style="width:400px"')), IMG_OUT());
check('zero width is floored to 1', sanitizeEditorHtml(IMG(' width="0"')), IMG_OUT(' width="1"'));

// ---- 4. data-callout ------------------------------------------------------
check('callout div survives',
  sanitizeEditorHtml('<div data-callout="warning"><p>x</p></div>'),
  '<div data-callout="warning"><p>x</p></div>');
check('bogus callout variant dropped',
  sanitizeEditorHtml('<div data-callout="evil"><p>x</p></div>'), '<div><p>x</p></div>');
check('arbitrary data attribute dropped',
  sanitizeEditorHtml('<div data-evil="1"><p>x</p></div>'), '<div><p>x</p></div>');
check('callout quote-injection neutralised',
  sanitizeEditorHtml('<div data-callout="note&quot; onload=&quot;alert(1)"><p>x</p></div>'),
  '<div><p>x</p></div>');

// ---- 5. style allowlist ---------------------------------------------------
check('max-width 45% kept', sanitizeStyleAttr('max-width:45%'), 'max-width:45%');
check('max-width 400px dropped', sanitizeStyleAttr('max-width:400px'), null);
check('float dropped', sanitizeStyleAttr('float:left'), null);
check('position dropped', sanitizeStyleAttr('position:absolute'), null);
check('color red kept, position fixed dropped',
  sanitizeStyleAttr('color:var(--note-c-red);position:fixed'), 'color:var(--note-c-red)');

// ---- 6. legacy behaviour must not regress --------------------------------
check('plain note unchanged',
  sanitizeEditorHtml('<p>hello <strong>world</strong></p>'),
  '<p>hello <strong>world</strong></p>');
check('script still removed with content',
  sanitizeEditorHtml('<p>a</p><script>alert(1)</script>'), '<p>a</p>');
check('iframe still removed', sanitizeEditorHtml('<iframe src="https://x"></iframe>'), '');
check('style tag still removed', sanitizeEditorHtml('<style>body{}</style><p>a</p>'), '<p>a</p>');
check('onclick stripped', sanitizeEditorHtml('<p onclick="x()">a</p>'), '<p>a</p>');

// ---- 7. palette consistency ----------------------------------------------
check('four highlights', m.NOTE_HIGHLIGHTS.length, 4);
check('five arrows', m.ARROW_SYMBOLS.length, 5);
check('three callouts', Object.keys(m.CALLOUTS).length, 3);
check('inline layout stores no attribute', m.imageAlignAttr('inline'), null);
check('left layout stores left', m.imageAlignAttr('left'), 'left');
check('right layout stores right', m.imageAlignAttr('right'), 'right');

rmSync(outDir, { recursive: true, force: true });

console.log(`note media: ${pass}/${pass + fails.length} passed`);
if (fails.length) {
  console.error('\nFAILURES:\n  - ' + fails.join('\n  - '));
  process.exit(1);
}