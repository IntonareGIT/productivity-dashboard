/**
 * Split view state model verification.
 *
 * Exercises the real splitModel.ts: the pure reducer behind the two-pane
 * layout. No DOM, no React, so the transitions can be checked directly —
 * including the rule that NOTHING is persisted (a refresh must reset).
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

  check('10 the split is React state in App, seeded from initialSplitState',
    /useState<SplitState>\(initialSplitState\)/.test(app));
  check('10 the dashboard tab hosts the split view',
    /activeTab === 'dashboard' \? \([\s\S]{0,200}SplitView/.test(app));
  check('10 App opens the PDF split via splitWithNotes', /splitWithNotes\(resourceId, topicId\)/.test(app));

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
    /previous\.cancel\(\)/.test(pdfViewer) && /renderTokenRef/.test(pdfViewer));
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

