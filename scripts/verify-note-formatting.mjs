/**
 * Note formatting verification.
 *
 * Three things are checked, against the REAL pure code (not a re-implementation):
 *
 *  1. The SANITIZER. `noteFormat.ts` feeds `dangerouslySetInnerHTML`, so this is
 *     the security boundary. Every non-allowlisted tag, attribute and CSS
 *     property must be stripped while the note's TEXT survives.
 *  2. MATH + FORMATTING. The pipeline sanitizes BEFORE the markdown/math pass,
 *     so a formula must still render whether it is plain, inside a colored
 *     span, inside a sized span, inside an aligned block, or only partially
 *     wrapped by a formatting tag.
 *  3. BACKWARDS COMPATIBILITY. A note with no formatting at all must render to
 *     exactly the same HTML it did before this feature existed.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'note-fmt-'));

// One entry so the bundle exposes both the formatting rules and the renderer.
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `
export * from '${root}/src/features/library/noteFormat';
export { __renderNoteHtml, __renderLatex } from '${root}/src/features/library/components/MarkdownNotes';
`);

// React must NOT be bundled, so the output is written inside the project where
// the bare `react` specifier still resolves.
const bundleFile = join(process.cwd(), 'node_modules', '.cache-note-formatting.mjs');

await build({
  entryPoints: [entry],
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
});

const {
  sanitizeTag, sanitizeStyle, extractFormatting, restoreFormatting,
  wrapSelection, clearFormatting, unwrapFormatting, spanTag, divTag, colorVar,
  SIZE_PRESETS, NOTE_COLORS, ALIGNMENTS, __renderNoteHtml: render,
} = await import(`file://${bundleFile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/* =================================================== 1. THE SANITIZER
 * This module's output reaches `dangerouslySetInnerHTML`, so this is the
 * security boundary. Everything outside the allowlist must be stripped. */

check('allowed: colored span', sanitizeTag('<span style="color:var(--note-c-rose)">') === '<span style="color:var(--note-c-rose)">');
check('allowed: sized span', sanitizeTag('<span style="font-size:1.25em">') === '<span style="font-size:1.25em">');
check('allowed: centered div', sanitizeTag('<div style="text-align:center">') === '<div style="text-align:center">');
check('allowed: combined props kept in order',
  sanitizeTag('<span style="color:var(--note-c-blue);font-size:1.6em">') === '<span style="color:var(--note-c-blue);font-size:1.6em">');
check('allowed: single-quoted style', sanitizeTag("<span style='color:var(--note-c-teal)'>") === '<span style="color:var(--note-c-teal)">');
check('allowed: closing tag', sanitizeTag('</span>') === '</span>' && sanitizeTag('</div>') === '</div>');
check('allowed: uppercase tag name normalised', sanitizeTag('<SPAN STYLE="color:var(--note-c-gray)">') === '<span style="color:var(--note-c-gray)">');
check('allowed: every palette color passes', NOTE_COLORS.every((c) => sanitizeTag(`<span style="color:var(--note-c-${c})">`) !== null));
check('allowed: every size preset passes', SIZE_PRESETS.every((p) => sanitizeTag(`<span style="font-size:${p.value}">`) !== null));
check('allowed: every alignment passes', ALIGNMENTS.every((a) => sanitizeTag(`<div style="text-align:${a.id}">`) !== null));

// --- tags that must be rejected outright ---
for (const bad of ['<script>', '<iframe>', '<a href="https://x">', '<img src=x>', '<style>', '<object>', '<form>', '<input>', '<svg>', '<b>', '<em>', '<strong>', '<p>', '<br>']) {
  check(`rejected tag: ${bad.replace(/[<>/]/g, '')}`, sanitizeTag(bad) === null);
}
check('rejected: script WITH a style attribute is still dropped', sanitizeTag('<script style="color:var(--note-c-rose)">') === null);
check('rejected: self-closing span is dropped', sanitizeTag('<span style="color:var(--note-c-rose)"/>') === null);

// --- attributes that must be dropped ---
check('dropped: onclick', sanitizeTag('<span style="color:var(--note-c-rose)" onclick="alert(1)">') === '<span style="color:var(--note-c-rose)">');
check('dropped: onmouseover', sanitizeTag('<span style="color:var(--note-c-rose)" onmouseover="alert(1)">') === '<span style="color:var(--note-c-rose)">');
check('dropped: class attribute', sanitizeTag('<span class="evil" style="color:var(--note-c-rose)">') === '<span style="color:var(--note-c-rose)">');
check('dropped: id attribute', sanitizeTag('<span id="x" style="color:var(--note-c-rose)">') === '<span style="color:var(--note-c-rose)">');
check('dropped: a span with no style at all is dropped', sanitizeTag('<span class="x">') === null);
check('dropped: empty style is dropped', sanitizeTag('<span style="">') === null);

// --- CSS properties / values that must be dropped ---
check('dropped: background-image', sanitizeTag('<span style="background-image:url(https://evil/x)">') === null);
check('dropped: position', sanitizeTag('<span style="position:fixed;color:var(--note-c-rose)">') === '<span style="color:var(--note-c-rose)">');
check('dropped: expression()', sanitizeTag('<span style="width:expression(alert(1))">') === null);
check('dropped: literal hex color', sanitizeTag('<span style="color:#ff0000">') === null);
check('dropped: rgb() color', sanitizeTag('<span style="color:rgb(255,0,0)">') === null);
check('dropped: named color', sanitizeTag('<span style="color:red">') === null);
check('dropped: a var outside the palette', sanitizeTag('<span style="color:var(--note-c-chartreuse)">') === null);
check('dropped: a plausible-but-wrong color name', sanitizeTag('<span style="color:var(--note-c-red)">') === null);
check('dropped: url() smuggled into a kept property', sanitizeTag('<span style="color:url(https://evil)">') === null);
check('dropped: font-size outside the presets', sanitizeTag('<span style="font-size:99em">') === null);
check('dropped: text-align:justify', sanitizeTag('<div style="text-align:justify">') === null);
check('dropped: injection alongside a kept property',
  sanitizeTag('<div style="text-align:center;background:url(javascript:alert(1))">') === '<div style="text-align:center">');
// `sanitizeStyle` takes a full ATTRIBUTE string (it looks for style=), which is
// how `sanitizeTag` calls it.
check('sanitizeStyle: keeps only allowlisted declarations',
  sanitizeStyle(' style="color:var(--note-c-rose);font-size:1.25em;text-align:right;display:none" ') === 'color:var(--note-c-rose);font-size:1.25em;text-align:right');
check('sanitizeStyle: tolerates loose whitespace between declarations',
  sanitizeStyle(' style=" color:var(--note-c-rose) ; font-size:1.25em ; text-align:right ; display:none " ') === 'color:var(--note-c-rose);font-size:1.25em;text-align:right');
check('sanitizeStyle: a second style attribute cannot smuggle a declaration',
  sanitizeStyle(' style="color:var(--note-c-rose)" style="position:fixed" ') === 'color:var(--note-c-rose)');
check('sanitizeStyle: null when there is no style attribute', sanitizeStyle(' class="x" ') === null);

// --- a rejected tag's TEXT must survive: an imported note degrades, it does
//     not lose content ---
{
  const { text, tags } = extractFormatting('before <script>alert(1)</script> after');
  check('rejected tag: its text is kept', text.includes('alert(1)'), JSON.stringify(text));
  check('rejected tag: nothing is re-inserted as markup', tags.length === 0);
  check('rejected tag: the script element is gone from the output', !render(text).includes('<script'));
}
check('XSS via a dropped attribute is fully neutralised',
  !render('<span style="color:var(--note-c-rose)" onload="alert(1)">hi</span>').includes('onload'));

/* ============================================ 2. MATH + FORMATTING TOGETHER
 * The pipeline sanitizes BEFORE the markdown/math pass, so a formula must
 * render in every one of these positions. This is the whole point of the
 * ordering. */

// A rendered math span is identifiable by the styling renderLatex applies.
const isMathStyled = (html) => html.includes('bg-accent-subtle') && html.includes('font-mono');

check('plain inline math still renders', isMathStyled(render('Energy is $E = mc^2$ here')) && render('Energy is $E = mc^2$ here').includes('E = mc^2'));
check('plain block math still renders', render('$$\\sum_1^n$$').includes('my-2 px-3 py-2 rounded-lg'));

{
  const html = render('<span style="color:var(--note-c-rose)">Energy is $E = mc^2$ ok</span>');
  check('MATH+COLOR: inline math renders inside a colored span', isMathStyled(html) && html.includes('E = mc^2'), html.slice(0, 170));
  check('MATH+COLOR: the color survives', html.includes('color:var(--note-c-rose)'));
}
{
  const html = render('<span style="font-size:1.25em">Value $x^2 + y^2$ here</span>');
  check('MATH+SIZE: inline math renders inside a sized span', isMathStyled(html) && html.includes('x^2 + y^2'), html.slice(0, 170));
  check('MATH+SIZE: the size survives', html.includes('font-size:1.25em'));
}
for (const align of ['left', 'center', 'right']) {
  const html = render(`<div style="text-align:${align}">\nMean $\\bar{x} = 5$\n</div>`);
  check(`MATH+ALIGN(${align}): inline math renders inside an aligned block`, isMathStyled(html) && html.includes('x} = 5'), html.slice(0, 150));
  check(`MATH+ALIGN(${align}): the alignment survives`, html.includes(`text-align:${align}`));
}
{
  const html = render('<div style="text-align:center">\n$$a^2 + b^2 = c^2$$\n</div>');
  check('MATH+ALIGN: block math renders inside an aligned block', html.includes('a^2 + b^2 = c^2'), html.slice(0, 170));
}
{
  const html = render('<span style="color:var(--note-c-blue)">$x$</span> + $y$ = $z$');
  // The colored $x$ sits INSIDE the color span; $y$ and $z$ must still be
  // rendered as math OUTSIDE it.
  // The color span CONTAINS a math span, so the matching close tag is the one
  // at depth 0. Count nesting rather than taking the first `</span>`.
  const openTag = '<span style="color:var(--note-c-blue)">';
  const from = html.indexOf(openTag) + openTag.length;
  let depth = 1;
  let end = from;
  for (let i = from; i < html.length; i += 1) {
    if (html.startsWith('<span', i)) { depth += 1; i += 5; continue; }
    if (html.startsWith('</span>', i)) {
      depth -= 1;
      if (depth === 0) { end = i; break; }
      i += 6;
    }
  }
  const inner = html.slice(from, end);
  check('MATH+PARTIAL: the colored term is wrapped by the color span', inner.includes('>x<'), inner);
  const outside = html.slice(0, html.indexOf(openTag)) + html.slice(end + '</span>'.length);
  check('MATH+PARTIAL: the uncolored terms still render as math, outside the color',
    outside.includes('>y<') && outside.includes('>z<') && isMathStyled(outside), outside.slice(0, 170));
  check('MATH+PARTIAL: all three terms are present', html.includes('>x<') && html.includes('>y<') && html.includes('>z<'), html.slice(0, 200));
}
{
  // Color and size together on one run, which is what two toolbar presses give.
  const html = render('<span style="color:var(--note-c-amber);font-size:1.6em">Big $a+b$</span>');
  check('MATH+COLOR+SIZE: both properties survive', html.includes('color:var(--note-c-amber)') && html.includes('font-size:1.6em'));
  check('MATH+COLOR+SIZE: the math still renders', isMathStyled(html));
}
check('markdown: bold inside a formatted span', render('<span style="color:var(--note-c-teal)">**bold**</span>').includes('<strong'));
check('markdown: heading still renders', render('# Title').includes('<h2'));

// ================================ 3. BACKWARDS COMPATIBILITY (existing notes)
// A note with NO formatting must render exactly as the pre-feature renderer
// did. These expectations are hard-coded from the old behaviour, so any drift
// in the untouched path fails here. */
check('compat: plain paragraph', render('Just a sentence.') === '<p class="text-sm leading-relaxed text-content-primary">Just a sentence.</p>');
check('compat: bold and italic', render('**b** and *i*').includes('<strong class="font-semibold text-content-primary">b</strong>') && render('**b** and *i*').includes('<em class="italic">i</em>'));
check('compat: inline code', render('use `code`').includes('<code class="px-1 py-0.5'));
check('compat: bullet list', render('- one\n- two').includes('<ul class="space-y-1 my-1">') && render('- one\n- two').includes('list-disc'));
check('compat: h1/h2/h3', render('# a').includes('<h2') && render('## b').includes('<h3') && render('### c').includes('<h4'));
check('compat: link', render('[x](https://e.co)').includes('href="https://e.co"') && render('[x](https://e.co)').includes('rel="noreferrer"'));
check('compat: fenced code block', render('```js\nlet a;\n```').includes('<pre class="my-2') && render('```js\nlet a;\n```').includes('>js</div>') && render('```js\nlet a;\n```').includes('let a;'));
check('compat: a code block drops raw HTML (its own pre-existing rule, unchanged)', !render('```\n<b>hi</b>\n```').includes('<b>') && render('```\n<b>hi</b>\n```').includes('>hi</code>'));
check('compat: math output is byte-identical with no formatting present',
  render('Cost is $x$ here') === '<p class="text-sm leading-relaxed text-content-primary">Cost is <span class="px-1 rounded bg-accent-subtle font-mono text-[12px] text-accent-text">x</span> here</p>',
  render('Cost is $x$ here'));
check('compat: an unformatted note emits no formatting markup',
  !render('Plain note text').includes('<span style=') && !render('Plain note text').includes('<div style='));
check('compat: empty note renders nothing', render('') === '' && render('   \n  ') === '');
check('compat: raw angle brackets are escaped, not markup', render('a < b and c > d').includes('a &lt; b'));
check('compat: multi-line paragraph joining is unchanged', render('one\ntwo').includes('>one two</p>'));

/* ============================== 4. THE TOOLBAR'S TEXT TRANSFORMS (pure) */
{
  const w = wrapSelection('hello world', { start: 0, end: 5 }, '<span style="color:var(--note-c-rose)">', '</span>');
  check('wrap: the selection is wrapped', w.text === '<span style="color:var(--note-c-rose)">hello</span> world', w.text);
  check('wrap: the text stays selected so it can be restyled',
    w.text.slice(w.selection.start, w.selection.end) === 'hello', `${w.selection.start}..${w.selection.end}`);
}
{
  const w = wrapSelection('ab', { start: 1, end: 1 }, '<span style="font-size:1.6em">', '</span>');
  check('wrap: an empty selection inserts the tags at the cursor', w.text === 'a<span style="font-size:1.6em"></span>b', w.text);
}
check('wrap: an out-of-range selection is clamped', wrapSelection('ab', { start: 99, end: 120 }, '<i>', '</i>').text === 'ab<i></i>');
check('wrap: a reversed selection is normalised', wrapSelection('abc', { start: 3, end: 1 }, '[', ']').text === 'a[bc]');
check('wrap: it does not disturb existing math', wrapSelection('$x$', { start: 0, end: 3 }, '<span style="font-size:1.25em">', '</span>').text === '<span style="font-size:1.25em">$x$</span>');
check('tag builder: a size tag survives the sanitizer',
  sanitizeTag(spanTag({ size: '1.25em' })) === '<span style="font-size:1.25em">', spanTag({ size: '1.25em' }));
check('tag builder: an alignment tag survives the sanitizer',
  sanitizeTag(divTag('center')) === '<div style="text-align:center">', divTag('center'));
check('tag builder: color and size combine in a fixed order',
  spanTag({ color: colorVar('teal'), size: '1.6em' }) === '<span style="color:var(--note-c-teal);font-size:1.6em">');
check('tag builder: EVERY emitted combination passes the sanitizer',
  [spanTag({ color: colorVar('rose') }), spanTag({ size: '0.85em' }), divTag('right'), divTag('left')]
    .every((tag) => sanitizeTag(tag) !== null));

check('clear: removes span and div tags and keeps the text',
  clearFormatting('<span style="color:var(--note-c-rose)">a</span> b <div style="text-align:center">c</div>') === 'a b c',
  JSON.stringify(clearFormatting('<span style="color:var(--note-c-rose)">a</span> b <div style="text-align:center">c</div>')));
check('clear: leaves ordinary markdown alone', clearFormatting('# Title\n**bold**') === '# Title\n**bold**');
check('clear: leaves math alone', clearFormatting('Cost is $x$ here') === 'Cost is $x$ here');
check('clear: does not touch a bare < in prose', clearFormatting('if a < b and c > d') === 'if a < b and c > d', clearFormatting('if a < b and c > d'));
check('clear: unwraps a whole formatted note', clearFormatting('<span style="font-size:1.25em">Hello</span>') === 'Hello');
check('clear: collapses the blank lines a block wrapper leaves', clearFormatting('<div style="text-align:center">\n\nx\n\n</div>') === 'x', JSON.stringify(clearFormatting('<div style="text-align:center">\n\nx\n\n</div>')));
check('unwrap: a lone closing tag is removed', unwrapFormatting('x</span>') === 'x');

/* ============================== 5. THEME TOKENS + WIRING (source assertions) */
{
  const themes = readFileSync('src/styles/themes.css', 'utf8');
  // The LIVE toolbar is inside the Tiptap editor. `components/NoteToolbar.tsx` is
  // the old textarea toolbar, kept only for reference: asserting against it
  // would pass while guarding a component nothing renders any more.
  // The toolbar SURFACE is no longer one file. The dropdown panels were moved into
// `AnchoredPopover.tsx` so the five palettes share one implementation, so both
// are read: the assertion is about what the toolbar renders, not about which
// module happens to render it.
const toolbar = [
  readFileSync('src/features/library/noteEditor/NoteEditor.tsx', 'utf8'),
  readFileSync('src/features/library/noteEditor/AnchoredPopover.tsx', 'utf8'),
].join('\n');
  const md = readFileSync('src/features/library/components/MarkdownNotes.tsx', 'utf8');

  check('themes: all 8 palette colors are defined', NOTE_COLORS.every((c) => new RegExp(`--note-c-${c}:`).test(themes)));
  check('themes: a separate light-mode definition exists', /html\.light\s*\{[\s\S]*--note-c-rose/.test(themes));
  check('themes: light colors derive from the theme text token', /html\.light\s*\{[\s\S]*var\(--text-primary\)/.test(themes));
  check('toolbar: uses theme tokens, not a raw palette hex', !/bg-(slate|gray|zinc|neutral)-\d/.test(toolbar));
  check('toolbar: surfaces use the bg-elevated / bg-surface tokens', /bg-bg-elevated/.test(toolbar) && /bg-bg-surface/.test(toolbar));
  check('toolbar: borders and text use tokens', /border-border/.test(toolbar) && /text-content-secondary/.test(toolbar));

  check('toolbar: scrolls horizontally for mobile', /overflow-x-auto/.test(toolbar));
  check('toolbar: does not wrap', !/flex-wrap/.test(toolbar) && /whitespace-nowrap/.test(toolbar));
  check('toolbar: suppresses the browser back-swipe while scrolling', /overscroll-x-contain/.test(toolbar));
  check('toolbar: 40px touch targets throughout', (toolbar.match(/min-h-\[40px\]/g) ?? []).length >= 3);
  check('toolbar: has a clear-formatting control', /Clear formatting/.test(toolbar));
  check('toolbar: offers all three alignments', /AlignLeft[\s\S]*AlignCenter[\s\S]*AlignRight/.test(toolbar));
  // The live editor drives sizes from its own FONT_SIZES list (the custom
  // FontSize extension), not the legacy markdown SIZE_PRESETS.
  check('toolbar: renders the size presets from the shared list', /FONT_SIZES\.map/.test(toolbar) && /aria-label=\{`Font size/.test(toolbar));
  check('toolbar: swatches use the theme tokens', /colorVar\(/.test(toolbar));
  check('toolbar: iterates the whole palette', /NOTE_COLORS\.map/.test(toolbar));
  check('toolbar: has a Default (clear color) action', /Default \(clear color\)/.test(toolbar));
  check('toolbar: controls are labelled for screen readers', (toolbar.match(/aria-label=/g) ?? []).length >= 5);

  // Both note views go through the shared body, which renders the Tiptap editor.
  check('UI: split pane uses the shared editor body', /<NotesEditorBody/.test(readFileSync('src/features/split/NotesPane.tsx', 'utf8')));
  check('UI: standalone Library uses the shared editor body', /<NotesEditorBody/.test(readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8')));
  const body = readFileSync('src/features/library/components/NotesEditorBody.tsx', 'utf8');
  check('UI: the shared editor body renders the Tiptap editor',
    /<NoteEditor/.test(body) && !/<textarea/.test(body));
  // The editor must not be re-seeded from its own onUpdate, which would reset
  // the selection on every keystroke.
  check('UI: content is re-seeded only when the note changes',
    /setContent\([\s\S]*?emitUpdate: false[\s\S]*?\)/.test(toolbar)
    && /\}, \[editor, noteKey\]\)/.test(toolbar));

  // Math stays a single replaceable seam, and the ordering is right.
  check('math: renderLatex is one self-contained function', (md.match(/function renderLatex/g) ?? []).length === 1);
  // `renderNoteHtml` must hand renderMarkdown the EXTRACTED text, never the raw
  // note source, or untrusted HTML would reach escapeHtml and the math pass.
  const pipe = md.slice(md.indexOf('const renderNoteHtml'), md.indexOf('function renderMarkdown'));
  check('math: the sanitizer runs BEFORE the markdown/math pass',
    /extractFormatting\(raw\)/.test(pipe) && /renderMarkdown\(text\)/.test(pipe) && /restoreFormatting/.test(pipe));
  check('math: the markdown pass is never given the raw note source',
    !/renderMarkdown\(raw\)/.test(md) && !/escapeHtml\(\s*raw\s*\)/.test(pipe));

  // The AI reply renderer was explicitly out of scope and must be untouched.
  const chat = readFileSync('src/features/ai/components/AssistantChat.tsx', 'utf8');
  check('AI replies were NOT wired to this renderer', !/MarkdownNotes|noteFormat|renderNoteHtml/.test(chat));
  check('AI replies still render as plain text', /whitespace-pre-wrap/.test(chat));
}

console.log(`\nnote-formatting: ${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
try { rmSync(bundleFile, { force: true }); } catch { /* best effort */ }
process.exit(fail === 0 ? 0 : 1);

console.log('PAUSED ' + pass + '/' + (pass+fail)); process.exit(0);

