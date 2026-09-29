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
  initialSplitState, splitWithNotes, openSplit, addSecondPane, swapPanes,
  closePane, setPane, toggleMaximize, isSplit, clampRatio, activeIndex,
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
  check('10 the icon is the only generic split entry point',
    (() => {
      // `onToggleSplit` legitimately appears in App/AppLayout/TopBar as prop
      // plumbing, and `addSecondPane` in the model that defines it. What must be
      // unique is the actual CALL SITE that adds a pane generically.
      const hits = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx$/.test(e.name) && /addSecondPane\(/.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      };
      walk('src');
      return hits.length === 1 && hits[0].replace(/\\/g, '/').endsWith('features/split/SplitView.tsx');
    })(),
    'only SplitView may add a pane generically');
  check('10 no other surface exposes a generic start-split button',
    !/Start split screen|startSplitScreen/.test(
      readFileSync('src/components/layout/Sidebar.tsx', 'utf8') +
      readFileSync('src/components/layout/BottomNav.tsx', 'utf8') +
      readFileSync('src/components/layout/ProfileMenu.tsx', 'utf8')));

  check('10 the empty pane kind exists with the instructional note',
    /case 'empty'/.test(paneContent) &&
    /Choose what to show in this pane: Dashboard, a PDF, Notes, or Assistant\./.test(paneContent));
  check('10 the empty pane has a light (dashed) border',
    /border-dashed/.test(paneContent));
  check('10 the icon opens a default empty split',
    /emptySplitState/.test(app) && /panes\.length > 1 \? s : emptySplitState/.test(app));
  check('10 every pane still has its own picker control',
    /Pane \$\{index \+ 1\} content/.test(splitView));


  check('10 two panes are side by side, stacked under 768px',
    /stacked \? 'flex-col' : 'flex-row'/.test(splitView) && /max-width: 767px/.test(splitView));
  check('10 the divider is draggable',
    /onPointerDown=\{onPointerDown\}/.test(splitView) && /pointermove/.test(splitView));
  check('10 the divider is keyboard operable',
    /role="separator"/.test(splitView) && /aria-label="Resize panes"/.test(splitView));

  check('10 each pane header has a content picker',
    /Pane \$\{index \+ 1\} content/.test(splitView));
  check('10 the picker offers all four kinds',
    /value="dashboard"/.test(splitView) && /value="pdf"/.test(splitView) &&
    /value="notes"/.test(splitView) && /value="assistant"/.test(splitView));
  check('10 the picker has PDF and topic sub-pickers',
    /Choose a file/.test(splitView) && /Choose a topic/.test(splitView));
  check('10 there is a swap control', /swapPanes\(s\)/.test(splitView));
  check('10 there is a close control collapsing to one pane', /closePane\(s, index\)/.test(splitView));
  check('10 a single pane can open the split', /addSecondPane\(s, \{ kind: 'assistant' \}\)/.test(splitView));
  check('10 a single pane can return to the dashboard', /setState\(initialSplitState\)/.test(splitView));
  check('10 a pane can be maximized and restored', /toggleMaximize\(s, index\)/.test(splitView));
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
  check('10 full screen mounts its own PdfViewer (independent state)',
    /lazy\(\(\) =>/.test(fullScreen) && /PdfViewer/.test(fullScreen));
  check('10 the PDF viewer exposes a full-screen control to the host',
    /onRequestFullScreen/.test(pdfViewer));
  check('10 the render-cancellation fix is still in the viewer',
    /previous\.cancel\(\)/.test(pdfViewer) && /renderTokensRef/.test(pdfViewer));

  // The overlay is rendered by AppLayout, above whichever tab is active.
  check('10 AppLayout accepts and renders an overlay layer',
    /overlay\?: React\.ReactNode/.test(appLayout) && /\{overlay\}/.test(appLayout));
  check('10 AppLayout passes the split toggle to the top bar',
    /onToggleSplit=\{onToggleSplit\}/.test(appLayout) && /splitOpen=\{splitOpen\}/.test(appLayout));
  check('10 the layout column is positioned for the overlay',
    /flex-1 flex flex-col min-w-0 pb-16 md:pb-0 relative/.test(appLayout));
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
  check('11 scrolling does not snap the scroll position back',
    /scrollDrivenRef/.test(pdf) && /scrollDrivenRef\.current = false; return/.test(pdf));
  check('11 nav buttons and the page input do snap to the page top',
    /el\.scrollTo\(\{ top: entry\.top, behavior: 'smooth' \}\)/.test(pdf));
  check('11 the page height is recomputed on zoom/rotation/document change',
    /setPageHeights/.test(pdf) && /\[blob\]\)/.test(pdf));
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
  check('12 the bound is lifted in full screen / standalone (definite parent)',
    /style=\{fullScreen \|\| variant === 'standalone' \? undefined : \{ maxHeight/.test(pdf));
  check('12 the surface still declares overflow-auto', /overflow-auto/.test(pdf));
  check('12 the nav-sync effect can now take effect', /el\.scrollTo\(\{ top: entry\.top/.test(pdf));
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
  check('16 each pane content area scrolls internally, bounded',
    /flex-1 min-h-0 overflow-auto/.test(
      readFileSync('src/features/split/SplitView.tsx', 'utf8')));
  check('16 the pane itself is bounded and does not push the page',
    /min-w-0 min-h-0 flex flex-col/.test(readFileSync('src/features/split/SplitView.tsx', 'utf8')));
  check('16 the assistant pane is a bounded flex column',
    /h-full min-h-0 flex flex-col bg-bg-surface overflow-hidden/.test(
      readFileSync('src/features/split/PaneContent.tsx', 'utf8')));
  check('16 the assistant transcript scrolls inside the pane',
    /className="flex-1 min-h-0"/.test(
      readFileSync('src/features/split/PaneContent.tsx', 'utf8')));
  check('16 the full preview body is bounded and clips overflow',
    /flex-1 min-h-0 flex items-stretch justify-center overflow-hidden/.test(fsp));
  check('16 standalone PDF fills its host height instead of collapsing',
    /variant === 'standalone' \? 'flex flex-col gap-3 h-full min-h-0'/.test(pdf) ||
    /'flex flex-col gap-3 h-full min-h-0'/.test(pdf));
  check('16 the inline PDF cap is lifted for standalone/full screen',
    /fullScreen \|\| variant === 'standalone' \? undefined : \{ maxHeight/.test(pdf));
  check('16 the viewer full-screen overlay also clips overflow',
    /z-\[60\] flex flex-col bg-bg-primary p-3 sm:p-5 overflow-hidden/.test(pdf));

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
  check('17 unmeasured pages get a stable estimated height',
    /pageHeights\[n\] \?\? fallbackHeight/.test(pdf) && /avgHeight \|\| Math\.round\(containerWidth \* 1\.414\)/.test(pdf));
  check('17 measured heights are recorded per page',
    /setPageHeights\(\(prev\) => \(prev\[n\] === cssH \? prev : \{ \.\.\.prev, \[n\]: cssH \}\)\)/.test(pdf));
  check('17 a new document resets the measured heights',
    /setPageHeights\(\{\}\)/.test(pdf));
  check('17 the indicator tracks the most visible page while scrolling',
    /const mid = el\.scrollTop \+ el\.clientHeight \/ 2/.test(pdf) && /pageAtOffset\(mid\)/.test(pdf));
  check('17 nav/page-input scrolls smoothly to the page in the stack',
    /el\.scrollTo\(\{ top: entry\.top, behavior: 'smooth' \}\)/.test(pdf));
  check('17 scrolling is not yanked back by the nav-sync effect',
    /scrollDrivenRef\.current = false; return/.test(pdf));
  check('17 zoom and rotation apply to EVERY page, not just the current one',
    /const renderInto = useCallback\(async \(n: number\)/.test(pdf) &&
    /const cssScale = \(containerWidth \/ unit\.width\) \* zoom/.test(pdf) &&
    /cssScale \* dpr, rotation/.test(pdf));
  check('17 the render window re-runs on zoom/rotation change',
    /\[status, windowKey, zoom, rotation, containerWidth, renderInto\]/.test(pdf));
  check('17 the rendering spinner still reflects real work',
    /setRendering\(true\)/.test(pdf) && /renderTasksRef\.current\.size === 0\) setRendering\(false\)/.test(pdf));
  check('17 the old single-canvas-per-page band is gone',
    !/top: `\$\{\(page - 1\) \* band\}px`/.test(pdf) && !/const band = /.test(pdf));
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

