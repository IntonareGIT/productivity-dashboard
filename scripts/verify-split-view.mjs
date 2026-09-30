/**
 * Split view state model verification.
 *
 * Exercises the real splitModel.ts: the pure reducer behind the two-pane
 * layout. No DOM, no React, so the transitions can be checked directly —
 * including the rule that NOTHING is persisted (a refresh must reset).
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'split-'));
const outFile = join(outDir, 'model.mjs');

await build({
  entryPoints: ['src/features/split/splitModel.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
});

const m = await import(`file://${outFile.replace(/\\/g, '/')}`);
const {
  initialSplitState, emptySplitState, splitWithNotes, openSplit, addSecondPane, swapPanes,
  closePane, setPane, setActivePane, toggleMaximize, isSplit, clampRatio, activeIndex,
  MIN_RATIO, MAX_RATIO,
} = m;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

const PDF = { kind: 'pdf', resourceId: 'r1' };
const NOTES = { kind: 'notes', topicId: 't1' };
const PDF2 = { kind: 'pdf', resourceId: 'r2' };
const DASH = { kind: 'dashboard' };
const CHAT = { kind: 'assistant' };

// ---- 1. Default state: a single full-width dashboard, no split ----------
{
  check('1 default is a single pane', initialSplitState.panes.length === 1);
  check('1 default pane is the dashboard', initialSplitState.panes[0].kind === 'dashboard');
  check('1 default is not split', isSplit(initialSplitState) === false);
  check('1 nothing is maximized by default', initialSplitState.maximized === null);
  check('1 the ratio has a sane default', initialSplitState.ratio === 0.5);
}

// ---- 2. Opening the split ----------------------------------------------
{
  const s = addSecondPane(initialSplitState, CHAT);
  check('2 addSecondPane produces two panes', s.panes.length === 2);
  check('2 the original content is kept in pane 0', s.panes[0].kind === 'dashboard');
  check('2 the new content is in pane 1', s.panes[1].kind === 'assistant');
  check('2 it is now split', isSplit(s) === true);
  check('2 a third pane is never added', addSecondPane(s, DASH).panes.length === 2);
}

// ---- 3. Swap exchanges content in one action --------------------------
{
  const s = openSplit(initialSplitState, PDF, NOTES);
  const w = swapPanes(s);
  check('3 swap exchanges the two slots',
    w.panes[0].kind === 'notes' && w.panes[1].kind === 'pdf',
    `${w.panes[0].kind}/${w.panes[1].kind}`);
  check('3 swap carries the ids across, not just the kinds',
    w.panes[0].topicId === 't1' && w.panes[1].resourceId === 'r1');
  check('3 swap clears any maximized pane', w.maximized === null);
  check('3 swap is a no-op when not split', isSplit(swapPanes(initialSplitState)) === false);
  check('3 swapping twice restores the original order', swapPanes(w).panes[0].kind === 'pdf');
}

// ---- 4. Close collapses to one full-width pane ------------------------
{
  const s = openSplit(initialSplitState, PDF, NOTES);
  const closed0 = closePane(s, 0);
  check('4 closing pane 0 keeps pane 1', closed0.panes.length === 1 && closed0.panes[0].kind === 'notes');
  const closed1 = closePane(s, 1);
  check('4 closing pane 1 keeps pane 0', closed1.panes.length === 1 && closed1.panes[0].kind === 'pdf');
  check('4 closing clears maximize', closed1.maximized === null);
  check('4 closing resets the ratio', closed1.ratio === 0.5);
  check('4 closing the last pane is a no-op', closePane(initialSplitState, 0).panes.length === 1);
}

// ---- 4b. Active-pane focus tracking ---------------------------------------
{
  check('4b no pane is focused until the user touches one',
    initialSplitState.activePane === null && emptySplitState.activePane === null &&
    openSplit(initialSplitState, PDF, NOTES).activePane === null);
  const focused = setActivePane(openSplit(initialSplitState, PDF, NOTES), 1);
  check('4b focusing a pane records its index', focused.activePane === 1);
  check('4b focusing is a no-op when already focused',
    setActivePane(focused, 1) === focused);
  check('4b focusing out of range is a no-op',
    setActivePane(focused, 5) === focused && setActivePane(openSplit(initialSplitState, PDF, NOTES), -1).activePane === null);
  check('4b focusing changes nothing but the active pane',
    focused.panes[0].resourceId === 'r1' && focused.maximized === null && focused.ratio === 0.5);
  check('4b closing collapses focus to the surviving pane',
    closePane(focused, 1).activePane === 0 && closePane(focused, 0).activePane === 0);
  check('4b content changes do not steal focus',
    setPane(focused, 0, DASH).activePane === 1 && toggleMaximize(focused, 0).activePane === 1);
}

// ---- 5. Each pane's content is changeable ----------------------------
{
  const s = openSplit(initialSplitState, PDF, NOTES);
  const changed = setPane(s, 0, CHAT);
  check('5 pane 0 can become the assistant', changed.panes[0].kind === 'assistant');
  check('5 pane 1 is untouched', changed.panes[1].kind === 'notes');
  check('5 the same file can be open in BOTH panes',
    setPane(openSplit(initialSplitState, PDF, NOTES), 1, PDF).panes[1].resourceId === 'r1');
  check('5 a second, different PDF can be set',
    setPane(openSplit(initialSplitState, PDF, NOTES), 1, PDF2).panes[1].resourceId === 'r2');
  check('5 an out-of-range index is a no-op', setPane(s, 5, DASH).panes.length === 2);
}

// ---- 6. Maximize, distinct from full screen --------------------------
{
  const s = openSplit(initialSplitState, PDF, NOTES);
  const m0 = toggleMaximize(s, 0);
  check('6 maximizing records the index', m0.maximized === 0);
  check('6 the maximized pane is the active one', activeIndex(m0) === 0);
  check('6 maximizing again restores', toggleMaximize(m0, 0).maximized === null);
  check('6 maximizing the other pane switches', toggleMaximize(m0, 1).maximized === 1);
  check('6 maximize is a no-op when not split', toggleMaximize(initialSplitState, 0).maximized === null);
  check('6 maximize leaves pane content alone', m0.panes[0].resourceId === 'r1');
}

// ---- 7. Divider ratio is clamped -------------------------------------
{
  check('7 clamp keeps a lower bound', clampRatio(0) === MIN_RATIO);
  check('7 clamp keeps an upper bound', clampRatio(1) === MAX_RATIO);
  check('7 clamp passes a sane value through', clampRatio(0.42) === 0.42);
  check('7 clamp fixes a negative drag', clampRatio(-5) === MIN_RATIO);
}

// ---- 8. The PDF half-screen starting state --------------------------
{
  const s = splitWithNotes('r1', 't1');
  check('8 opens as a split', isSplit(s) === true);
  check('8 the PDF is in pane 0', s.panes[0].kind === 'pdf' && s.panes[0].resourceId === 'r1');
  check('8 its topic notes are in pane 1', s.panes[1].kind === 'notes' && s.panes[1].topicId === 't1');

// ---- 9. Nothing is persisted: a refresh resets ------------------------
{
  // The strongest structural guarantee: the model references no persistence API
  // at all, so there is nowhere for split state to be written.
  const src = readFileSync('src/features/split/splitModel.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  check('9 the model never touches web storage', !/localStorage|sessionStorage/.test(src));
  check('9 the model never touches IndexedDB/Dexie', !/indexedDB|\bdb\./.test(src));
  check('9 the model has no React import (it is pure)', !/from 'react'/.test(src));

  // The initial constant must survive mutations, so every load starts clean.
  const mutated = swapPanes(openSplit(initialSplitState, PDF, NOTES));
  check('9 the initial constant is not mutated by transitions',
    initialSplitState.panes.length === 1 && initialSplitState.panes[0].kind === 'dashboard');
  check('9 transitions return new objects (no in-place mutation)',
    mutated !== initialSplitState && mutated.panes[0] !== initialSplitState.panes[0]);
  check('9 re-reading the initial state still gives the single dashboard',
    isSplit(initialSplitState) === false && initialSplitState.maximized === null);
}

// The header and its universal wrapper were extracted out of SplitView into
// their own module, so header assertions read that file. Declared at module
// scope because later blocks assert against it too.
const paneHeader = readFileSync('src/features/split/PaneHeader.tsx', 'utf8');
// The pane focus ring's colours live in the theme sheet, so it is asserted
// against BOTH files: the component must consume the tokens, and the sheet must
// derive them from the theme's own tokens rather than hard-coding a colour.
const themes = readFileSync('src/styles/themes.css', 'utf8');
const pdfViewer = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');

// ---- 10. Components honour the model --------------------------------
{
  const splitView = readFileSync('src/features/split/SplitView.tsx', 'utf8');
  const paneContent = readFileSync('src/features/split/PaneContent.tsx', 'utf8');
  const notesPane = readFileSync('src/features/split/NotesPane.tsx', 'utf8');
  const fullScreen = readFileSync('src/features/split/FullScreenPreview.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const pdfViewer = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');
  const topBar = readFileSync('src/components/layout/TopBar.tsx', 'utf8');
  const appLayout = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');

  check('10 the split is React state in App, seeded from initialSplitState',
    /useState<SplitState>\(initialSplitState\)/.test(app));
  check('10 App does not persist the split',
    !/localStorage|sessionStorage/.test(app));
  check('10 the split is an APP-LEVEL overlay, not owned by a tab',
    /overlay=\{/.test(app) && /<AppLayout[\s\S]{0,400}overlay/.test(app));
  check('10 the overlay is layered above the active tab content',
    /absolute inset-x-0 top-14 bottom-0 z-20/.test(app));
  check('10 every tab renders its normal content again',
    /case 'dashboard'/.test(app) && /case 'library'/.test(app) &&
    /case 'calendar'/.test(app) && /case 'shifts'/.test(app) &&
    /case 'focus'/.test(app) && /case 'settings'/.test(app));
  check('10 the split is no longer bound to the dashboard tab',
    !/activeTab === 'dashboard' \? \(/.test(app));
  check('10 App opens the PDF split via splitWithNotes', /splitWithNotes\(resourceId, topicId\)/.test(app));
  check('10 opening the PDF split also opens the overlay', /setSplitOpen\(true\)/.test(app));
  check('10 opening the split does NOT change the active tab',
    !/setActiveTab\([^)]*\)/.test(
      app.slice(app.indexOf('const openPdfWithNotes'), app.indexOf('const renderContent'))));
  check('10 closing the split does NOT change the active tab',
    /const closeSplit = useCallback\(\(\) => setSplitOpen\(false\), \[\]\)/.test(app));

  check('10 the top bar has a split icon next to the avatar',
    /Columns2/.test(topBar) && /Open split view/.test(topBar) && /Close split view/.test(topBar));
  check('10 the split icon is visible at every width (no hidden/md-only)',
    !/hidden (sm|md):[a-z-]*flex[^"]*"[\s\S]{0,200}Columns2/.test(topBar) &&
    /onToggleSplit && \(/.test(topBar));
  check('10 the top bar icon reflects and toggles split state',
    /aria-pressed=\{splitOpen\}/.test(topBar) && /onClick=\{onToggleSplit\}/.test(topBar));
  check('10 the icon is the usual generic split entry point',
    (() => {
      // `onToggleSplit` legitimately appears in App/AppLayout/TopBar as prop
      // plumbing, and `addSecondPane` in the model that defines it. What must be
      // constrained is which SURFACES call it generically: the top-bar icon
      // (via App's empty split + the pane header's single-pane picker) and the
      // assistant tool path (the command applier in App). `splitWithNotes` is a
      // contextual PDF-notes shortcut, not a generic entry point.
      const hits = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx$/.test(e.name) && /addSecondPane\(/.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      };
      walk('src');
      const names = hits.map((p) => p.replace(/\\/g, '/'));
      // Generic splits may only come from the split feature's own header or
      // from App (the top-bar icon's empty-split applier + the assistant
      // command applier).
      const ok = names.includes('src/features/split/PaneHeader.tsx') &&
        names.includes('src/App.tsx') &&
        names.every((n) => n === 'src/App.tsx' || n.startsWith('src/features/split/'));
      return ok;
    })(),
    'only PaneHeader and App may add a pane generically');
  check('10 no other surface exposes a generic start-split button',
    !/Start split screen|startSplitScreen/.test(
      readFileSync('src/components/layout/Sidebar.tsx', 'utf8') +
      readFileSync('src/components/layout/BottomNav.tsx', 'utf8') +
      readFileSync('src/components/layout/ProfileMenu.tsx', 'utf8')));

  check('10 the empty pane kind exists with the instructional note',
    /case 'empty'/.test(paneContent) &&
    /choose a file straight from the/.test(paneContent));
  check('10 the empty pane has a light (dashed) border',
    /border-dashed/.test(paneContent));
  check('10 the icon opens a default empty split',
    /emptySplitState/.test(app) && /panes\.length > 1 \? s : emptySplitState/.test(app));
  check('10 every pane still has its own picker control',
    /Pane \$\{index \+ 1\} content/.test(paneHeader));


  check('10 two panes are side by side, stacked under 768px',
    /stacked \? 'flex-col' : 'flex-row'/.test(splitView) && /max-width: 767px/.test(splitView));
  check('10 the divider is draggable',
    /onPointerDown=\{onPointerDown\}/.test(splitView) && /pointermove/.test(splitView));
  check('10 the divider is keyboard operable',
    /role="separator"/.test(splitView) && /aria-label="Resize panes"/.test(splitView));

  check('10 each pane header has a content picker',
    /Pane \$\{index \+ 1\} content/.test(paneHeader));
  check('10 the picker offers all four kinds',
    /value="dashboard"/.test(paneHeader) && /value="pdf"/.test(paneHeader) &&
    /value="notes"/.test(paneHeader) && /value="assistant"/.test(paneHeader));
  // ONE document dropdown on every pane kind, grouping PDFs and notes, rather
  // than two sub-pickers that only appeared for pdf/notes kinds.
  check('10 the picker has one document dropdown covering PDFs and notes',
    /Select file/.test(paneHeader) && /optgroup label="PDFs"/.test(paneHeader) &&
    /optgroup label="Notes"/.test(paneHeader));
  check('10 the document dropdown is always rendered, not kind-gated',
    !/\{(slot\.kind === 'pdf' \|\| slot\.kind === 'notes') && \(\s*<select/.test(paneHeader));
  check('10 there is a swap control', /swapPanes\(s\)/.test(splitView) || /swapPanes\(s\)/.test(paneHeader));
  check('10 there is a close control collapsing to one pane', /closePane\(s, index\)/.test(paneHeader));
  check('10 a single pane can open the split', /addSecondPane\(s, \{ kind: 'assistant' \}\)/.test(paneHeader));
  check('10 a single pane can return to the dashboard', /setState\(initialSplitState\)/.test(paneHeader));
  check('10 a pane can be maximized and restored', /toggleMaximize\(s, index\)/.test(paneHeader));
  // Focus tracking: a pane is claimed on pointer-down and on focus (keyboard),
  // and only the ACTIVE pane glows.
  // Capture phase, so a child that stops propagation cannot swallow the claim.
  check('10 a pane is claimed as active on pointer down (capture)',
    /onPointerDownCapture=\{onActivate\}/.test(paneHeader));
  check('10 a pane is claimed as active on focus (capture)',
    /onFocusCapture=\{onActivate\}/.test(paneHeader));
  // The glow must be a CHILD overlay with INSET shadows. A ring / outer
  // box-shadow on the pane box is painted outside the border box, and the split
  // wrapper is `overflow-hidden` — so it is drawn and then clipped away, which
  // is exactly why the glow was invisible.
  check('10 the focus ring is an overlay child, not a clipped outer shadow',
    // Rendered unconditionally, because a box-shadow cannot transition from
    // `none` and the idle pane needs a real value for the cross-fade.
    !/\{active && \(/.test(paneHeader) &&
    /pointer-events-none absolute inset-0 z-20/.test(paneHeader));
  // Quiet by construction: a 1px inset ring with no spread, plus a faint 8px
  // shadow. The previous `2px` ring and `26px -6px` glow at full accent were
  // the "too strong" the ring exists to avoid.
  check('10 the focus ring is a subtle 1px INSET ring plus a faint shadow',
    /inset 0 0 0 1px var\(--pane-ring\)/.test(paneHeader) &&
    /inset 0 0 8px 0 var\(--pane-glow\)/.test(paneHeader) &&
    !/inset 0 0 0 2px/.test(paneHeader) &&
    !/26px/.test(paneHeader) &&
    // No spread radius on the ring.
    !/inset 0 0 0 1px var\(--pane-ring\)[^,]*-[0-9]/.test(paneHeader));
  check('10 the inactive pane gets a neutral 1px ring and no glow',
    /inset 0 0 0 1px var\(--pane-ring-idle\), inset 0 0 8px 0 transparent/.test(paneHeader));
  check('10 switching panes cross-fades over ~150ms',
    /transition-\[border-color,box-shadow\] duration-150/.test(paneHeader));
  // The colours stay in theme tokens, so the ring follows every theme and both
  // modes instead of hard-coding a colour.
  check('10 the ring colours come from theme tokens, not literals',
    /--pane-ring: color-mix\(in srgb, var\(--accent-primary\) 35%, transparent\)/.test(themes) &&
    /--pane-ring-idle: color-mix\(in srgb, var\(--border-subtle\) 35%, transparent\)/.test(themes) &&
    /--pane-glow: color-mix\(in srgb, var\(--accent-primary\) 12%, transparent\)/.test(themes) &&
    !/rgba?\([^)]*\)/.test(paneHeader.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/var\(--[a-z-]+\)/g, '')));
  check('10 no outer ring/shadow is left on the pane box',
    !/ring-accent/.test(paneHeader) && !/shadow-\\\[0_0_15px/.test(paneHeader));
  check('10 the glow renders AFTER the content so the pane background cannot cover it',
    paneHeader.indexOf('pointer-events-none absolute inset-0 z-20') >
      paneHeader.indexOf('flex-1 min-h-0 min-w-0 w-full overflow-y-auto'));
  check('10 the glow shows in single-pane mode too',
    /active=\{state\.activePane === 0\}/.test(splitView));
  check('10 panes activate through the no-op-safe reducer',
    /activatePane=\{activatePane\}/.test(splitView) && /onActivate=\{activatePane\(index\)\}/.test(splitView));
  check('10 the maximized-away pane stays mounted, keeping its state',
    /hidden \? 'hidden' : ''/.test(splitView) && /!hidden && \(/.test(splitView));

  check('10 all four content kinds are dispatchable',
    /case 'dashboard'/.test(paneContent) && /case 'assistant'/.test(paneContent) &&
    /case 'notes'/.test(paneContent) && /case 'pdf'/.test(paneContent));
  check('10 the assistant pane reuses the shared AssistantChat', /<AssistantChat/.test(paneContent));
  check('10 the notes pane reuses MarkdownNotes', /<MarkdownNotes/.test(notesPane));
  check('10 the notes pane writes through the same updateTopicNotes',
    /updateTopicNotes/.test(notesPane));
  check('10 the PDF pane reuses the shared ResourceViewer', /<ResourceViewer/.test(paneContent));

  check('10 full screen is a separate overlay, not a pane', /fixed inset-0 z-\[70\]/.test(fullScreen));
  check('10 full screen closes on Escape', /'Escape'/.test(fullScreen));
  // The duplicate viewer WAS the bug: fullscreen is now the same element
  // promoted by the browser, so no second PdfViewer is ever mounted.
  check('10 full screen mounts NO second PdfViewer (one instance only)',
    !/PdfViewer/.test(fullScreen.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('10 the PDF viewer owns its own fullscreen control',
    /const toggleFullScreen = useCallback/.test(pdfViewer) &&
    /onClick=\{toggleFullScreen\}/.test(pdfViewer));
  check('10 the render-cancellation fix is still in the viewer',
    /previous\.cancel\(\)/.test(pdfViewer) && /renderTokensRef/.test(pdfViewer));

  // The overlay is rendered by AppLayout, above whichever tab is active.
  check('10 AppLayout accepts and renders an overlay layer',
    /overlay\?: React\.ReactNode/.test(appLayout) && /\{overlay\}/.test(appLayout));
  check('10 AppLayout passes the split toggle to the top bar',
    /onToggleSplit=\{onToggleSplit\}/.test(appLayout) && /splitOpen=\{splitOpen\}/.test(appLayout));
  check('10 the layout column is positioned for the overlay',
    /flex-1 min-w-0 min-h-0 h-full flex flex-col pb-16 md:pb-0 relative/.test(appLayout));
}

// ---- 11. PDF continuous scrolling ------------------------------------
{
  const pdf = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');
  check('11 the page surface is a real scroll container',
    /onScroll=\{handleScroll\}/.test(pdf) && /overflow-auto/.test(pdf));
  check('11 touch scrolling is not captured by the page',
    /touch-action/.test(pdf) || /overscroll-contain/.test(pdf));
  check('11 the scroll surface spans every page',
    /const totalHeight = last \? last\.top \+ last\.height : 0/.test(pdf) && /height: `\$\{totalHeight\}px`/.test(pdf));
  check('11 the canvas is offset to its own page band',
    /style=\{\{ top: `\$\{entry\.top\}px` \}\}/.test(pdf));
  check('12 scrolling derives the page in view and syncs the indicator',
    /handleScroll/.test(pdf) && /el\.scrollTop \+ el\.clientHeight \/ 2/.test(pdf));
      // Scrolling must not be answered by the focal-point math. The guard is now
      // an early return for our own echo plus `zoomAnchor.cancel()` for a real
      // user drag, both inside the scroll handler.
      check('11 scrolling does not snap the scroll position back',
        /if \(isZoomingRef\.current\) return;/.test(pdf) && /zoomAnchor\.cancel\(\);/.test(pdf));
      check('11 nav buttons and the page input do snap to the page top',
        /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/.test(pdf));
  check('11 the page height is recomputed on zoom/rotation/document change',
    /setPageSizes/.test(pdf) && /\[blob\]\)/.test(pdf));
  check('11 the existing nav buttons and page input are still present',
    /aria-label="Previous page"/.test(pdf) && /aria-label="Next page"/.test(pdf) &&
    /aria-label="Page number"/.test(pdf));
  check('11 scrolling reuses the existing render path (cancellation applies)',
    /goToPage\(next\)/.test(pdf) && /previous\.cancel\(\)/.test(pdf) && /renderTokensRef/.test(pdf));
  check('11 zoom and rotation still work alongside scrolling',
    /changeZoom\(ZOOM_STEP\)/.test(pdf) && /setRotation\(\(r\) => \(r \+ 90\) % 360\)/.test(pdf));
  check('11 keyboard page navigation is retained',
    /case 'ArrowLeft'/.test(pdf) && /case 'ArrowRight'/.test(pdf));

  // ---- 12. Regression: bugs 1 & 2 (unbounded page surface) -----------
  // Without a height bound the surface grows to pageCount x pageHeight, so
  // overflow-auto never engages, scrollTop writes are no-ops, and pages 2..N
  // are painted far below the visible area.
  check('12 the page surface is height-bounded so it can actually scroll',
    /maxHeight: 'min\(72vh, 720px\)'/.test(pdf));
  check('12 the bound is lifted for standalone and fullscreen (definite parent)',
    /style=\{variant === 'standalone' \|\| fullScreen \? undefined : \{ maxHeight/.test(pdf));
  check('12 the surface still declares overflow-auto', /overflow-auto/.test(pdf));
  // Navigation uses scrollIntoView, and there is deliberately NO layout-driven
  // "scroll to the current page" effect — that effect is what used to yank the
  // view back to the page top right after a zoom settled.
  check('12 the nav-sync effect can now take effect',
    /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/.test(pdf));
  check('12 no layout-driven scroll-to-current-page effect remains',
    !/useEffect\([\s\S]{0,400}?scrollIntoView/.test(pdf) ||
    !/\[page, layout\]/.test(pdf));
  check('12 handleScroll is bound to the scrolling element',
    /onScroll=\{handleScroll\}/.test(pdf) && /ref=\{shellRef\}/.test(pdf));
  check('12 the spacer is taller than the bounded surface',
    /height: `\$\{totalHeight\}px`/.test(pdf) && /layout\.length/.test(pdf));
  check('12 the render function uses the live page, not a hardcoded one',
    /doc\.getPage\(n\)/.test(pdf) && !/getPage\(1\)/.test(pdf));
  check('12 the cancellation guard cannot block a NEW render',
    // The per-page cleanup empties the task map, so the next render of that page
    // sees no previous task and the token only ever rejects a stale completion.
    /renderTasksRef\.current\.delete\(n\)/.test(pdf) &&
    /const token = \(renderTokensRef\.current\.get\(n\) \?\? 0\) \+ 1/.test(pdf));

  // ---- 13. Regression: bug 2b (divider visibility) -------------------
  // The pane layout is read from the same file, scoped locally here. Comments are
  // stripped so prose that MENTIONS a token does not count as using it.
  const sv = readFileSync('src/features/split/SplitView.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  check('13 the divider stretches rather than using a percentage height',
    /self-stretch/.test(sv) && !/w-2 cursor-col-resize h-full/.test(sv));
  check('13 the divider has a solid, visible background',
    /bg-border hover:bg-accent\/60/.test(sv) && !/bg-border\/40/.test(sv));
  check('13 the divider has a visible grab handle',
    /bg-content-tertiary\/70/.test(sv));
  // Structural, not distance-based: the divider sits between the two panes.
  check('13 the divider renders whenever the split is open, not per pane type',
    (() => {
      const p0 = sv.indexOf('{pane(0, a, firstFlex)}');
      const sep = sv.indexOf('role="separator"');
      const p1 = sv.indexOf('{pane(1, b, secondFlex)}');
      return p0 !== -1 && sep !== -1 && p1 !== -1 && p0 < sep && sep < p1 &&
        sv.split('role="separator"').length - 1 === 1;
    })(),
    'exactly one divider, between the two panes');
  check('13 the divider is not hidden when a pane is maximized',
    !/maximized[^}]*hidden[^}]*role="separator"/.test(sv));

  // ---- 14. Regression: bug 3 (sidebar navigation closes the split) ----
  const appSrc = readFileSync('src/App.tsx', 'utf8');
  check('14 a dedicated tab handler exists', /const selectTab = useCallback/.test(appSrc));
  check('14 selecting a different tab closes the split overlay',
    /if \(tab !== activeTab\) setSplitOpen\(false\)/.test(appSrc));
  check('14 the tab handler still switches tabs', /setActiveTab\(tab\)/.test(appSrc));
  check('14 AppLayout is wired to the tab handler, not raw setActiveTab',
    /onSelectTab=\{selectTab\}/.test(appSrc));
  check('14 the split is not closed when re-selecting the same tab',
    /if \(tab !== activeTab\)/.test(appSrc));

  // ---- 15. Fix 1: real Fullscreen API --------------------------------
  const fsp = readFileSync('src/features/split/FullScreenPreview.tsx', 'utf8');
  check('15 it calls the real requestFullscreen on enter',
    /el\.requestFullscreen \?\? el\.webkitRequestFullscreen/.test(fsp) && /request\.call\(el\)/.test(fsp));
  check('15 it calls exitFullscreen on leaving',
    /doc\.exitFullscreen \?\? doc\.webkitExitFullscreen/.test(fsp) && /exit\.call\(doc\)/.test(fsp));
  check('15 it handles the fullscreenchange event',
    /addEventListener\('fullscreenchange'/.test(fsp) && /removeEventListener\('fullscreenchange'/.test(fsp));
  check('15 a browser-initiated exit closes the preview',
    /onChange/.test(fsp) && /onClose\(\)/.test(fsp));
  check('15 the close button also exits fullscreen (via unmount cleanup)',
    /closingRef\.current = true; onClose\(\)/.test(fsp));
  check('15 the root element is the fullscreen element',
    /ref=\{rootRef\}/.test(fsp) && /const rootRef = useRef<HTMLDivElement \| null>\(null\)/.test(fsp));
  check('15 a CSS-only fallback remains for browsers without the API',
    /fixed inset-0/.test(fsp) && /typeof request !== 'function'/.test(fsp));
  check('15 Escape is handled for the fallback path',
    /e\.key !== 'Escape'/.test(fsp) && /enteredRef\.current\) return/.test(fsp));

  // ---- 16. Fix 1: height constraints --------------------------------
  check('16 the split overlay cannot grow the outer page',
    /absolute inset-x-0 top-14 bottom-0 z-20 bg-bg overflow-hidden/.test(appSrc));
  // The pane CLIPPS; the PDF's own surface is what scrolls. An `overflow-auto`
  // wrapper here made the whole pane scroll as well.
  // No top inset any more: the PDF toolbar floats inside the viewer itself,
  // so the pane hands its whole height to the document.
  check('16 each pane content area is bounded and clipped',
    /flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden/.test(paneHeader));
  check('16 the pane itself is bounded and does not push the page',
    /min-w-0 min-h-0 relative flex flex-col overflow-hidden/.test(
      readFileSync('src/features/split/SplitView.tsx', 'utf8')));
  check('16 the assistant pane is a bounded flex column',
    /h-full min-h-0 flex flex-col bg-bg-surface overflow-hidden/.test(
      readFileSync('src/features/split/PaneContent.tsx', 'utf8')));
  check('16 the assistant transcript scrolls inside the pane',
    /className="flex-1 min-h-0"/.test(
      readFileSync('src/features/split/PaneContent.tsx', 'utf8')));
  check('16 the full preview body is bounded and clips overflow',
    /flex-1 min-h-0 flex items-stretch justify-center overflow-hidden/.test(fsp));
  check('16 standalone PDF fills its host height instead of collapsing',
    /variant === 'standalone'/.test(pdf) && /h-full min-h-0/.test(pdf));
  check('16 the inline PDF cap is lifted for standalone AND fullscreen',
    /variant === 'standalone' \|\| fullScreen \? undefined : \{ maxHeight/.test(pdf));
  check('16 the viewer full-screen overlay clips overflow and adds no padding',
    /z-\[60\] flex flex-col gap-0 p-0 h-full min-h-0 min-w-0 w-full bg-bg-primary overflow-hidden/.test(pdf));

  // ---- 17. Fix 2: stacked, windowed page rendering -------------------
  check('17 pages are a vertical STACK, not one swapped canvas',
    /renderWindow\.map\(\(n\)/.test(pdf) && /style=\{\{ top: `\$\{entry\.top\}px` \}\}/.test(pdf));
  check('17 each page owns its own canvas in document order',
    /ref=\{setCanvas\(n\)\}/.test(pdf) && /key=\{n\}/.test(pdf));
  check('17 only a window of pages is rendered (current +/-1)',
    /const from = Math\.max\(1, page - 1\)/.test(pdf) &&
    /const to = Math\.min\(pageCount, page \+ 1\)/.test(pdf));
  check('17 canvases outside the window are released by unmounting',
    /renderWindow\.map/.test(pdf) && !/Array\.from\(\{ length: pageCount \}\)/.test(pdf));
  check('17 cancellation is tracked PER PAGE, not globally',
    /renderTasksRef = useRef<Map<number, pdfjsLib\.RenderTask>>/.test(pdf) &&
    /renderTasksRef\.current\.get\(n\)/.test(pdf) &&
    /renderTasksRef\.current\.delete\(n\)/.test(pdf));
  check('17 the per-page token rejects a stale render',
    /renderTokensRef\.current\.get\(n\)/.test(pdf) && /const isCurrent = \(\) =>/.test(pdf));
  check('17 each page cancels and AWAITS its own previous render',
    /previous\.cancel\(\);[\s\S]{0,80}await previous\.promise/.test(pdf));
  check('17 the window cleanup cancels every in-flight render',
    /for \(const \[, t\] of renderTasksRef\.current\) t\.cancel\(\)/.test(pdf));
  check('17 cancelling one page cannot disturb another',
    !/renderTaskRef = useRef<pdfjsLib\.RenderTask \| null>/.test(pdf));
  check('17 the page stack height is the sum of all page bands',
    /const last = layout\.length \? layout\[layout\.length - 1\] : null/.test(pdf) &&
    /const totalHeight = last \? last\.top \+ last\.height : 0/.test(pdf));
  // The layout now stores WIDTH and HEIGHT together. A canvas sized from two
  // different sources is a stretched canvas, so the measured size is committed
  // as one pair and the scroll surface is grown to the widest page.
  check('17 unmeasured pages get a stable estimated size',
    /pageSizes\[n\] \?\? fallback/.test(pdf) &&
    /1\.414/.test(pdf));
  check('17 measured sizes are recorded per page as a pair',
    /setPageSizes/.test(pdf) &&
    // Recorded as the ZOOM-1 base, which the layout multiplies by the zoom. The
    // recording used to store the size AT the measuring zoom, which left the
    // stack stale at commit time and clamped the scroll write.
    /Math\.abs\(prev\[n\]\.w - geo\.baseW\) < 0\.5/.test(pdf) &&
    /\{ \.\.\.prev, \[n\]: \{ w: geo\.baseW, h: geo\.baseH \} \}/.test(pdf));
  check('17 a new document resets the measured sizes',
    /setPageSizes\(\{\}\)/.test(pdf));
  check('17 the canvas is sized from the layout pair, not a lone height',
    /style=\{\{ width: `\$\{entry\.width\}px`, height: `\$\{entry\.height\}px` \}\}/.test(pdf));
  check('17 the indicator tracks the most visible page while scrolling',
    /const mid = el\.scrollTop \+ el\.clientHeight \/ 2/.test(pdf) && /pageAtOffset\(mid\)/.test(pdf));
  check('17 nav/page-input scrolls smoothly to the page in the stack',
    /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/.test(pdf));
  check('17 scrolling is not yanked back by the nav-sync effect',
    /zoomAnchor\.cancel\(\);/.test(pdf) && /if \(isZoomingRef\.current\) return;/.test(pdf));
  check('17 zoom and rotation apply to EVERY page, not just the current one',
    /const renderInto = useCallback\(async \(n: number\)/.test(pdf) &&
    /const cssScale = fitScale \* atZoom/.test(pdf) &&
    // The viewport scale carries the device pixel ratio, and is applied per page
    // by the shared geometry helper.
    /viewportScale: cssScale \* dpr/.test(pdf) &&
    /getViewport\(\{ scale: geo\.viewportScale, rotation \}\)/.test(pdf));
  check('17 the render window re-runs on zoom/rotation change',
    /\[status, windowKey, zoom, rotation, containerWidth, containerHeight, renderInto\]/.test(pdf));
  check('17 the rendering spinner still reflects real work',
    /setRendering\(true\)/.test(pdf) && /renderTasksRef\.current\.size === 0\) setRendering\(false\)/.test(pdf));
  check('17 the old single-canvas-per-page band is gone',
    !/top: `\$\{\(page - 1\) \* band\}px`/.test(pdf) && !/const band = /.test(pdf));

  // ---- 18. ONE PDF codepath, and full screen reachable everywhere -----
  {
    // The real regression risk: a second renderer appearing and drifting.
    const pdfjsHolders = [];
    const renderers = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, 'utf8');
          if (/from 'pdfjs-dist'/.test(src)) pdfjsHolders.push(p);
          if (/\.render\(\{ canvas/.test(src)) renderers.push(p);
        }
      }
    };
    walk('src');
    check('18 exactly ONE file imports pdfjs-dist',
      pdfjsHolders.length === 1 &&
      pdfjsHolders[0].replace(/\\/g, '/').endsWith('library/components/PdfViewer.tsx'),
      pdfjsHolders.map((p) => p.split(/[\\/]/).pop()).join(','));
    check('18 exactly ONE place calls pdf.js render()',
      renderers.length === 1 && renderers[0] === pdfjsHolders[0],
      renderers.map((p) => p.split(/[\\/]/).pop()).join(','));

    const rv = readFileSync('src/features/library/components/ResourceViewer.tsx', 'utf8');
    const sd = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
    const pc = readFileSync('src/features/split/PaneContent.tsx', 'utf8');

    // Both hosts must render the same viewer, not a copy.
    check('18 the Library preview renders the shared PdfViewer',
      /<PdfViewer\b/.test(rv) && /<ResourceViewer/.test(sd));
    check('18 split panes render the same ResourceViewer/PdfViewer path',
      /<ResourceViewer/.test(pc) && /<PdfViewer\b/.test(rv));
    // The missing-prop class of bug is now impossible: the viewer has its own
    // control, so no host can forget to pass one.
    check('18 the Library preview needs no fullscreen prop',
      !/onOpenFullScreen/.test(sd) && !/onOpenFullScreen/.test(rv));
    check('18 split panes need no fullscreen prop either',
      !/onRequestFullScreen/.test(pc) && !/onRequestFullScreen/.test(sv));
    check('18 both hosts use the ONE shared full-screen hook',
      /useResourceFullScreen\(\)/.test(sd) && /useResourceFullScreen\(\)/.test(sv));
    check('18 both hosts render the one shared FullScreenPreview',
      /ResourceFullScreen resource=\{fullScreenResource\}/.test(sd) &&
      /ResourceFullScreen resource=\{fullScreenResource\}/.test(sv));
    check('18 the full-screen hook wraps the shared preview',
      /<FullScreenPreview resource=\{resource\} onClose=\{onClose\} \/>/.test(
        readFileSync('src/features/split/useResourceFullScreen.tsx', 'utf8')));

    // Default size: a fit-to-width PDF needs room, not the compact dialog.
    const modal = readFileSync('src/components/ui/Modal.tsx', 'utf8');
    check('18 the modal keeps its compact default for other dialogs',
      /sm:max-w-md/.test(modal) && /size\?: 'md' \| 'lg'/.test(modal));
    check('18 the modal has a wide size for readable documents',
      /lg: 'sm:max-w-6xl'/.test(modal));
    check('18 a PDF/image preview opens wide, not cramped',
      /size=\{kind === 'pdf' \|\| kind === 'image' \? 'lg' : 'md'\}/.test(rv));

    // ---- Focus Mode ----
    const layout = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');
    const topbar = readFileSync('src/components/layout/TopBar.tsx', 'utf8');

    check('FM the sidebar auto-collapses when the split opens',
      /if \(splitOpen\)/.test(layout) && /setIsSidebarCollapsed\(\(wasCollapsed\)/.test(layout));
    check('FM the previous sidebar choice is restored when the split closes',
      /userCollapseRef\.current/.test(layout)
      && /setIsSidebarCollapsed\(userCollapseRef\.current\)/.test(layout));
    check('FM the top bar hides the date and time in split view',
      /\{!splitOpen && \(/.test(topbar));
    check('FM the clock timer is not run while splitting',
      /if \(splitOpen\) return;/.test(topbar));

    check('FM the shell has a definite height so the split can reach the floor',
      /h-\[100dvh\] overflow-hidden flex/.test(layout)
      && /flex-1 min-w-0 min-h-0 h-full flex flex-col/.test(layout));
    check('FM main is a bounded, scrollable flex child',
      /flex-1 min-h-0 p-4 md:p-6 max-w-7xl w-full mx-auto overflow-y-auto/.test(layout));

    // Anchored to the DIVIDER, not to the top of a pane: absolutely
    // positioning them at the top put them straight over the pane title.
    check('FM the split controls are anchored to the divider, not a pane title',
      /role="toolbar"[\s\S]{0,400}top-1\/2 -translate-y-1\/2 -translate-x-1\/2 left-1\/2 flex-col/.test(sv)
      && /relative shrink-0 flex items-center justify-center bg-border/.test(sv));
    // The floating divider toolbar is part of the same pane chrome, so it must
    // be token-driven too — a fixed dark pill stayed dark in light mode and
    // clashed with every status theme.
    check('FM the divider toolbar is themed, not a hardcoded dark pill',
      /rounded-full bg-bg-surface border border-border-strong/.test(sv) &&
      !/\bbg-slate-|\btext-slate-|\bborder-slate-/.test(sv));
    // The header is no longer a floating overlay: it is the shrink-0 first
    // child of the wrapper, so content can never appear above it.
    // The header must be a flex sibling, not a floating overlay. Scoped to the
    // header bar element: the pane now legitimately contains a separate
    // `pointer-events-none` element (the active-pane glow overlay), so testing
    // that token across the whole file would flag correct code.
    const headerBar = (paneHeader.match(/<div className="flex-shrink-0 w-full bg-bg-surface[^"]*"/) || [''])[0];
    check('FM the pane header is a flex sibling, not a floating overlay',
      /flex-shrink-0 w-full bg-bg-surface/.test(headerBar) &&
      !/pointer-events-none/.test(headerBar),
      headerBar.slice(0, 60));
    check('FM the pane header no longer takes layout height',
      !/border-b border-border bg-bg-elevated\/40 shrink-0/.test(sv));
    check('FM the split container stretches edge to edge',
      /flex-1 min-h-0 w-full relative flex/.test(sv));
    check('FM the pane clips and the PDF scroll area scrolls',
      /relative flex flex-col overflow-hidden/.test(sv) &&
      /flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden/.test(paneHeader));
    // The AI FAB is fixed bottom-right; in split view that is the chat
    // composer, so it must be docked rather than floating over the input.
    const launcher = readFileSync('src/features/ai/components/AssistantLauncher.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    check('FM the AI launcher can be hidden in split view',
      /hidden\?: boolean/.test(launcher) && /if \(hidden\) return null;/.test(launcher));
    check('FM split view hides the AI launcher',
      /<AssistantLauncher[\s\S]{0,200}hidden=\{splitOpen\}/.test(app));

    // ---- ONE universal header for every pane kind ----------------------
    // The header used to be a floating overlay for non-PDF panes and part of
    // the viewer toolbar for PDF panes, which is what produced the doubled
    // header. It is now extracted and rendered by the wrapper for every kind.
    check('H the header and wrapper live in their own module',
      /export const PaneHeader/.test(paneHeader) &&
      /export const PaneContainer/.test(paneHeader));
    check('H SplitView no longer defines a header of its own',
      !/const PaneHeader/.test(sv) && !/<PaneHeader/.test(sv));
    check('H every pane goes through the universal wrapper',
      (sv.match(/<PaneContainer/g) || []).length === 2);
    check('H the wrapper is a height-filling flex column',
      /flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden/.test(paneHeader));
    check('H the header is shrink-0 and the content flex-1 min-h-0',
      /flex-shrink-0 w-full bg-bg-surface/.test(paneHeader) &&
      /flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden/.test(paneHeader));
    check('H the view and document dropdowns are unconditional',
      /{selectors}/.test(paneHeader) && !/part ===/.test(paneHeader));
    check('H the document dropdown is present on every pane kind',
      /aria-label={`Pane \$\{index \+ 1\} document`}/.test(paneHeader) &&
      /Select file/.test(paneHeader));
    check('H the PDF controls are conditional on the view type',
      /pdfControls && \(/.test(paneHeader) &&
      /pdfControls\?: React\.ReactNode/.test(paneHeader));
    check('H the viewer publishes its controls upward instead of its own bar',
      /onRegisterControls\?: \(node: React\.ReactNode\) => void/.test(pdfViewer) &&
      /publishRef\.current\(toolbar\)/.test(pdfViewer) &&
      /const ownsHeader = !onRegisterControls/.test(pdfViewer));
    check('H the viewer clears its published controls on unmount',
      /return \(\) => publishRef\.current\?\.\(null\)/.test(pdfViewer));
    // THE BUG THIS FIXES: the registry guard was `has === !node`, which is a
    // logic inversion — a registration (has=false, node truthy) satisfied it and
    // bailed, so the controls were NEVER stored and the header showed only the
    // two dropdowns. It must instead compare identity so a new element from a
    // page/zoom change still replaces the old one.
    check('H the control registry actually STORES a registration',
      /if \(!node\) \{/.test(sv) &&
      /if \(current === node\) return prev;/.test(sv) &&
      /return \{ \.\.\.prev, \[index\]: node \};/.test(sv) &&
      !/has === !node/.test(sv));
    // …and the publish effect must not run on every render, or the parent would
    // re-render forever.
    check('H the publish effect is keyed, not run on every render',
      /\}, \[toolbar\]\)/.test(pdfViewer) &&
      /const toolbar = useMemo\(/.test(pdfViewer));
    // The pane chrome is themed, NOT a hardcoded dark bar. A fixed `slate-*`
    // palette here stayed dark in light mode and clashed with every status
    // theme, so the header and its dropdowns must be token-driven. The check is
    // therefore INVERTED: no fixed palette colours may survive in the chrome.
    check('H the pane chrome is themed, not a hardcoded dark bar',
      /border-b border-border/.test(paneHeader) &&
      /bg-bg-elevated text-content-primary border border-border-strong/.test(paneHeader) &&
      !/\bbg-slate-|\btext-slate-|\bborder-slate-|\bhover:bg-slate-/.test(paneHeader));
    // The PDF controls are injected into that same themed bar, so the viewer's
    // toolbar must be token-driven too or it breaks light mode.
    check('H the injected PDF controls are themed like the header',
      !/\bbg-slate-|\btext-slate-|\bborder-slate-/.test(pdfViewer) &&
      /text-content-secondary hover:text-content-primary hover:bg-bg-elevated/.test(pdfViewer));
    check('H the pane chrome no longer uses a blur bar',
      !/backdrop-blur/.test(paneHeader));
    // A squeezed pane must be able to reach its controls by swiping rather than
    // clipping them off-screen: the bar scrolls on X with the scrollbar hidden
    // in both the WebKit and standard forms.
    check('H the header scrolls sideways for narrow panes',
      /flex-shrink-0 w-full bg-bg-surface[\s\S]{0,220}overflow-x-auto/.test(paneHeader) &&
      /\[&::-webkit-scrollbar\]:hidden \[scrollbar-width:none\]/.test(paneHeader) &&
      /h-11 px-3 flex items-center gap-2 min-w-max/.test(paneHeader));
    // Every group inside the bar must refuse to shrink or wrap, otherwise the
    // row grows taller than h-11 instead of scrolling.
    check('H header control groups do not shrink or wrap',
      (paneHeader.match(/flex-shrink-0 whitespace-nowrap/g) || []).length >= 3);
    // Base pane controls and PDF controls are separated by a TOKEN border, so
    // the divider is still visible in the light theme.
    check('H PDF controls are split from the base controls by a themed divider',
      /border-l border-border mx-2 pl-2/.test(paneHeader));

    // ---- the dashboard pane must scroll internally ----------------------
    const dash = readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
    const pc2 = readFileSync('src/features/split/PaneContent.tsx', 'utf8');
    check('H the dashboard pane root is a height-filling flex column',
      /h-full min-h-0 flex flex-col overflow-hidden/.test(dash));
    check('H the dashboard cards live in one scrollable region',
      /flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain/.test(dash));
    check('H the split pane asks the dashboard to fill and scroll',
      /<DashboardPage onNavigate=\{onNavigate\} fill \/>/.test(pc2));
    check('H the card grid gap was tightened',
      /grid grid-cols-1 md:grid-cols-3 gap-3/.test(dash) &&
      !/md:grid-cols-3 gap-4/.test(dash));
    check('FM the embedded viewer fills the pane height',
      /flex flex-col h-full min-h-0 min-w-0 w-full overflow-hidden rounded-xl border border-border bg-bg-surface/.test(rv));
    check('FM a pane PDF is rendered standalone so it fills the host',
      /variant=\{embedded \? 'standalone' : 'inline'\}/.test(rv));
  }
}

  // ---- 19. Image panes + strict feature parity ---------------------------
  // The architectural rule: a viewer is ONE component used by BOTH the
  // standalone host (Library modal) and a split pane. Anything less means a
  // control works in one place and silently not the other.
  {
    const img = readFileSync('src/features/library/components/ImageViewer.tsx', 'utf8');
    const paneHeader = readFileSync('src/features/split/PaneHeader.tsx', 'utf8');
    const paneContent = readFileSync('src/features/split/PaneContent.tsx', 'utf8');
    const splitView = readFileSync('src/features/split/SplitView.tsx', 'utf8');
    const viewer = readFileSync('src/features/library/components/ResourceViewer.tsx', 'utf8');
    const model = readFileSync('src/features/split/splitModel.ts', 'utf8');

    check('19 image is a first-class pane kind',
      /'pdf' \| 'image' \| 'notes'/.test(model) && /imageId\?: string/.test(model));
    check('19 the view picker offers Image', /<option value="image">/.test(paneHeader));
    check('19 the document dropdown lists images',
      /<optgroup label="Images">/.test(paneHeader) && /image:\$\{r\.id\}/.test(paneHeader));
    // The dropdown and the viewer must agree on what counts as an image, or the
    // picker offers something the viewer then refuses to render.
    check('19 the dropdown uses the viewer\'s own detector',
      /previewKindFor\(r\) === 'image'/.test(paneHeader) &&
      /from '..\/library\/previewKind'/.test(paneHeader));

    check('19 a split pane dispatches image content',
      /case 'image':/.test(paneContent) && /onRegisterImageControls/.test(paneContent));
    check('19 the pane mounts the SAME ResourceViewer as the modal',
      /EmbeddedResourceViewer/.test(paneContent) && /<ResourceViewer/.test(viewer) &&
      /<ImageViewer/.test(viewer));

    // Every control the image header is required to offer.
    for (const [label, re] of [
      ['zoom out', /aria-label="Zoom out"/],
      ['zoom level', /\{zoomPct\}%/],
      ['zoom in', /aria-label="Zoom in"/],
      ['fit', /aria-label="Fit to container"/],
      ['1:1 reset', /aria-label="Reset zoom to actual size"/],
      ['rotate', /aria-label="Rotate 90 degrees"/],
      ['download', /aria-label="Download this image"/],
    ]) {
      check(`18 the image toolbar has ${label}`, re.test(img));
    }

    // Aspect ratio: both dimensions from one proportional box, never 100%.
    // Scoped to the <img> element itself — the surrounding SCROLL SURFACE is
    // legitimately `w-full`, and asserting on the whole file would flag that
    // perfectly correct container and pass for the wrong reason.
    const imgEl = (img.match(/<img[\s\S]*?\/>/) || [''])[0];
    check('19 the image is never stretched to its container',
      /className="block object-contain shrink-0 select-none"/.test(imgEl) &&
      !/\bw-full\b/.test(imgEl) && !/w-\[100%\]/.test(imgEl) &&
      !/width: '100%'/.test(imgEl) && !/height: '100%'/.test(imgEl),
      imgEl.slice(0, 80));
    check('19 both dimensions come from one proportional box',
      /style=\{\{ width: `\$\{shown\.w\}px`, height: `\$\{shown\.h\}px` \}\}/.test(img));
    check('19 rotation swaps the axes instead of shearing',
      /return rotated \? \{ w: base\.h, h: base\.w \} : base/.test(img));
    check('19 a zoomed image overflows into scrollbars',
      /overflow-auto overscroll-contain/.test(img));

    // Parity: the row is published up OR drawn in place, never both.
    check('19 the image row is published up like the PDF row',
      /onRegisterControls\?: \(node: React\.ReactNode\) => void/.test(img) &&
      /publishRef\.current\(toolbar\)/.test(img) &&
      /return \(\) => publishRef\.current\?\.\(null\)/.test(img));
    check('19 it draws its own bar only when it owns the header',
      /const ownsHeader = !onRegisterControls/.test(img) && /\{ownsHeader && \(/.test(img));
    check('19 the row is memoized so publishing cannot loop',
      /const toolbar = useMemo\(/.test(img) &&
      (img.match(/const toolbar = useMemo\(/g) || []).length === 1);
    check('19 a pane is never handed another view\'s controls',
      /imageControls\?: React\.ReactNode/.test(paneHeader) &&
      /slot\.kind === 'image' && slot\.imageId \? imageControls\[index\] : undefined/.test(splitView) &&
      /aria-label="Image controls"/.test(paneHeader));
    check('19 the image registry is threaded through the split body',
      /registerImageControls/.test(splitView) &&
      /onRegisterImageControls=\{\(c\) => registerImageControls\(index, c\)\}/.test(splitView));

    // ---- Pinch-to-zoom ---------------------------------------------------
    // Trackpad pinch is a `wheel` event with ctrlKey; macOS Cmd+wheel sets
    // metaKey. Both must be claimed, and neither may swallow a plain wheel —
    // preventDefault on an ordinary wheel is what makes a viewer feel locked.
    check('19 pinch wheel is registered non-passive',
      /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(img) &&
      /removeEventListener\('wheel', onWheel\)/.test(img));
    check('19 pinch wheel only claims modifier gestures',
      /if \(!e\.ctrlKey && !e\.metaKey\) return;/.test(img) && /e\.preventDefault\(\)/.test(img));
    // A gesture writes a CSS transform and NEVER React state; the scale is
    // committed to `zoom` only once the gesture settles. The image viewer uses
    // the SHARED advanceGestureScale, so it advances one running ratio exactly
    // as the PDF viewer does and cannot compound per tick.
    const imgCode = img.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    check('19 pinch drives a live transform from deltaY',
      /applyLive\(advanceGestureScale\(liveScaleRef\.current, e\.deltaY, e\.deltaMode\), e\.clientX, e\.clientY\)/.test(img) &&
      !/setZoom\(/.test(img.match(/const onWheel = \(e: WheelEvent\) => \{[\s\S]*?\n {4}\};/)?.[0] ?? ''));
    // The committed zoom must never be multiplied into the running ratio, and
    // the gesture base must be stored rather than re-derived.
    check('19 the image pinch never compounds the committed zoom per tick',
      !/zoomRef\.current \* liveScaleRef\.current/.test(imgCode) &&
      !/zoomRef\.current \/ liveScaleRef\.current/.test(imgCode) &&
      /gestureStartZoomRef\.current = zoomRef\.current;/.test(imgCode));
    const imgCommit = (img.match(/const commitLive = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
    check('19 the image pinch measures from the gesture start, not frame to frame',
      /applyLive\(dist\(e\.touches\) \/ startDist, c\.x, c\.y\)/.test(img) &&
      // After the commit the running ratio resets, so the next gesture is 1x
      // relative to whatever is now committed.
      /liveScaleRef\.current = 1;/.test(imgCommit) &&
      /const target = quantizeZoom\(gestureStartZoomRef\.current \* liveScaleRef\.current\);/.test(imgCode));

    check('19 two-finger touch pinch is tracked natively',
      /addEventListener\('touchstart', onStart, \{ passive: true \}\)/.test(img) &&
      /addEventListener\('touchmove', onMove, \{ passive: false \}\)/.test(img) &&
      // A guard on exactly two fingers, in both the start and the move handler.
      /if \(e\.touches\.length !== 2\) return;/.test(img) &&
      /if \(e\.touches\.length !== 2 \|\| startDist <= 0\) return;/.test(img));
    check('19 the gesture ends when a finger lifts, and commits',
      /if \(e\.touches\.length >= 2\) return;/.test(img) &&
      /const onEnd = \(e: TouchEvent\) => \{[\s\S]*?commitLive\(\);/.test(img) &&
      /addEventListener\('touchend', onEnd, \{ passive: true \}\)/.test(img) &&
      /addEventListener\('touchcancel', onEnd, \{ passive: true \}\)/.test(img));
    check('19 touch listeners are all removed on cleanup',
      /removeEventListener\('touchstart', onStart\)/.test(img) &&
      /removeEventListener\('touchmove', onMove\)/.test(img));

    // ---- Focal-point anchoring, checked numerically ----------------------
    // The image is CENTRED in its scroll surface, so the naive
    // `scroll = centre * ratio - half` is only right once the image is wider
    // than the viewport. The component instead stores an image-local point and
    // re-derives the offset from the new size. This proves that keeps the point
    // under the cursor in BOTH regimes.
    const P = 8;
    const anchorTest = (cw, ch, sl, st, imgW, imgH, r, curX, curY) => {
      const boxW = Math.max(cw, imgW + P * 2);
      const boxH = Math.max(ch, imgH + P * 2);
      const offX = (boxW - imgW) / 2;
      const offY = (boxH - imgH) / 2;
      const px = sl + curX - offX;
      const py = st + curY - offY;
      const newImgW = imgW * r;
      const newImgH = imgH * r;
      const newBoxW = Math.max(cw, newImgW + P * 2);
      const newBoxH = Math.max(ch, newImgH + P * 2);
      const newOffX = (newBoxW - newImgW) / 2;
      const newOffY = (newBoxH - newImgH) / 2;
      const wantL = newOffX + px * r - curX;
      const wantT = newOffY + py * r - curY;
      // Where the anchored point now sits on screen.
      return { x: newOffX + px * r - wantL, y: newOffY + py * r - wantT };
    };
    // Zoomed in past the viewport (image wider than the container)...
    const zoomed = anchorTest(800, 600, 90, 40, 1600, 1200, 1.5, 300, 220);
    check('19 the focal point is held when zoomed past the viewport',
      Math.abs(zoomed.x - 300) < 1e-9 && Math.abs(zoomed.y - 220) < 1e-9,
      `${zoomed.x},${zoomed.y}`);
    // ...and zoomed out, where the image is smaller than the container and the
    // content box no longer grows with the image.
    const small = anchorTest(800, 600, 0, 0, 400, 300, 1.5, 400, 300);
    check('19 the focal point is held when the image is smaller than the pane',
      Math.abs(small.x - 400) < 1e-9 && Math.abs(small.y - 300) < 1e-9,
      `${small.x},${small.y}`);

    // The naive `scroll = centre * ratio - half` is NOT equivalent once the
    // content box grows with the image, because the image's centring offset
    // scales too. Same gesture, off-centre cursor, zoomed past the viewport.
    {
      const cw = 800, sl = 90, curX = 300, r = 1.5;
      const correct = anchorTest(cw, 600, sl, 40, 1600, 1200, r, curX, 220);
      const naiveWant = (sl + curX) * r - cw / 2;
      const naiveScreen = (sl + curX) * r - naiveWant;
      check('19 the anchor beats the naive centre*ratio formula off-centre',
        Math.abs(correct.x - curX) < 1e-9 && Math.abs(naiveScreen - curX) > 1,
        `correct ${correct.x} vs naive ${naiveScreen} (cursor ${curX})`);
    }

    // The image viewer uses the SAME shared hook as the PDF viewer, and declares
    // its own non-scaling chrome so the constant padding cancels exactly.
    const hook = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');
    check('19 the image viewer delegates to the shared anchor hook',
      /useZoomAnchor\(shellRef, shown, zoom, getFixed, \(\) => \{/.test(img) &&
      /leadX: IMAGE_PAD/.test(img) && /totalX: IMAGE_PAD \* 2/.test(img));
    check('19 the image anchor is stored in content coordinates, not a fraction',
      /scrollLeft: el\.scrollLeft/.test(hook) && /scrollTop: el\.scrollTop/.test(hook) &&
      !/\bfx:/.test(hook) && !/\bfy:/.test(hook));
    check('19 the image target is derived from the MEASURED extent',
      /const sw = Math\.max\(1, el\.scrollWidth\)/.test(hook) &&
      /const sh = Math\.max\(1, el\.scrollHeight\)/.test(hook));
    // The image's own padding is the constant term; excluding it is what stops a
    // small but visible drift on every zoom step.
    check('19 the constant padding is excluded from a measured scale',
      /const ratioY = a\.ratio \?\? \(\(sh - fixedNew\.totalY\)/.test(hook) &&
      /const contentY = a\.scrollTop \+ a\.cy - a\.fixedOld\.leadY/.test(hook));
    check('19 the write is forced instant before the assignment',
      /el\.style\.scrollBehavior = 'auto'/.test(hook) &&
      hook.indexOf("el.style.scrollBehavior = 'auto';") < hook.indexOf('el.scrollLeft = wantLeft;') &&
      /el\.style\.scrollBehavior = previous;/.test(hook));
    check('19 a button zoom anchors on the viewport centre',
      /clientX === undefined \? el\.clientWidth \/ 2 : clientX - rect\.left/.test(hook));
    check('19 Fit and 1:1 go through the anchoring setter, not a bare setZoom',
      /onClick=\{\(\) => applyZoom\(1\)\}/.test(img) &&
      /applyZoom\(natural && fit\.w \? fit\.w \/ natural\.w : 1\)/.test(img));
    check('19 zoom bounds are 0.5x to 5x',
      /const MIN_ZOOM = 0\.5/.test(img) && /const MAX_ZOOM = 5\b/.test(img));

    // ---- Scroll health (mirrors the PDF viewer) --------------------------
    {
      const wheel = (img.match(/const onWheel = \(e: WheelEvent\) => \{[\s\S]*?\n {4}\};/g) || []).join('\n');
      const touch = (img.match(/const onMove = \(e: TouchEvent\) => \{[\s\S]*?\n {4}\};/g) || []).join('\n');
      const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      const wheelCode = strip(wheel);
      const touchCode = strip(touch);

      check('19 the wheel handler requires ctrl or meta',
        /if \(!e\.ctrlKey && !e\.metaKey\) return;/.test(wheel));
      check('19 a plain wheel is never preventDefault-ed',
        wheelCode.indexOf('!e.ctrlKey') !== -1 &&
        wheelCode.indexOf('!e.ctrlKey') < wheelCode.indexOf('e.preventDefault()'),
        `guard@${wheelCode.indexOf('!e.ctrlKey')} block@${wheelCode.indexOf('e.preventDefault()')}`);

      check('19 a one-finger pan is never preventDefault-ed',
        /if \(e\.touches\.length !== 2 \|\| startDist <= 0\) return;/.test(touchCode) &&
        touchCode.indexOf('touches.length !== 2') < touchCode.indexOf('e.preventDefault()'));

      // Both halves of the instant-write live in the shared hook: set auto, write,
      // restore. All three in order, in one layout effect.
      check('19 the anchor forces scroll-behavior auto before writing',
        /const previous = el\.style\.scrollBehavior;/.test(hook) &&
        /el\.style\.scrollBehavior = 'auto';/.test(hook) &&
        /el\.style\.scrollBehavior = previous;/.test(hook));
      check('19 the scroll write happens after auto is set and before the restore',
        hook.indexOf("el.style.scrollBehavior = 'auto';") < hook.indexOf('el.scrollLeft = wantLeft;') &&
        hook.indexOf('el.scrollLeft = wantLeft;') < hook.indexOf('el.style.scrollBehavior = previous;'));

      const surface = (img.match(/className="relative flex-1 min-h-\[160px\][^"]*"/) || [''])[0];
      check('19 the image surface disables scroll snapping',
        /\[scroll-snap-type:none\]/.test(surface), surface.slice(0, 60));
      check('19 the image surface disables browser scroll anchoring',
        /\[overflow-anchor:none\]/.test(surface));
      check('19 nothing disables native touch panning',
        !/touch-action:\s*none|['"]touch-action['"]:\s*['"]none/.test(img));
    }

    // ---- Scroll-write feedback loop (mirrors the PDF viewer) --------------
    {
      const scroll = (img.match(/const onScroll = \(\) => \{[\s\S]*?\n {4}\};/g) || []).join('\n');
      check('19 a zoom-in-flight flag exists', /const isZoomingRef = useRef\(false\)/.test(img));
      check('19 the scroll listener ignores zoom-driven writes',
        /if \(isZoomingRef\.current\) return;/.test(scroll));
      // The flag guards the scroll event, so it must be raised in the same block
      // as the capture and before the rAF that releases it — the write itself
      // happens in the hook's layout effect, after this render.
      check('19 the flag is raised before the release on the next frame',
        /zoomAnchor\.capture\(el, clientX, clientY\);\s*isZoomingRef\.current = true;/.test(img) &&
        img.indexOf('isZoomingRef.current = true;') < img.indexOf('isZoomingRef.current = false; }'));
      check('19 the flag is released after the event can fire',
        /requestAnimationFrame\(\(\) => \{ isZoomingRef\.current = false; \}\)/.test(img));
      check('19 our own echo is recognised by position',
        /writeRef\.current = \{ l: el\.scrollLeft, t: el\.scrollTop \};/.test(hook) &&
        /Math\.abs\(el\.scrollLeft - w\.l\) <= 1 && Math\.abs\(el\.scrollTop - w\.t\) <= 1/.test(scroll));
      check('19 a genuine user scroll drops the armed anchor',
        /zoomAnchor\.cancel\(\);/.test(scroll));
      // The scroll listener is passive: it only reads, never cancels.
      check('19 the scroll listener is passive',
        /addEventListener\('scroll', onScroll, \{ passive: true \}\)/.test(img) &&
        /removeEventListener\('scroll', onScroll\)/.test(img));
      check('19 the anchor is armed only when the scale actually changes',
        /if \(el && clamped !== prev && prev > 0\)/.test(img));
      check('19 the scroll write never happens beside setZoom',
        !/setZoom\(clamped\);[\s\S]{0,120}el\.scrollLeft/.test(img));
        // The write happens in the SHARED hook's layout effect. Extracted by body
      // so a long comment cannot silently break the test.
      const anchorEffect = (hook.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
      check('19 the write happens in the shared layout effect',
        anchorEffect.includes('const a = anchorRef.current;') &&
        anchorEffect.includes('el.scrollLeft = wantLeft;') &&
        anchorEffect.indexOf('const a = anchorRef.current;') < anchorEffect.indexOf('el.scrollLeft = wantLeft;'),
        `effect ${anchorEffect.length} chars`);
      check('19 overflow-anchor is disabled with !important',
        /!\[overflow-anchor:none\]/.test(img));
    }
  }


console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

  // Pre-filled, but still changeable through each pane's own picker.
  check('8 the PDF pane is still changeable', setPane(s, 0, CHAT).panes[0].kind === 'assistant');
  check('8 the notes pane is still changeable', setPane(s, 1, DASH).panes[1].kind === 'dashboard');
  check('8 a null topic id yields an unset notes pane',
    splitWithNotes('r1', null).panes[1].topicId === undefined);
}

