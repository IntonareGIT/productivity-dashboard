/**
 * Resource preview dispatch verification.
 *
 * Exercises the real previewKindFor()/isGoogleDriveUrl()/googleDriveEmbedUrl()/
 * fileTypeLabel() from src/features/library/previewKind.ts, which decide which
 * viewer a resource gets. No DOM needed: the logic is deliberately pure and
 * separate from the React components.
 *
 * Also asserts, by source inspection, that the components honour the contract:
 * one Preview button, PDF delegated to the shared PdfViewer (not duplicated),
 * Word/PowerPoint never rendered inline, Download/Open link always available,
 * and a missing blob producing a clear message rather than a broken viewer.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'preview-'));
const outFile = join(outDir, 'kind.mjs');

await build({
  entryPoints: ['src/features/library/previewKind.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
});

const mod = await import(`file://${outFile.replace(/\\/g, '/')}`);
const { previewKindFor, isGoogleDriveUrl, googleDriveEmbedUrl, fileTypeLabel } = mod;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// The two-finger gesture maths lives in the shared hook, so every touch
// assertion reads that ONE implementation rather than an inline copy per viewer.
const hook10touch = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');

const BLOB = { __blob: true };
const res = (over = {}) => ({
  id: 'r1', subjectId: 's1', topicId: 't1', kind: 'file', title: 'Doc',
  urlOrPath: '', tags: [], completed: false, createdAt: '2024-01-01',
  ...over,
});

// ---- 1. Images render inline -------------------------------------------
{
  check('1 png -> image', previewKindFor(res({ blob: BLOB, mimeType: 'image/png', fileName: 'a.png' })) === 'image');
  check('1 jpeg -> image', previewKindFor(res({ blob: BLOB, mimeType: 'image/jpeg', fileName: 'a.jpg' })) === 'image');
  check('1 jpg extension alone -> image (no mime type)',
    previewKindFor(res({ blob: BLOB, mimeType: null, fileName: 'photo.jpg' })) === 'image');
  check('1 .png extension alone -> image (no mime type)',
    previewKindFor(res({ blob: BLOB, mimeType: null, fileName: 'shot.PNG' })) === 'image');
  // Out-of-scope image formats are not required inline.
  check('1 gif is opaque, not inline', previewKindFor(res({ blob: BLOB, mimeType: 'image/gif' })) === 'opaque');
}

// ---- 2. PDF renders inline via pdf.js ----------------------------------
{
  check('2 application/pdf -> pdf', previewKindFor(res({ blob: BLOB, mimeType: 'application/pdf' })) === 'pdf');
  check('2 .pdf extension -> pdf (no mime type)',
    previewKindFor(res({ blob: BLOB, mimeType: null, fileName: 'paper.pdf' })) === 'pdf');
  check('2 a PDF with no fileName still resolves',
    previewKindFor(res({ blob: BLOB, mimeType: 'application/pdf', fileName: null })) === 'pdf');
}

// ---- 3. Word / PowerPoint are download-only ----------------------------
{
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  check('3 docx -> opaque', previewKindFor(res({ blob: BLOB, mimeType: docx })) === 'opaque');
  check('3 pptx -> opaque', previewKindFor(res({ blob: BLOB, mimeType: pptx })) === 'opaque');
  check('3 legacy .doc -> opaque',
    previewKindFor(res({ blob: BLOB, mimeType: null, fileName: 'old.doc' })) === 'opaque');
  check('3 legacy .ppt -> opaque',
    previewKindFor(res({ blob: BLOB, mimeType: null, fileName: 'deck.ppt' })) === 'opaque');
  check('3 Word label', fileTypeLabel({ mimeType: docx, fileName: 'a.docx' }) === 'Word document', fileTypeLabel({ mimeType: docx, fileName: 'a.docx' }));
  check('3 PowerPoint label', fileTypeLabel({ mimeType: pptx, fileName: 'a.pptx' }) === 'PowerPoint presentation');
  check('3 docx/pptx are never routed to a renderer',
    ['a.docx', 'a.pptx'].every((f) => previewKindFor(res({ blob: BLOB, mimeType: null, fileName: f })) === 'opaque'));
}

// ---- 4. Google Drive links ---------------------------------------------
{
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
  const drive = `https://drive.google.com/file/d/${id}/view?usp=sharing`;
  check('4 drive link is detected', isGoogleDriveUrl(drive));
  check('4 drive link -> drive kind', previewKindFor(res({ kind: 'link', urlOrPath: drive })) === 'drive');
  check('4 drive embed url uses the file id',
    googleDriveEmbedUrl(drive) === `https://drive.google.com/file/d/${id}/preview`,
    String(googleDriveEmbedUrl(drive)));
  check('4 drive open?id= form detected', isGoogleDriveUrl(`https://drive.google.com/open?id=${id}`));
  check('4 drive uc?id= form detected', isGoogleDriveUrl(`https://drive.google.com/uc?id=${id}`));

  // Non-Drive links must NOT be treated as Drive.
  check('4 plain link is not drive', !isGoogleDriveUrl('https://example.com/file.pdf'));
  check('4 plain link -> link kind',
    previewKindFor(res({ kind: 'link', urlOrPath: 'https://example.com/x' })) === 'link');
  check('4 a lookalike domain is not drive',
    !isGoogleDriveUrl('https://notdrive.google.com.evil.com/file/d/x/view'));
  check('4 a non-Drive url yields no embed url', googleDriveEmbedUrl('https://example.com/file.pdf') === null);
  check('4 empty url yields no embed url', googleDriveEmbedUrl('') === null);
  check('4 null/undefined url is not drive', !isGoogleDriveUrl(null) && !isGoogleDriveUrl(undefined));
}

// ---- 5. Missing blob: a clear message, not a broken viewer -------------
{
  check('5 file resource with no blob -> none',
    previewKindFor(res({ blob: null, mimeType: 'application/pdf', fileName: 'gone.pdf' })) === 'none');
  check('5 file resource with null blob -> none',
    previewKindFor(res({ blob: null, mimeType: 'image/png', fileName: 'gone.png' })) === 'none');
  check('5 link resource with no url -> none',
    previewKindFor(res({ kind: 'link', urlOrPath: '' })) === 'none');
  check('5 link resource with undefined url -> none',
    previewKindFor(res({ kind: 'link', urlOrPath: undefined })) === 'none');
}

// ---- 6. Component contract (source inspection) -------------------------
{
  const viewer = readFileSync('src/features/library/components/ResourceViewer.tsx', 'utf8');
  const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
  const pdf = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');

  check('6 exactly one Preview button in the resource row',
    (detail.match(/>\s*Preview\s*</g) || []).length === 1);
  check('6 the Preview button opens the viewer', /onPreview=\{\(\) => setPreviewingResource\(resource\)\}/.test(detail));
  // The JSX is multi-line, so match the tag and its binding separately rather
  // than assuming one line.
  check('6 the viewer modal is mounted',
    /<ResourceViewer/.test(detail) && /resource=\{previewingResource\}/.test(detail));

  // PDF must go through the shared component, not be re-rendered locally.
  check('6 PDF uses the shared PdfViewer', /<PdfViewer\b/.test(viewer));
  check('6 PdfViewer is code-split (lazy)', /lazy\(\(\) =>\s*import\('\.\/PdfViewer'\)/.test(viewer));
  check('6 pdf.js is imported only in PdfViewer',
    !/from 'pdfjs-dist'/.test(viewer) && /from 'pdfjs-dist'/.test(pdf));
  check('8 exactly one component imports pdf.js (one shared viewer)',
    (() => {
      const hits = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(e.name) && /from 'pdfjs-dist'/.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      };
      walk('src');
      return hits.length === 1 && hits[0].replace(/\\/g, '/').endsWith('library/components/PdfViewer.tsx');
    })(),
    'import count must be 1');
  // Nav must clamp to 1..pageCount and scroll the target page into view, rather
  // than only writing the index.
  check('6 the shared PdfViewer has page navigation',
    /const onNextPage = useCallback/.test(pdf) && /const onPrevPage = useCallback/.test(pdf)
    && /aria-label="Previous page"/.test(pdf) && /aria-label="Next page"/.test(pdf));
  check('N next/prev clamp between page 1 and totalPages',
    /Math\.min\(pageCount \|\| 1, page \+ 1\)/.test(pdf) && /Math\.max\(1, page - 1\)/.test(pdf));
  check('N nav scrolls the active page into view',
    /const pageElsRef = useRef<Map<number, HTMLDivElement>>/.test(pdf)
    && /scrollIntoView\(\{ block: 'start'/.test(pdf) && /ref=\{setPageEl\(n\)\}/.test(pdf));
  check('N the arrow buttons are wired to the nav handlers',
    /onClick=\{onPrevPage\}/.test(pdf) && /onClick=\{onNextPage\}/.test(pdf));
  check('6 the worker is registered at module load', /GlobalWorkerOptions\.workerSrc/.test(pdf));

  // ---- render safety: the bug this fixes ----
  check('R1 the in-flight render is held in a ref', /renderTasksRef = useRef<Map<number, pdfjsLib\.RenderTask>>\(new Map\(\)\)/.test(pdf));
  check('R1 the previous render is cancelled', /previous\.cancel\(\)/.test(pdf));
  check('R1 the cancellation is AWAITED before a new render', /previous\.cancel\(\);[\s\S]{0,80}await previous\.promise/.test(pdf));
  check('R1 a monotonic token guards stale renders', /renderTokensRef\.current\.get\(n\)/.test(pdf) && /const isCurrent = \(\) =>/.test(pdf));
  check('R1 the effect cleanup cancels on unmount/input change', /renderTasksRef\.current\.clear\(\)/.test(pdf));
  check('R1 cancellation rejections are swallowed, not surfaced as errors', /isCancel\(e\)/.test(pdf) && /RenderingCancelledException/.test(pdf));
  check('R1 the token is claimed AFTER the awaited cancellation', pdf.indexOf('renderTokensRef.current.set(n, token);') > pdf.indexOf('await previous.promise;'));

  // ---- zoom / rotate / full screen / keyboard ----
  check('Z zoom in and out exist', /changeZoom\(ZOOM_STEP\)/.test(pdf) && /changeZoom\(-ZOOM_STEP\)/.test(pdf));
  check('Z the current zoom percentage is shown', /zoomPct}%/.test(pdf) && /Math\.round\(zoom \* 100\)/.test(pdf));
  check('Z zoom resets to a consistent default (fit = 1)',
    /setZoom\(1\)/.test(pdf) && /aria-label="Fit page to the window"/.test(pdf));
  check('Z zoom is clamped to a sane range', /MIN_ZOOM/.test(pdf) && /MAX_ZOOM/.test(pdf) && /Math\.max\(MIN_ZOOM, Math\.min\(MAX_ZOOM/.test(pdf));
  check('Z zoom/rotation reset per document, not global', /setZoom\(1\);\s*\n\s*setRotation\(0\);/.test(pdf));
  check('Z they are local state, not a module-level variable', !/^const (zoom|rotation) = /m.test(pdf));

  check('R2 rotation cycles 0/90/180/270', /setRotation\(\(r\) => \(r \+ 90\) % 360\)/.test(pdf));
  check('R2 rotation is passed to getViewport', /getViewport\(\{ scale: [^}]*rotation \}\)/.test(pdf));
  check('R2 rotation drives the canvas CSS box', /const rotated = rotation % 180 !== 0/.test(pdf));
  check('R2 the current angle is displayed', /\{rotation\}°/.test(pdf));

  // ---- ONE instance: the viewer's own wrapper IS the fullscreen element ----
  const fsp = readFileSync('src/features/split/FullScreenPreview.tsx', 'utf8');
  // (block comments are stripped first so the file's own explanation of
  //  why it does NOT mount a viewer is not mistaken for code)
  check('F fullscreen mounts NO second viewer',
    !/PdfViewer/.test(fsp.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('F the fullscreen element is the viewer own wrapper',
    /ref=\{wrapperRef\}/.test(pdf) && /wrapperRef\.current\.requestFullscreen|request\.call\(el\)/.test(pdf));
  check('F entering fullscreen uses the native API',
    /el\.requestFullscreen \?\? el\.webkitRequestFullscreen/.test(pdf));
  check('F exiting fullscreen calls document.exitFullscreen',
    /doc\.exitFullscreen \?\? doc\.webkitExitFullscreen/.test(pdf));
  check('F a fullscreenchange listener syncs the UI state',
    /addEventListener\('fullscreenchange'/.test(pdf)
    && /removeEventListener\('fullscreenchange'/.test(pdf)
    && /setFullScreen\(active === wrapperRef\.current\)/.test(pdf));
  check('F no host needs to pass a fullscreen callback', !/onRequestFullScreen/.test(pdf));
  check('F full screen is a real overlay, not a scaled canvas',
    /fixed inset-0 z-\[60\]/.test(pdf) && !/scale-\(/.test(pdf));
  check('F full screen re-measures the available width', /\}, \[fullScreen\]\)/.test(pdf));
  check('F Escape exits full screen', /case 'Escape'/.test(pdf) && /setFullScreen\(false\)/.test(pdf));
  check('F the viewer is focusable so shortcuts work', /tabIndex=\{0\}/.test(pdf) && /onKeyDown=\{onKeyDown\}/.test(pdf));

  check('N a page number input exists', /aria-label="Page number"/.test(pdf) && /onBlur=\{\(\) => \{ const n = Number\(pageInput\)/.test(pdf));

  // ---- offline: the worker must be precached -----------------------------
  // The bug this guards: `pdfjs-dist`'s worker is emitted as
  // `pdf.worker.min-<hash>.mjs`. The precache glob listed `js` but not `mjs`,
  // so Workbox silently skipped the worker. The app installed and precached
  // fine, but EVERY PDF failed offline ("Setting up fake worker failed"), which
  // looks exactly like "the app is offline" while the app itself is fine.
  const viteCfg = readFileSync('vite.config.ts', 'utf8');
  const glob = /globPatterns:\s*\[([^\]]*)\]/.exec(viteCfg)?.[1] ?? '';
  check('O the precache glob includes mjs (the pdf.js worker)',
    /mjs/.test(glob),
    glob.trim());
  check('O the precache glob still covers the other asset types',
    ['js', 'css', 'html', 'woff2', 'webmanifest']
      .every((ext) => new RegExp(`\\b${ext}\\b`).test(glob)));
  check('O the worker is imported as a URL so Vite emits a hashed asset',
    /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/.test(pdf));
  check('O the worker is still registered globally',
    /GlobalWorkerOptions\.workerSrc = pdfWorkerUrl/.test(pdf));
  check('O cross-origin sync is still never cached',
    /runtimeCaching:\s*\[\]/.test(viteCfg));

  // ---- fit-to-container: no dead grey space around the page --------------
  // The bug this guards: the page was sized from the surface's raw width, which
  // included its border, so it overflowed by ~2px; and the scale was derived
  // only from the width, so a short page left a large grey band below it.
  check('F the surface subtracts its own padding from the available box',
    /const padX = parseFloat/.test(pdf) && /const padY = parseFloat/.test(pdf) &&
    /setContainerHeight/.test(pdf));
  check('F the fit accounts for the padding (16px) on both axes',
    /const availW = Math\.max\(1, containerWidth - PAGE_PAD\)/.test(pdf) &&
    /const availH = Math\.max\(1, containerHeight - PAGE_PAD\)/.test(pdf));
  // The header is a real flex child now, so the scroll viewport it measures is
  // already below it. Reserving extra height for it would under-fill the page.
  check('F the fit does NOT double-reserve the header (it is a flex sibling)',
    !/TOOLBAR_H/.test(pdf));
  check('F the fit takes BOTH axes, not width alone',
    /Math\.min\(availW \/ pageW, availH \/ pageH, MAX_FIT\)/.test(pdf));
  check('F the fit is rotation-aware (rotated pages swap width and height)',
    /const pageW = rotated \? unit\.height : unit\.width/.test(pdf) &&
    /const pageH = rotated \? unit\.width : unit\.height/.test(pdf));
  check('F zoom is a multiplier on the FITTED scale, not a fixed 100%',
    /const cssScale = fitScale \* atZoom/.test(pdf));
  check('F the auto-fit is capped so a small page is not blown up',
    /MAX_FIT = 3/.test(pdf) && /Math\.min\(availW \/ pageW, availH \/ pageH, MAX_FIT\)/.test(pdf));
  check('F a resize or split-pane drag re-measures and re-fits',
    /new ResizeObserver\(apply\)/.test(pdf) && /ro\.observe\(el\)/.test(pdf));
  // REGRESSION (aspect-ratio distortion): `canvas.style.maxWidth = '100%'` used
  // to sit here, and it was the bug. max-width squeezes the WIDTH while the
  // height stays fixed, so the page rendered stretched instead of scaled, and
  // it silently shrank a zoomed page back to fit so the overflow could never be
  // scrolled to. Its absence is now the assertion.
  check('F the canvas is never squeezed by max-width (aspect-ratio bug)',
    !/canvas\.style\.maxWidth/.test(pdf));
  check('F a zoomed page overflows into a scrollable surface instead',
    /overflow-y-auto overflow-x-auto/.test(pdf));
  check('F the scroll surface grows to the widest page',
    /minWidth: `\$\{contentWidth\}px`/.test(pdf) && /reduce\(\(w, e\) => Math\.max\(w, e\.width\), 0\)/.test(pdf));
  check('F width and height are stored and applied together',
    /useState<Record<number, \{ w: number; h: number \}>>/.test(pdf) &&
    /style=\{\{ width: `\$\{entry\.width\}px`, height: `\$\{entry\.height\}px` \}\}/.test(pdf));
  check('F the backing store is recomputed for crisp text at every scale',
    // The on-screen path sizes the store from the shared geometry helper, which
    // already carries the device pixel ratio.
    /canvas\.width = Math\.floor\(pageW \* geo\.viewportScale\)/.test(pdf) &&
    /canvas\.height = Math\.floor\(pageH \* geo\.viewportScale\)/.test(pdf) &&
    /viewportScale: cssScale \* dpr/.test(pdf));
  check('F the canvas is not stretched to fill its band',
    /className="block rounded-lg bg-white shadow-sm shrink-0"/.test(pdf) &&
    !/className="block rounded-lg bg-white shadow-sm w-full/.test(pdf));
  check('F the page surface has only the small padding around the document',
    /bg-bg-elevated\/40 outline-none p-4/.test(pdf));
  check('F the status hint no longer steals canvas height',
    /<p className="sr-only">/.test(pdf) && !/text-\[11px\] text-content-tertiary">\s*\{zoomPct/.test(pdf));

  // ---- Up/Down arrow scrolling -----------------------------------------
  check('K the viewer is focusable so arrows reach it', /tabIndex=\{0\}/.test(pdf));
  check('K Up/Down are handled by the viewer', /case 'ArrowDown'/.test(pdf) && /case 'ArrowUp'/.test(pdf));
  check('K Up/Down prevent the dashboard behind from scrolling',
    /case 'ArrowDown': e\.preventDefault\(\); onArrowScroll\(1\)/.test(pdf) &&
    /case 'ArrowUp': e\.preventDefault\(\); onArrowScroll\(-1\)/.test(pdf));
  check('K arrows scroll the surface by a real step',
    /el\.scrollBy\(\{ top: dir \* step, behavior: 'smooth' \}\)/.test(pdf));
  check('K Down at the bottom hands over to the next page',
    /dir === 1 && atBottom\) \{ onNextPage\(\); return; \}/.test(pdf));
  check('K Up at the top hands over to the previous page',
    /dir === -1 && atTop\) \{ onPrevPage\(\); return; \}/.test(pdf));
  check('K the scroll ends are measured against real overflow',
    /el\.scrollHeight - el\.clientHeight/.test(pdf) && /atTop = el\.scrollTop <= 2/.test(pdf));

  // ---- one toolbar, overlaid, with Download; no duplicate title ---------
  // The bar is now published UP to the universal pane header rather than owned
  // by the viewer, so the split pane has exactly one header row. The viewer
  // still draws its own bar where there is no parent header (Library modal).
  check('T the control row is a single reusable value',
    /const toolbar = useMemo\(/.test(pdf) &&
    (pdf.match(/const toolbar = useMemo\(/g) || []).length === 1);
  check('T the viewer publishes that row to a parent header',
    /onRegisterControls\?: \(node: React\.ReactNode\) => void/.test(pdf) &&
    /publishRef\.current\(toolbar\)/.test(pdf) &&
    /return \(\) => publishRef\.current\?\.\(null\)/.test(pdf));
  // The row is MEMOIZED and the effect is keyed on it. Without the memo a fresh
  // element every render would make the parent store a new node forever; a
  // dependency-less effect would re-publish on every render. Together they are
  // what makes registration fire on mount, on real control changes, and on
  // unmount — and never in a loop.
  check('T the row is memoized and published on a stable key',
    /\[page, pageInput, pageCount, zoom, rotation, fullScreen, status, Boolean\(onDownload\)\],\s*\);\s*\n\s*\/\/ Publish/.test(pdf) &&
    /\}, \[toolbar\]\);/.test(pdf) &&
    !/onRegisterControls\(toolbar\);\s*\n\s*return \(\) => onRegisterControls\(null\);\s*\n\s*\}\);/.test(pdf));
  check('T the viewer draws its own bar only when it owns the header',
    /const ownsHeader = !onRegisterControls/.test(pdf) &&
    /{ownsHeader && \(/.test(pdf) &&
    /\{toolbar\}/.test(pdf));
  check('T there is exactly ONE in-place bar, and it is conditional',
    (pdf.match(/bg-bg-surface text-content-primary border-b border-border/g) || []).length === 1);
  check('T the bar scrolls horizontally with a hidden scrollbar',
    /overflow-x-auto overscroll-x-contain/.test(pdf) &&
    /\[&::-webkit-scrollbar\]:hidden/.test(pdf) &&
    /\[scrollbar-width:none\]/.test(pdf));
  check('T the in-place bar row keeps its intrinsic width',
    /h-11 px-3 flex items-center gap-2 min-w-max justify-between/.test(pdf));
  // Opaque fill, never a blur or gradient — but THEME-DRIVEN, not a fixed dark
  // slate, so the bar stays correct in light mode and under every status theme.
  check('T the bar is an opaque themed fill, never a blur or gradient',
    /bg-bg-surface text-content-primary border-b border-border/.test(pdf) &&
    !/backdrop-blur/.test(pdf) &&
    !/\bbg-slate-|\btext-slate-|\bborder-slate-/.test(pdf));
  check('T the bar is never sticky or absolutely positioned',
    !/className="[^"]*(sticky|absolute)[^"]*"/.test(pdf.slice(pdf.indexOf('ownsHeader && ('),
                                                           pdf.indexOf('ref={shellRef}'))));
  check('T the root is a definite-height flex column',
    /'flex flex-col gap-0 h-full min-h-0 min-w-0 w-full overflow-hidden'/.test(pdf));
  // `overflow-x-auto`, not `overflow-x-hidden`: clipping hid the outer columns
  // of any page zoomed past Fit, and the native scrollbars are what make that
  // overflow reachable. The window is generous because the className now carries
  // explanatory comment lines above it.
  // The scroll surface is the element carrying `shellRef`, and it must scroll on
  // both axes. Asserted as two independent facts rather than "N characters
  // apart", because the explanatory comment between them is free to grow.
  check('T the scroll area follows the header and scrolls both ways',
    /ref=\{shellRef\}/.test(pdf) &&
    /className="relative flex-1 min-h-\[320px\] min-w-0 w-full overflow-y-auto overflow-x-auto[^"]*"/.test(pdf));
  // Every flex ancestor of a scroll area must carry min-h-0/min-w-0, or the box
  // refuses to shrink and a growing child pushes it out instead of scrolling.
  check('T the viewer root is unlocked for nested scrolling',
    /h-full min-h-0 min-w-0 w-full overflow-hidden/.test(pdf) &&
    /flex-1 min-h-\[320px\] min-w-0 w-full overflow-y-auto/.test(pdf));
  check('T the control groups are shrink-0 and nowrap',
    (pdf.match(/flex-shrink-0 whitespace-nowrap/g) || []).length >= 3 &&
    /\$\{ctrl\} flex-shrink-0 whitespace-nowrap/.test(pdf));
  check('T the toolbar holds page nav, zoom, fit, rotate, download and fullscreen',
    /aria-label="Previous page"/.test(pdf) && /aria-label="Next page"/.test(pdf) &&
    /aria-label="Zoom out"/.test(pdf) && /aria-label="Zoom in"/.test(pdf) &&
    /aria-label="Fit page to the window"/.test(pdf) && /Rotate, currently/.test(pdf) &&
    /aria-label="Download this file"/.test(pdf) && /Enter full screen/.test(pdf));
  check('T fullscreen is driven by one identical class list in both paths',
    /const boxClass = fullScreen/.test(pdf) &&
    /fixed inset-0 z-\[60\] flex flex-col gap-0 p-0 h-full min-h-0 min-w-0 w-full/.test(pdf));
  check('T fullscreen no longer imposes a max-height on the surface',
    /maxHeight: variant === 'standalone' \|\| fullScreen \? undefined : 'min\(72vh, 720px\)'/.test(pdf));
  check('T the viewer is focusable so arrows reach it', /tabIndex=\{0\}/.test(pdf));
  check('T Up/Down are handled by the viewer', /case 'ArrowDown'/.test(pdf) && /case 'ArrowUp'/.test(pdf));
  check('T Up/Down prevent the dashboard behind from scrolling',
    /case 'ArrowDown': e\.preventDefault\(\); onArrowScroll\(1\)/.test(pdf) &&
    /case 'ArrowUp': e\.preventDefault\(\); onArrowScroll\(-1\)/.test(pdf));
  check('T arrows scroll the surface by a real step',
    /el\.scrollBy\(\{ top: dir \* step, behavior: 'smooth' \}\)/.test(pdf));
  check('T Down at the bottom hands over to the next page',
    /dir === 1 && atBottom\) \{ onNextPage\(\); return; \}/.test(pdf));
  check('T Up at the top hands over to the previous page',
    /dir === -1 && atTop\) \{ onPrevPage\(\); return; \}/.test(pdf));
  check('T the scroll ends are measured against real overflow',
    /el\.scrollHeight - el\.clientHeight/.test(pdf) && /atTop = el\.scrollTop <= 2/.test(pdf));

  // ---- the separate bottom action bar is gone, and nothing was orphaned --
  check('T the separate bottom action bar no longer exists',
    !/justify-end gap-2 border-t border-border\/50 pt-4/.test(viewer));
  check('T an image still offers Download in its own branch',
    /kind === 'image' && resource\.blob/.test(viewer) &&
    /Open original/.test(viewer));
  check('T a Drive preview still offers its Open link fallback',
    /Drive may show a "you don't have access"/.test(viewer) &&
    /kind === 'drive'[\s\S]{0,1400}Open link/.test(viewer));
  check('T the embedded pane does not repeat the document title',
    !/font-semibold text-content-primary">\{resource\.title\}<\/p>/.test(viewer));
  check('N the current page and total are shown', /of \{pageCount \|\| '—'\}/.test(pdf));
  check('L a rendering placeholder is shown while rendering', /\{rendering && \(/.test(pdf) && /Rendering…/.test(pdf));
  check('L the loading state has a spinner', /Loading PDF…/.test(pdf));


  // Word/PPT must not be rendered inline.
  check('6 opaque branch shows name, type and size',
    /fileTypeLabel/.test(viewer) && /formatBytes\(resource\.fileSize\)/.test(viewer));
  check('6 opaque branch offers Download', /kind === 'opaque'[\s\S]*?Download/.test(viewer));
  check('6 no renderer is mounted for opaque formats',
    !/kind === 'opaque'[\s\S]{0,400}<(canvas|iframe|img)/.test(viewer));

  // Drive + fallback.
  check('6 drive uses a preview iframe', /<iframe[\s\S]{0,200}driveEmbed/.test(viewer));
  // Slice the Drive branch itself rather than guessing a character distance.
  const driveBranch = viewer.slice(viewer.indexOf("{kind === 'drive' && driveEmbed && ("));
  check('6 drive keeps an Open link fallback', /openLink[\s\S]{0,400}Open link/.test(driveBranch));
  check('6 drive warns it may be private', /access/i.test(viewer));

  // Actions available regardless of preview success. A PDF hosts its own
  // Download in the viewer toolbar; the other kinds carry theirs in-branch.
  check('6 Download is offered whenever a blob exists',
    /onDownload=\{resource\.blob \? download : undefined\}/.test(viewer) &&
    /kind === 'opaque'/.test(viewer) && /onClick=\{download\}/.test(viewer));
  // Slice the link branch itself instead of guessing a character distance, so
  // this cannot silently pass or fail on formatting changes.
  const linkBranch = viewer.slice(viewer.indexOf("{kind === 'link' && ("));
  check('6 link kind offers Open link', /openLink[\s\S]{0,200}Open link/.test(linkBranch));

  // Missing blob messaging.
  check('6 missing blob shows a clear message', /File not available on this device/.test(viewer));
  check('6 the message explains blobs are not synced', /not synced/.test(viewer));
  check('6 no renderer is mounted for kind "none"',
    !/kind === 'none'[\s\S]{0,400}<(canvas|iframe|img)/.test(viewer));
}

// ---- 7. SubjectDetail no longer opens blobs in a new tab --------------
{
  const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
  check('7 the old window.open blob "View" path is gone', !/const openFile =/.test(detail));
  check('7 download is still available on the row', /onDownload=\{\(\) => downloadFile\(resource\)\}/.test(detail));
}

// The source with comments stripped. Several checks assert that an expression
// does NOT appear; the prose documenting a bug often quotes that same
// expression verbatim, so searching raw text would match the EXPLANATION of the
// bug rather than the bug. Handles both `//` and multi-line `/* ... */` blocks —
// block-comment continuation lines start with `*` and survive a naive strip.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

// ---- 9. Zoom viewport anchoring (numeric) -------------------------------
// Source-regex checks cannot tell whether the anchor math is CORRECT, only
// that it is present. So the formula is re-implemented here exactly as the
// component does it and driven with real numbers: after a zoom, the content
// point that was under the cursor must still be under the cursor.
{
  const pdf = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');
  // Comments stripped — see `stripComments` at module scope. Section 10 does the
  // same inside its own block, since each numbered section has its own scope.
  const pdfCode = stripComments(pdf);


  // --- PDF: content scales from the origin, so the anchor is centre * ratio.
  const pdfAnchor = (z) => {
    const W = 800, H = 600, SL = 120, ST = 340;
    const x = SL + W / 2;
    const y = ST + H / 2;
    return { W, H, x, y, ratio: z };
  };
  const a = pdfAnchor(1.5);
  const wantLeft = a.x * a.ratio - a.W / 2;
  const wantTop = a.y * a.ratio - a.H / 2;
  // The same content point, at the new scale, must land on the same screen spot.
  const screenX = a.x * a.ratio - wantLeft;
  const screenY = a.y * a.ratio - wantTop;
  check('9 the PDF anchor keeps the focal point on screen',
    Math.abs(screenX - a.W / 2) < 1e-9 && Math.abs(screenY - a.H / 2) < 1e-9,
    `${screenX},${screenY}`);

  // Without anchoring the view keeps its old pixel offset, so the focal point
  // drifts by (ratio - 1) * its coordinate — this is the jump being fixed.
  const drift = Math.abs(a.x * a.ratio - a.x);
  check('9 leaving the offset alone really does move the focal point', drift > 0, `drift ${drift}`);

  // --- The constant-chrome case: the bug this section exists to prevent -----
  // The model above assumes the WHOLE surface scales. A real PDF stack does
  // not: the shell's padding and the gap between pages are constant, so
  // scrollHeight = scale*sum(pages) + gaps + 2*padding. Comparing raw extents
  // therefore understates the scale, and anchoring on a fraction of that raw
  // size leaves the view NEAR the cursor but not ON it.
  {
    const PAD = 16, GAP = 10, N = 5, PH = 800;
    const lead = { x: PAD, y: PAD };
    const fixed = { x: PAD * 2, y: PAD * 2 + GAP * (N - 1) };
    const extentH = (s) => s * PH * N + fixed.y;
    const extentW = (s) => s * PH * 0.75 + fixed.x;

    // Ground truth: the document point under the cursor, mapped through the
    // REAL scales. This is what "the word stays under the cursor" means.
    const truth = (S1, S2, st, cy) => ((st + cy - lead.y) / S1) * S2 + lead.y - cy;

    let worst = 0, worstOld = 0;
    for (const [S1, S2] of [[1, 2], [1, 0.5], [1, 1.5], [1, 1.25], [2, 1], [0.5, 1.75]]) {
      for (const st of [0, 1000, 3400]) {
        const cy = 300;
        const so = extentH(S1), sn = extentH(S2);
        // What the OLD fractional anchor produced.
        const old = ((st + cy) / so) * sn - cy;
        // What the shipped hook produces.
        const r = (sn - fixed.y) / Math.max(1, so - fixed.y);
        const now = (st + cy - lead.y) * r + lead.y - cy;
        const t = truth(S1, S2, st, cy);
        worst = Math.max(worst, Math.abs(now - t));
        worstOld = Math.max(worstOld, Math.abs(old - t));
      }
    }
    check('9 the content-space anchor is exact against ground truth',
      worst < 1e-9, `worst error ${worst.toFixed(6)}px`);
    // If this ever passes, the constant chrome no longer breaks the naive form
    // and the numeric section above would be measuring the wrong thing again.
    check('9 a fraction of the raw scroll size really does drift',
      worstOld > 0.5, `naive worst error ${worstOld.toFixed(2)}px`);

    // The horizontal axis has its own terms, and shares the same treatment.
    const rX = (extentW(2) - fixed.x) / Math.max(1, extentW(1) - fixed.x);
    const hTruth = ((120 + 400 - lead.x) / 1) * 2 + lead.x - 400;
    const hNow = (120 + 400 - lead.x) * rX + lead.x - 400;
    check('9 the horizontal axis is corrected by the same terms',
      Math.abs(hNow - hTruth) < 1e-9, `${hNow} vs ${hTruth}`);

    // Zooming OUT is where the constant terms dominate, because the scaling part
    // is smallest. Guard it explicitly.
    const oS1 = 3, oS2 = 0.5, oSt = 8000;
    const oR = (extentH(oS2) - fixed.y) / Math.max(1, extentH(oS1) - fixed.y);
    const oNow = (oSt + 300 - lead.y) * oR + lead.y - 300;
    check('9 zoom-out from a high scale is also exact',
      Math.abs(oNow - truth(oS1, oS2, oSt, 300)) < 1e-9, `err ${Math.abs(oNow - truth(oS1, oS2, oSt, 300))}`);

    // Content narrower than the container: there is no horizontal scroll range, so
    // the write must land at 0. The browser clamps an out-of-range assignment
    // anyway; the point is that the TARGET must be computed so the clamp is not
    // the thing silently deciding the result.
    const narrowWant = (0 + 400 - lead.x) * 1 + lead.x - 400;
    check('9 a narrow surface targets zero scroll rather than a clamped value',
      narrowWant === 0, `${narrowWant}`);
  }

  // The focal point is captured as a FRACTION of the current scrollable extent
  // BEFORE the scale changes. Buttons/keyboard fall back to the viewport centre;
  // gestures pass the cursor or finger midpoint.
  // --- Pinch hand-off: the preview at release must EQUAL the commit --------
  // The preview used to clamp to [0.05, 20] while the commit clamped to
  // [MIN_ZOOM, MAX_ZOOM], so a firm pinch showed one scale and committed
  // another. Both now resolve through one quantizer, and the preview is derived
  // as target/start, so the two describe the same end state by construction.
  {
    const MIN = 0.5, MAX = 4;
    const oldPreview = (z) => Math.max(0.05, Math.min(20, z));
    const oldCommit = (z) => Math.max(MIN, Math.min(MAX, +z.toFixed(2)));
    const q = (z) => Math.max(MIN, Math.min(MAX, +z.toFixed(2)));
    const bursts = {
      gentle: [-10, -10, -10],
      firm: [-60, -60, -60],
      hard: [-200, -200, -200],
      'past limit': [-400, -400, -400],
    };
    let worstOld = 0, worstNew = 0;
    for (const deltas of Object.values(bursts)) {
      let oldLive = 1, newLive = 1;
      for (const d of deltas) {
        oldLive = oldPreview(oldLive * Math.exp(-d * 0.01));
        const t = q(newLive * Math.exp(-d * 0.01));
        newLive = t;
      }
      worstOld = Math.max(worstOld, Math.abs(oldCommit(oldLive) - oldLive));
      worstNew = Math.max(worstNew, Math.abs(q(newLive) - newLive));
    }
    check('9 the pinch preview and the commit resolve to the same scale',
      worstNew < 1e-9, `worst ${worstNew}`);
    // Guards the test itself: if the two clamps ever agreed again, this section
    // would be asserting nothing.
    check('9 the old split clamp really did diverge', worstOld > 1,
      `old worst ${worstOld.toFixed(2)}x`);

    // A commit that changes nothing must still retire the preview transform,
    // or the content stays visually scaled with no state behind it. On the path
    // that DOES commit, the transform must be left to the layout effect — so
    // `clearLive()` must appear exactly once, inside the early-return branch,
    // before the `return` that guards the committing path.
    const commitSrc = (pdf.match(/const commitLive = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
    const clears = commitSrc.match(/clearLive\(\);/g) || [];
    const earlyReturn = commitSrc.indexOf('return;');
    check('9 a no-op commit still clears the preview, and a real commit does not',
      clears.length === 1 && earlyReturn !== -1 &&
      commitSrc.indexOf('clearLive();') < earlyReturn &&
      commitSrc.indexOf('applyZoom(target,') > earlyReturn,
      `clears=${clears.length} earlyReturn@${earlyReturn}`);
  }

  // --- 50 pages, page 1 / middle / near the end (issue 6) --------------------
  // The layout must be a PURE function of (zoom-1 size, zoom), with no rounding
  // per page. Two separate defects showed up here:
  //   - sizes stored AT the measuring zoom, so the stack was stale at commit and
  //     the scroll write was clamped against the old surface;
  //   - `Math.floor` per page, which breaks the uniform scale and drifted the
  //     focal point by tens of pixels over a long document.
  {
    const PAD = 16, GAP = 10, N = 50, cy = 300;
    const baseH = Array.from({ length: N }, (_, i) => 450 + ((i * 137) % 260));
    const L = (z) => {
      const gap = GAP * z;
      const tops = [], hs = [];
      let y = 0;
      for (let i = 0; i < N; i += 1) {
        const h = baseH[i] * z;           // deliberately NOT floored
        tops.push(y); hs.push(h);
        y += h + (i < N - 1 ? gap : 0);
      }
      return { tops, hs, total: y + 2 * PAD };
    };
    const truth = (k, f, z1, z2) => (L(z2).tops[k] + f * L(z2).hs[k]) + PAD - cy;
    const anchor = (st, z1, z2) => (st + cy - PAD) * (z2 / z1) + PAD - cy;
    let worst = 0, clamped = 0, cases = 0;
    for (const [z1, z2] of [[1, 1.82], [1, 2], [1, 0.5], [1.82, 1], [2.17, 3.99]]) {
      const A = L(z1), B = L(z2);
      for (const k of [0, 24, 48]) {
        for (const f of [0.15, 0.5, 0.85]) {
          const st = A.tops[k] + f * A.hs[k] + PAD - cy;
          if (st > A.total - PAD - cy || st < 0) continue;
          const want = truth(k, f, z1, z2);
          // A target past the end of the NEW document is genuinely unreachable;
          // that is a legitimate clamp, not a stale-surface one.
          if (want > B.total - PAD - cy + 0.5 || want < -0.5) { clamped += 1; continue; }
          worst = Math.max(worst, Math.abs(anchor(st, z1, z2) - want));
          cases += 1;
        }
      }
    }
    check('9 the anchor is exact on page 1, a middle page and the last of 50',
      worst < 1, `cases ${cases}, worst ${worst.toExponential(2)}px`);
    // A target past the end of the NEW document is genuinely unreachable and the
    // browser is right to clamp it — that happens when zooming OUT near the end.
    // What must never happen is a clamp caused by the surface still being at its
    // OLD size, so only a ZOOM-IN target the new layout admits must land.
    let rejectedStale = '';
    for (const [z1, z2] of [[1, 1.82], [1, 2], [2.17, 3.99], [1.82, 2]]) {
      const A = L(z1), B = L(z2);
      for (const k of [0, 24, 48]) {
        for (const f of [0.15, 0.5, 0.85]) {
          const st = A.tops[k] + f * A.hs[k] + PAD - cy;
          if (st > A.total - PAD - cy || st < 0) continue;
          const want = truth(k, f, z1, z2);
          if (want < 0) continue;                         // cannot scroll above the top
          if (want <= B.total - PAD - cy + 0.5) continue; // the new layout admits it
          rejectedStale = `page ${k + 1} ${z1}->${z2} want ${want.toFixed(1)} newMax ${(B.total - PAD - cy).toFixed(1)}`;
        }
      }
    }
    check('9 no zoom-in write is clamped by a stale surface',
      rejectedStale === '', rejectedStale || 'every zoom-in target the new layout admits, lands');
    // Flooring each page is what reintroduced the drift; pin it out.
    const Lfloor = (z) => {
      const gap = GAP * z;
      const tops = [], hs = [];
      let y = 0;
      for (let i = 0; i < N; i += 1) {
        const h = Math.floor(baseH[i] * z);
        tops.push(y); hs.push(h);
        y += h + (i < N - 1 ? gap : 0);
      }
      return { tops, hs, total: y + 2 * PAD };
    };
    let worstFloor = 0;
    {
      const A = Lfloor(1), B = Lfloor(1.82);
      for (const k of [0, 24, 48]) {
        const f = 0.5;
        const st = A.tops[k] + f * A.hs[k] + PAD - cy;
        if (st > A.total - PAD - cy || st < 0) continue;
        const want = (B.tops[k] + f * B.hs[k]) + PAD - cy;
        worstFloor = Math.max(worstFloor, Math.abs(anchor(st, 1, 1.82) - want));
      }
    }
    check('9 flooring each page really does break the uniform scale',
      worstFloor > 1 && worst < 1,
      `floored ${worstFloor.toFixed(1)}px vs exact ${worst.toExponential(1)}px`);
    // The layout must derive the box from the zoom, not wait for a render.
    check('9 the layout is final in the same render as the zoom',
      /const h = size\.h \* zoom;/.test(pdfCode) && /const w = size\.w \* zoom;/.test(pdfCode) &&
      /\{ \.\.\.prev, \[n\]: \{ w: geo\.baseW, h: geo\.baseH \} \}/.test(pdfCode));
  }

  // --- The gap and the padding must SCALE, or the anchor drifts by page ----
  // Ground truth here is built from page heights and gaps ONLY. The anchor
  // formula is NOT reused, so this genuinely tests the implementation rather
  // than restating it. Uneven page heights stop a uniform-scale assumption from
  // passing by luck.
  {
    const PAD = 16, GAP = 10, N = 20;
    const h1 = Array.from({ length: N }, (_, i) => 700 + ((i * 137) % 260));
    const layoutAt = (z, gapScales, padScales) => {
      const gap = gapScales ? GAP * z : GAP;
      const pad = padScales ? PAD * z : PAD;
      const tops = [], hs = [];
      let y = 0;
      for (let i = 0; i < N; i += 1) {
        tops.push(y); hs.push(h1[i] * z);
        y += h1[i] * z + (i < N - 1 ? gap : 0);
      }
      return { tops, hs, pad, total: y + 2 * pad };
    };
    const cy = 300;
    const measure = (gapScales, padScales) => {
      const L = (z) => layoutAt(z, gapScales, padScales);
      // TRUTH: the point at fraction f of page k, mapped through the real layout.
      const truth = (k, f, z1, z2) => (L(z2).tops[k] + f * L(z2).hs[k]) + L(z2).pad - cy;
      // FORMULA UNDER TEST: what useZoomAnchor computes.
      const anchor = (st, z1, z2) => {
        const l1 = padScales ? PAD * z1 : PAD;
        const l2 = padScales ? PAD * z2 : PAD;
        return (st + cy - l1) * (z2 / z1) + l2 - cy;
      };
      let worst = 0;
      for (const [z1, z2] of [[1, 2], [1, 0.5], [1, 3.99], [2.17, 3.99], [3.99, 1.2]]) {
        const A = L(z1);
        for (const k of [0, Math.floor(N / 2), N - 1]) {
          for (const f of [0.12, 0.5, 0.88]) {
            const st = A.tops[k] + f * A.hs[k] + A.pad - cy;
            // Skip offsets the scroll range genuinely cannot reach, rather than
            // asserting against a clamped position.
            if (st > A.total - A.pad - 2 * cy || st < 0) continue;
            worst = Math.max(worst, Math.abs(anchor(st, z1, z2) - truth(k, f, z1, z2)));
          }
        }
      }
      return worst;
    };
    check('9 the anchor is exact on page 1, a middle page and the last page',
      measure(true, true) < 1, `worst ${measure(true, true).toExponential(2)}px`);
    // The gap lives INSIDE the content, so it must scale with the pages. The
    // padding lives OUTSIDE the content, so it must NOT: the anchor subtracts it
    // before scaling and adds it back after, and the two cancel.
    check('9 the gap scales with the zoom',
      /const gap = PAGE_GAP \* zoom;/.test(pdfCode) &&
      /const gaps = PAGE_GAP \* atZoom \* Math\.max\(0, pageCount - 1\)/.test(pdfCode));
    check('9 the padding stays constant, because it sits outside the content',
      /const pad = PAGE_PAD \* 2;/.test(pdfCode) &&
      /leadX: PAGE_PAD, leadY: PAGE_PAD/.test(pdfCode) &&
      /className="relative flex-1[^"]*\bp-4\b/.test(pdf),
      'scaling the padding would only grow the gutter; it cancels in the anchor');
    check('9 a constant gap really did break the anchor',
      measure(false, false) > 100, `old worst ${measure(false, false).toFixed(0)}px`);
    // Scaling the padding as well is unnecessary — it is not merely harmless, it
    // is the wrong call, so this pins the deliberate asymmetry.
    check('9 scaling the padding too is not required for exactness',
      measure(true, true) < 1 && measure(true, false) < 1,
      `both ${measure(true, true).toExponential(1)}, gap-only ${measure(true, false).toExponential(1)}`);
  }

  // --- The preview and the commit must resolve to the SAME scale -------------
  // The transform is applied on top of a layout already at the gesture's base
  // zoom, so the visual scale is `base * previewRatio` while the commit stores
  // `quantize(base * ratio)`. Previewing the raw running ratio left a real step
  // at the hand-off (1.5683x previewed vs 1.5700x committed).
  check('9 the preview scale is quantized to exactly the committed scale',
    /const absolute = quantizeZoom\(base \* nextRatio\);/.test(pdfCode) &&
    /liveScaleRef\.current = base > 0 \? absolute \/ base : 1;/.test(pdfCode));
  {
    const quant = (z) => Math.max(0.5, Math.min(4, +z.toFixed(2)));
    const adv = (g, d) => g * Math.exp(-d * 0.01);
    const deltas = [-4, -6, -5, -7, -4, -6, -5, -8];
    // Old: transform used the raw running ratio.
    let raw = 1;
    for (const d of deltas) raw = adv(raw, d);
    // New: transform uses quantize(base*raw)/base.
    const base = 1;
    const target = quant(base * raw);
    const qRatio = base > 0 ? target / base : 1;
    check('9 preview and commit agree to the last bit',
      Math.abs(base * raw - target) > 1e-9 && Math.abs(base * qRatio - target) < 1e-12,
      `old step ${Math.abs(base * raw - target).toFixed(5)}x, new step ${Math.abs(base * qRatio - target).toExponential(1)}x`);
  }

  // --- Commit hand-off: render off-screen, then swap, never flash ----------
  // Setting canvas.width clears the bitmap and pdf.js needs ms to redraw, so
  // doing that on the visible canvases at commit time painted blank pages.
  check('9 the commit renders off-screen into DETACHED canvases',
    /document\.createElement\('canvas'\)/.test(pdfCode) &&
    /const off = document\.createElement\('canvas'\);/.test(pdfCode),
    'the off-screen canvas is never attached to the document');
  // The visible canvas is resized and drawn in ONE synchronous run, with no await
  // between them, so no frame can be painted in between.
  check('9 the swap resizes and draws with no await in between',
    /live\.width = bit\.width;[\s\S]{0,200}?ctx\.drawImage\(bit, 0, 0\)/.test(pdfCode) &&
    !/live\.width = bit\.width;[\s\S]{0,200}?await /.test(pdfCode));
  // The budget: swap anyway after SWAP_BUDGET_MS, falling back to the old bitmap
  // (blurry) rather than clearing it (blank).
  check('9 the swap has a time budget and never blanks',
    /const SWAP_BUDGET_MS = 300/.test(pdfCode) &&
    /setTimeout\(fire, SWAP_BUDGET_MS\)/.test(pdfCode) &&
    /live\.style\.width = `\$\{entry\.width\}px`;/.test(pdfCode),
    'a missing bitmap resizes the box and keeps the old pixels');
  // Stale work is cancelled and generation-guarded.
  check('9 a new pinch cancels staged renders and guards the generation',
    /if \(stagedSwapRef\.current\) abortSwap\(\);/.test(pdfCode) &&
    /swapGenRef\.current !== gen/.test(pdfCode) &&
    /t\.cancel\(\)/.test(pdfCode));
  // The commit fires exactly once per gesture.
  check('9 the commit is fired exactly once',
    /let fired = false;[\s\S]{0,120}?const fire = \(\) => \{[\s\S]{0,120}?if \(fired\) return;/.test(pdfCode));
  // renderInto must not re-blank a canvas the swap just filled.
  check('9 a freshly swapped canvas is not re-rendered',
    // The ledger is keyed on the full geometry, so a resize or rotation still
    // forces a render; only a zoom the swap already satisfied is skipped.
    /const key = `\$\{zoom\}\|\$\{rotation\}\|\$\{containerWidth\}x\$\{containerHeight\}`;/.test(pdfCode) &&
    /const done = renderedKeyRef\.current\.get\(n\);/.test(pdfCode) &&
    /if \(done === key\)/.test(pdfCode) &&
    /renderedKeyRef\.current\.set\(n, staged\.key\)/.test(pdfCode) &&
    /renderedKeyRef\.current\.set\(n, key\)/.test(pdfCode),
    'the swap records the geometry so the normal pipeline skips the page');
  // The ledger may only be written once the bitmap genuinely exists, otherwise a
  // cancelled render would mark a page clean and leave it blank.
  check('9 the render ledger is only set after a render completes',
    /await task\.promise;[\s\S]{0,400}?renderedKeyRef\.current\.set\(n, key\);/.test(pdfCode));
  // Every canvas backing-store write is logged, so a blank frame is traceable.
  // REGRESSION: `stagedSwapRef.current` is null on every commit that did not go
  // through off-screen staging (button/keyboard zoom, no pages, or a swap already
  // consumed). A temporary [zoomdbg] probe once read `staged.probeBefore` outside
  // its guard, so EVERY zoom threw and the error boundary took over the viewer.
  // The probe is gone; this pins the structural rule that replaced it: inside the
  // commit block, every read of `staged` must sit under an `if (staged)`.
  {
    const commit = (pdfCode.match(/const zoomAnchor = useZoomAnchor\([\s\S]*?\n {2}\}, \[/) || [''])[0];
    const guardAt = commit.indexOf('if (staged) {');
    check('9 the commit block guards every read of the staged swap',
      commit.includes('const staged = stagedSwapRef.current;') &&
      guardAt > -1 &&
      // No `staged.` access may appear before the guard opens.
      !/staged\.[a-zA-Z]/.test(commit.slice(0, guardAt)),
      commit.slice(0, guardAt).match(/staged\.[a-zA-Z]+/g)?.join(',') ?? 'clean');
    // And the swap must be consumed exactly once, or a later commit would reuse a
    // stale generation and swap already-discarded bitmaps in.
    check('9 the staged swap is consumed once per commit',
      (commit.match(/stagedSwapRef\.current = null;/g) || []).length === 1);
    // No probe/debug measurement may creep back into the zoom path.
    check('9 no probe or debug measurement remains in the zoom path',
      !/probeBefore|probeAfter|probe\(\)|frameCounter|zdbg|zoomdbg|previewAtRelease/.test(pdfCode) &&
      !/probeBefore|probeAfter|frameCounter|ZOOM_DEBUG|zoomdbg/.test(hook10touch));
  }

  // The temporary [zoomdbg] instrumentation was removed once pinch zoom felt
  // right, so the three checks that asserted its presence went with it. What
  // matters is pinned below instead: the render lifecycle still runs, the canvas
  // backing store is still only written imperatively, and the hand-off values
  // agree. Asserting on log calls would only re-introduce dead code.
  //
  // React must never set the canvas backing store through props.
  check('9 the canvas bitmap is never set through React props',
    !/<canvas[^>]*\bwidth=\{/.test(pdf) && !/<canvas[^>]*\bheight=\{/.test(pdf));
  // The preview ratio and the committed ratio are the same `ratio` value handed
  // to stageSwap, so the hand-off cannot disagree with what was previewed. This
  // used to be a logged cross-check (`ratioMatchesPreview`); with the debug
  // logging gone the invariant is the value flow itself, asserted here.
  check('9 the preview scale and the committed ratio are the same value',
    /const ratio = prev > 0 && target !== null \? target \/ prev : 1;/.test(pdfCode) &&
    /stageSwap\(target, ratio, focal/.test(pdfCode) &&
    /applyZoom\(target, focal\.x, focal\.y, ratio\)/.test(pdfCode));

  // --- Pinch runaway: ONE running gesture scale, committed zoom folded in once
  // The handler used to feed `zoomRef * liveScale * exp(...)` into a function
  // that then divided by `liveScale` again, so every tick compounded the last.
  // A comfortable pinch drove the transform to 223x while the commit pinned at
  // the 4x limit.
  {
    const MIN = 0.5, MAX = 4;
    const q = (z) => Math.max(MIN, Math.min(MAX, +z.toFixed(2)));
    const norm = (d, m) => {
      const u = m === 1 ? 16 : m === 2 ? 100 : 1;
      return Math.max(-40, Math.min(40, d * u));
    };
    const adv = (g, d, m) => {
      const n = norm(d, m);
      return g * Math.exp(-n * (Math.abs(n) >= 20 ? 0.0024 : 0.01));
    };
    // The old control flow, faithfully.
    const oldRun = (deltas) => {
      let zoomRef = 1, live = 1, gesture = false;
      for (const d of deltas) {
        const target = q(zoomRef * live * Math.exp(-d * 0.01));
        const start = gesture ? zoomRef / live : zoomRef;
        if (!gesture) gesture = true;
        live = target / (start > 0 ? start : 1);
      }
      return live;
    };
    // The new one: the ratio is advanced, the committed zoom never mixed in.
    const newRun = (deltas) => {
      let live = 1;
      for (const d of deltas) live = adv(live, d, 0);
      return live;
    };
    const newRun2 = (deltas, mode) => {
      let live = 1;
      for (const d of deltas) live = adv(live, d, mode);
      return live;
    };
    const pinch = Array.from({ length: 25 }, (_, i) => -(4 + (i % 3)));
    const oldPeak = oldRun(pinch);
    const newPeak = newRun(pinch);
    check('9 a comfortable pinch no longer compounds per tick',
      newPeak < 6, `new ${newPeak.toFixed(2)}x`);
    // Proportional: a pinch worth N log-units must give exp(N*k), nothing more.
    const expected = Math.exp(-pinch.reduce((a, b) => a + b, 0) * 0.01);
    check('9 the pinch response is exactly exp(-k * totalDelta)',
      Math.abs(newPeak - expected) < 1e-9,
      `got ${newPeak.toFixed(6)} want ${expected.toFixed(6)}`);
    // Guards the test: the old flow really did explode.
    check('9 the old per-tick compounding really did explode',
      oldPeak > 100, `old ${oldPeak.toFixed(1)}x`);

    // Sub-threshold deltas are grouping-independent, because the response is
    // exp(-k * total). 15 stays under COARSE_DELTA; 20 does not, which is why
    // this compares 4x(-15) against 12x(-5) — both total -60 of FINE deltas.
    const many = newRun(Array.from({ length: 12 }, () => -5));
    const split = newRun([-15, -15, -15, -15]);
    check('9 sub-threshold deltas do not depend on how they are grouped',
      Math.abs(many - split) < 1e-9, `${many} vs ${split}`);
    // A single delta that hits the clamp+coarse path is deliberately a discrete
    // step, so it must NOT equal the same total spread over many small events.
    const oneBig = newRun([-60]);
    check('9 a large single delta is treated as a discrete coarse step',
      oneBig < many, `one ${oneBig.toFixed(3)} vs many ${many.toFixed(3)}`);

    // One gesture commits once, and the next starts from the new committed zoom.
    const simulate = (gestures) => {
      let committed = 1, live = 1, gesture = false, startZoom = 1, commits = 0;
      for (const deltas of gestures) {
        for (const d of deltas) {
          if (!gesture) { gesture = true; startZoom = committed; }
          live = adv(live, d, 0);
        }
        const t = q(startZoom * live);
        commits += 1;
        gesture = false; live = 1; startZoom = committed;
        if (t !== committed) committed = t;
      }
      return { commits, committed };
    };
    const run = simulate([pinch, Array(10).fill(5), [100], [100]]);
    check('9 each gesture commits exactly once', run.commits === 4, `${run.commits}`);
    // A second notch from the new base must be a further ~9%, not a repeat of
    // the whole first gesture.
    check('9 a post-commit event starts from the newly committed scale',
      run.committed > 1 && run.committed < 4, `final ${run.committed}`);

    // One ctrl+wheel mouse notch is about a 10% step.
    const notch = newRun([100]);
    check('9 one mouse notch is roughly a 10% step',
      Math.abs(notch - 0.909) < 0.02, `${((notch - 1) * 100).toFixed(1)}%`);
    // A single absurd event cannot slam the zoom to a limit.
    const absurd = newRun([5000]);
    check('9 one spurious event cannot slam the limit',
      absurd > 0.85 && absurd < 1, `${absurd.toFixed(3)}`);
    // deltaMode is honoured. A Chrome notch is 100px (mode 0) and a Firefox
    // notch is 3 lines (mode 1); both normalise to the same 40-unit magnitude,
    // so the SAME direction must produce the SAME step.
    const pxNotch = newRun2([-100], 0);
    const lineNotch = newRun2([-3], 1);
    check('9 a line-mode notch matches a pixel-mode notch',
      Math.abs(lineNotch - pxNotch) < 1e-9,
      `line ${lineNotch.toFixed(6)} vs pixel ${pxNotch.toFixed(6)}`);
    // Opposite direction must be the mirror image, not the same value.
    const outNotch = newRun2([100], 0);
    check('9 the response is symmetric about no-change',
      Math.abs(lineNotch * outNotch - 1) < 1e-9,
      `in ${lineNotch.toFixed(6)} out ${outNotch.toFixed(6)}`);
    // And a page-mode event (deltaY = 1) must not be a whole-page slam.
    const page = newRun2([1], 2);
    check('9 a page-mode event is bounded, not a full-page jump',
      page > 0.8 && page < 1.2, `${page.toFixed(3)}`);
  }

  // Captured ONCE per gesture, BEFORE the scale changes, and stored in CONTENT
  // coordinates rather than as a fraction of the scrollable extent. A fraction
  // is only valid when the WHOLE surface scales; padding and the gaps between
  // pages are constant, so they drag the fraction toward the chrome and leave
  // the view near — but not on — the cursor. Buttons/keyboard fall back to the
  // viewport centre. This logic now lives in the SHARED hook.
  const hook = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');
  check('9 the focal point is captured once, at gesture start',
    /if \(anchorRef\.current\) return; \/\/ already armed for this gesture/.test(hook) &&
    /const cx = clientX === undefined \? el\.clientWidth \/ 2 : clientX - rect\.left/.test(hook) &&
    /const cy = clientY === undefined \? el\.clientHeight \/ 2 : clientY - rect\.top/.test(hook));
  check('9 the anchor is stored in content coordinates, not a fraction',
    /scrollLeft: el\.scrollLeft/.test(hook) && /scrollTop: el\.scrollTop/.test(hook) &&
    !/\bfx:/.test(hook) && !/\bfy:/.test(hook));
  check('9 the PDF declares leading and total chrome, resolved per zoom',
    /leadX: PAGE_PAD/.test(pdfCode) && /leadY: PAGE_PAD/.test(pdfCode) &&
    /totalY: pad \+ gaps/.test(pdfCode) &&
    /const gaps = PAGE_GAP \* atZoom \* Math\.max\(0, pageCount - 1\)/.test(pdfCode) &&
    /_el: HTMLElement, atZoom: number/.test(pdfCode));
  // The gesture path supplies the ratio ANALYTICALLY. It cannot measure it: the
  // preview transform is still applied at capture time, and a CSS transform
  // grows the scrollable overflow area, so scrollWidth/scrollHeight there
  // describe the preview, not the committed layout. The button path still
  // measures, which is valid because no transform is applied.
  check('9 the applied scale is measured with the constant terms excluded',
    /const ratioX = a\.ratio \?\? \(\(sw - fixedNew\.totalX\)/.test(hook) &&
    /const ratioY = a\.ratio \?\? \(\(sh - fixedNew\.totalY\)/.test(hook));
  check('9 the gesture path supplies an analytic ratio, not a measurement',
    /applyZoom\(target, focal\.x, focal\.y, ratio\)/.test(pdfCode));
  check('9 the button path still measures, so it is unchanged',
    /zoomAnchor\.capture\(el, clientX, clientY, knownRatio\);/.test(pdfCode) &&
    // Both toolbar buttons funnel through one helper that passes NO ratio, so the
    // hook measures the extents exactly as it did before this change.
    /const changeZoom = useCallback\(\(delta: number\) => \{\s*applyZoom\(zoomRef\.current \+ delta\);/.test(pdfCode) &&
    /changeZoom\(ZOOM_STEP\)/.test(pdfCode) && /changeZoom\(-ZOOM_STEP\)/.test(pdfCode) &&
    // ...and the capture signature makes an omitted ratio genuinely undefined
    // rather than defaulting to one, which is what keeps the button path on the
    // measured branch.
    /capture: \(el: HTMLElement, clientX\?: number, clientY\?: number, ratio\?: number\)/.test(hook));
  check('9 the PDF reapplies the anchor as a layout effect',
    /useLayoutEffect\(\(\) => \{/.test(hook) &&
    /const wantTop = contentY \* ratioY \+ fixedNew\.leadY - a\.cy/.test(hook) &&
    /const wantLeft = contentX \* ratioX \+ fixedNew\.leadX - a\.cx/.test(hook));
  // Cleared BEFORE the write, so a re-render (or a throwing write) cannot apply
  // the same anchor twice.
  check('9 a re-render cannot re-apply the anchor',
    /anchorRef\.current = null;[\s\S]{0,300}?getFixed\(el, zoom\)/.test(hook) &&
    /const a = anchorRef\.current;\s*if \(!a\) return;/.test(hook));
  // Without this guard the page-sync effect snaps to the page top and undoes
  // the anchor on every zoom frame.
  check('9 the page-sync effect defers to an in-flight zoom',
    /if \(zoomAnchorRef\.current\) return;/.test(pdf) || /isZoomingRef\.current\) return;/.test(pdf));
  // Buttons/keyboard go straight to the anchoring setter. Gestures do not touch
  // state while running; they hand the SAME quantizer's output to it on commit,
  // so the preview and the commit cannot describe different end states.
  check('9 every zoom entry point ends at the anchoring setter',
    /applyZoom\(zoomRef\.current \+ delta\)/.test(pdfCode) &&
    /applyZoom\(target, focal\.x, focal\.y, ratio\)/.test(pdfCode));
}


// ---- 10. Scroll health: no locking, snapping, or frozen scrolling -------
// The gesture handlers are the usual cause of a viewer that stops responding
// to the wheel or to a finger: claiming an event it should have let through.
{
  const pdf = readFileSync('src/features/library/components/PdfViewer.tsx', 'utf8');
  // The source with comments stripped — see `stripComments` at module scope.
  const pdfCode = stripComments(pdf);
  // Same strip, but also dropping whole-line comment prose. `stripComments`
  // removes the `//` marker yet leaves the text of a wrapped prose line, so a
  // comment can still quote an expression a check below wants to ban.
  const pdfCodeOnly = pdfCode
    .split('\n')
    .filter((l) => !/^\s*[\/*]{1,2}\s*[A-Za-z`]/.test(l))
    .join('\n');
  const wheel = (pdf.match(/const onWheel = \(e: WheelEvent\) => \{[\s\S]*?\n {4}\};/g) || []).join('\n');
  const touch = (pdf.match(/const onMove = \(e: TouchEvent\) => \{[\s\S]*?\n {4}\};/g) || []).join('\n');

  // 1. Wheel: only a modifier gesture may be claimed.
  check('10 the wheel handler requires ctrl or meta', /if \(!e\.ctrlKey && !e\.metaKey\) return;/.test(wheel));
  // The load-bearing detail: the early return must come BEFORE preventDefault,
  // so a plain wheel is never cancelled. Comments are stripped first — the prose
  // around this handler mentions "preventDefault" by name, and matching inside
  // a comment would make the ordering check compare the wrong two positions.
  const wheelCode = wheel.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const wheelGuard = wheelCode.indexOf('!e.ctrlKey');
  const wheelBlock = wheelCode.indexOf('e.preventDefault()');
  check('10 a plain wheel is never preventDefault-ed',
    wheelGuard !== -1 && wheelBlock !== -1 && wheelGuard < wheelBlock,
    `guard@${wheelGuard} block@${wheelBlock}`);
  check('10 the wheel listener is still non-passive', /\{ passive: false \}/.test(pdf));
  // The gesture path must not touch React state. Calling setZoom per wheel event
  // re-renders the page stack and re-issues pdf.js render tasks every event,
  // which is the hitch this design exists to remove.
  // The wheel handler must advance ONE running ratio and must NOT multiply the
  // committed zoom into it — that mixing is what compounded every tick.
  check('10 a wheel event applies a GPU transform instead',
    /applyLive\(after, e\.clientX, e\.clientY\)/.test(wheel) &&
    /advanceGestureScale\(before, e\.deltaY, e\.deltaMode\)/.test(wheel) &&
    // Stripped of comments: the prose explaining the old bug quotes the very
    // expression being banned, so a naive search would match the EXPLANATION of the
    // bug rather than the bug. `pdfCodeOnly` drops whole-line comments too: a
    // wrapped prose line can sit inside a `//` comment whose opening was consumed
    // by the block-comment pass, and it still quotes the banned expression.
    // The pattern is also anchored so it cannot match as a SUFFIX of the legitimate
    // `gestureStartZoomRef.current * liveScaleRef.current`.
    !/(?<!Start)zoomRef\.current \* liveScaleRef\.current/.test(pdfCodeOnly),
    'committed zoom must never be multiplied into the running ratio');
  check('10 the delta is normalised by deltaMode before use',
    /normalizeWheelDelta\(e\.deltaY, e\.deltaMode\)/.test(pdf) &&
    /deltaMode === 1 \? LINE_HEIGHT_PX : deltaMode === 2 \? PAGE_HEIGHT_PX : 1/.test(
      readFileSync('src/features/library/useZoomAnchor.ts', 'utf8')));
  check('10 a single event cannot slam the limit',
    /MAX_EVENT_DELTA = 40/.test(readFileSync('src/features/library/useZoomAnchor.ts', 'utf8')));
  // The gesture base is stored, never re-derived from the running value.
  check('10 the gesture base is stored, not re-derived each tick',
    /gestureStartZoomRef\.current = zoomRef\.current;/.test(pdfCode) &&
    !/zoomRef\.current \/ liveScaleRef\.current/.test(pdfCode));
  // After the commit the running ratio resets, so the next gesture starts at 1x.
  const commitReset = (pdf.match(/const commitLive = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
  check('10 the running ratio resets to 1x after the commit',
    /liveScaleRef\.current = 1;/.test(commitReset) &&
    /gestureStartZoomRef\.current = zoomRef\.current;/.test(commitReset));
  check('10 the commit folds the committed zoom in exactly once',
    /const target = quantizeZoom\(gestureStartZoomRef\.current \* liveScaleRef\.current\);/.test(pdfCode) &&
    (pdfCode.match(/gestureStartZoomRef\.current \* liveScaleRef\.current/g) || []).length === 1);
  check('10 a touchmove never calls setZoom', !/setZoom\(/.test(hook10touch));
  check('10 a touchmove applies a GPU transform instead',
    /applyLive\(dist\(e\.touches\) \/ startDistRef\.current, c\.x, c\.y\)/.test(hook10touch) &&
    /useTouchZoomHandlers/.test(pdf));
  check('10 the scale is committed to state only after the gesture pauses',
    /window\.setTimeout\(\(\) => \{[\s\S]*?commitLive\(\);[\s\S]*?\}, 150\)/.test(pdf));
  check('10 the live transform is written directly to the DOM',
    /el\.style\.transform = Math\.abs\(nextRatioQ - 1\) < 0\.0005 \? '' : `scale\(\$\{nextRatioQ\}\)`/.test(pdf) &&
    /el\.style\.transformOrigin = `\$\{ox\}px \$\{oy\}px`/.test(pdf));
  // The focal point is captured ONCE at the first tick and reused for both the
  // preview origin and the commit. Overwriting it per tick is what let the
  // preview and the commit disagree about which point was pinned. There must be
  // exactly ONE assignment site, and it must sit inside the first-tick guard.
  check('10 the focal point is captured once and never re-taken',
    (pdf.match(/focalRef\.current = \{ x: clientX, y: clientY \};/g) || []).length === 1 &&
    // The guard body grew when staged-swap aborting was added, so the window is
    // wide enough to reach the assignment but still bounded to the first tick.
    /if \(!gestureRef\.current\) \{[\s\S]{0,900}?focalRef\.current = \{ x: clientX, y: clientY \};/.test(pdfCode) &&
    /const focal = focalRef\.current \?\? \{ x: clientX, y: clientY \};/.test(pdf),
    `assignments ${(pdf.match(/focalRef\.current = \{ x: clientX, y: clientY \};/g) || []).length}`);
  // The preview and the commit MUST resolve a target through the same
  // quantizer, or the user sees one scale and gets another. Counted in code
  // only: the doc comments name it several times.
  check('10 the preview and the commit share one quantizer',
    /const quantizeZoom = \(z: number\): number \| null =>/.test(pdfCode) &&
    // Three call sites: applyZoom (buttons/keys), applyLive (the preview) and
    // commitLive (the gesture commit). The preview MUST use it too, or the
    // transform shows a scale the commit will not store.
    (pdfCode.match(/= quantizeZoom\(/g) || []).length === 3,
    `call sites ${(pdfCode.match(/= quantizeZoom\(/g) || []).length}`);
  // The transform is on the CONTENT element, but scrollTop is measured from the
  // shell's PADDING box, so the origin must be corrected by the lead padding or
  // the live feedback sits a padding step off the cursor and commit looks like a
  // jump. This is the same `lead` the anchor uses.
  check('10 the transform origin is in content coordinates, not padding-box',
    /const oy = shell\.scrollTop \+ \(focal\.y - rect\.top\) - PAGE_PAD/.test(pdf) &&
    /const ox = shell\.scrollLeft \+ \(focal\.x - rect\.left\) - PAGE_PAD/.test(pdf));
  check('10 committing hands the scale to real layout at the same focal point',
    /applyZoom\(target, focal\.x, focal\.y, ratio\)/.test(pdf));
  // The commit must NOT clear the transform itself. Doing so paints one frame
  // at the unzoomed scale; the shared hook's layout effect retires the preview
  // in the same commit as the scroll write, before paint.
  const commitBody = (pdf.match(/const commitLive = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
  check('10 the commit does not clear the transform on the committing path',
    (commitBody.match(/clearLive\(\);/g) || []).length <= 1,
    `clears ${(commitBody.match(/clearLive\(\);/g) || []).length}`);
  check('10 the preview is retired inside the anchor layout effect',
    /beforeWrite\?\.\(el\);/.test(readFileSync('src/features/library/useZoomAnchor.ts', 'utf8')) &&
    /useZoomAnchor\(shellRef, layout, zoom, getFixed, \(el\) => \{/.test(pdfCode));
  check('10 the transform target is promoted to a compositor layer',
    /ref=\{contentRef\}/.test(pdf) && /will-change-transform/.test(pdf));
  // Lifting a finger ends the gesture INSIDE the shared hook, so both viewers
  // get the same commit-once-and-reset behaviour and a one-finger pan that
  // follows can never be measured against a stale baseline.
  // Asserts the BEHAVIOUR (end() commits exactly once via commitLive, and both
  // touchend and touchcancel reach it) without depending on the parameter name,
  // which is `_why` now that the [zoomdbg] logging that used it is gone.
  check('10 touchend commits the gesture',
    /const end = \(_?why: string\) => \{[\s\S]{0,200}?if \(startDistRef\.current === 0\) return;[\s\S]{0,200}?commitLive\(\);/.test(hook10touch) &&
    /const onTouchEnd = \(e: TouchEvent\) => \{[\s\S]{0,500}?if \(startDistRef\.current > 0\) end\(/.test(hook10touch) &&
    /const onTouchCancel = \(e: TouchEvent\) => \{[\s\S]{0,200}?if \(startDistRef\.current > 0\) end\(/.test(hook10touch));
  // Only the zoom surface may carry a non-passive wheel listener.
  check('10 the non-passive wheel listener is on the zoom surface only',
    (pdf.match(/addEventListener\('wheel'/g) || []).length === 1 &&
    // touchmove must be non-passive or preventDefault is ignored and the browser
    // page-zooms alongside our pinch. Registered ONLY on the viewer element.
    (pdf.match(/addEventListener\('touchmove', touchZoom\.onTouchMove, \{ passive: false \}\)/g) || []).length === 1 &&
    (pdf.match(/addEventListener\('touchmove'/g) || []).length === 1);

  // ---- 11. Scroll-write feedback loop -----------------------------------
  // A programmatic scrollLeft/scrollTop assignment fires a real `scroll` event.
  // Left unguarded, that event is indistinguishable from a user drag and drives
  // page state mid-zoom.
  const scroll = (pdf.match(/const handleScroll = \(\) => \{[\s\S]*?\n {2}\};/g) || []).join('\n');
  check('11 a zoom-in-flight flag exists', /const isZoomingRef = useRef\(false\)/.test(pdf));
  check('11 the scroll handler ignores zoom-driven writes',
    /if \(isZoomingRef\.current\) return;/.test(scroll));
  check('11 the flag is raised before it is released on the next frame',
    /zoomAnchor\.capture\(el, clientX, clientY, knownRatio\);\s*isZoomingRef\.current = true;/.test(pdfCode) &&
    pdfCode.indexOf('isZoomingRef.current = true;') < pdfCode.indexOf('isZoomingRef.current = false; }'));
  check('11 the flag is released after the event can fire',
    /requestAnimationFrame\(\(\) => \{ isZoomingRef\.current = false; \}\)/.test(pdf));
  // A late echo must not be mistaken for a user scroll, and a real user scroll
  // must not be answered by the focal math — that fight is the "snapping".
  check('11 our own echo is recognised by position',
    // The write records where the browser ACTUALLY put it, not what was asked
    // for — a clamped assignment would otherwise miss the tolerance and be
    // misread as a user drag.
    /writeRef\.current = \{ l: el\.scrollLeft, t: el\.scrollTop \};/.test(readFileSync('src/features/library/useZoomAnchor.ts', 'utf8')) &&
    /Math\.abs\(el\.scrollLeft - w\.l\) <= 1 && Math\.abs\(el\.scrollTop - w\.t\) <= 1/.test(scroll));
  check('11 a genuine user scroll drops the armed anchor',
    /zoomAnchor\.cancel\(\);/.test(scroll));
  // Req: focal math runs only on a real scale change. `applyZoom` arms the
  // anchor only when the clamped target differs from the previous zoom.
  check('11 the anchor is armed only when the scale actually changes',
    /if \(el && clamped !== prev && prev > 0\)/.test(pdf));
  check('11 the scroll write never happens beside setZoom',
    !/setZoom\(clamped\);[\s\S]{0,120}el\.scrollLeft/.test(pdf));
  // The write happens in the shared hook's layout effect, after the anchor has
  // been armed and cleared. Extracted by body so a long comment cannot break it.
  const hook11 = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');
  const anchorEffect = (hook11.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[/) || [''])[0];
  check('11 the write happens in a layout effect, once the anchor is armed',
    anchorEffect.includes('const a = anchorRef.current;') &&
    anchorEffect.includes('el.scrollLeft = wantLeft;') &&
    anchorEffect.indexOf('const a = anchorRef.current;') < anchorEffect.indexOf('el.scrollLeft = wantLeft;'),
    `effect ${anchorEffect.length} chars`);

  // ---- 12. Post-zoom clamping + DPI -------------------------------------
  // Writing scrollLeft against a STALE extent gets clamped by the browser, and
  // the next pass then moves the view again — the landing jump.
  // The anchor is read fresh from the new extents, so a write can never be
  // computed against a stale measured size the way a stored fraction can.
  // Content-space anchoring also makes it immune to the constant chrome.
  // The shared hook is read again here: each numbered section has its own block
  // scope, so a `const` from section 9 is not visible in section 12.
  const hook12 = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');
  check('12 the anchor is stored in content coordinates, not a fraction',
    /scrollLeft: el\.scrollLeft/.test(hook12) && /scrollTop: el\.scrollTop/.test(hook12) &&
    !/\bfx:/.test(hook12) && !/\bfy:/.test(hook12));
  check('12 the target is derived from the MEASURED extent',
    /const sw = Math\.max\(1, el\.scrollWidth\)/.test(hook12) &&
    /const sh = Math\.max\(1, el\.scrollHeight\)/.test(hook12));
  // Every constant term is removed before a MEASURED ratio, so it reflects the
  // real scale. The gesture path bypasses measurement entirely and supplies the
  // analytic ratio; both must be present and neither may silently disappear.
  check('12 the constant chrome is excluded from a measured scale',
    /const ratioY = a\.ratio \?\? \(\(sh - fixedNew\.totalY\)/.test(hook12) &&
    /const ratioX = a\.ratio \?\? \(\(sw - fixedNew\.totalX\)/.test(hook12) &&
    /const contentY = a\.scrollTop \+ a\.cy - a\.fixedOld\.leadY/.test(hook12) &&
    /const contentX = a\.scrollLeft \+ a\.cx - a\.fixedOld\.leadX/.test(hook12));
  // The transform MUST be dropped before any extent is read, and layout must be
  // flushed, or the measurements describe the preview.
  check('12 the preview is dropped and layout flushed before measuring',
    /beforeWrite\?\.\(el\);\s*void el\.offsetHeight;[\s\S]{0,200}?el\.scrollWidth/.test(hook12),
    'beforeWrite retires the preview and swaps bitmaps, offsetHeight forces layout, then extents are read');
  // A transform inflates the scrollable overflow area, so extents captured while
  // one is applied are meaningless. The gesture path must not capture them.
  check('12 extents are not captured while a transform may be applied',
    /\(ratio === undefined\s*\?\s*\{ scrollW/.test(hook12),
    'extents are captured only when no analytic ratio is supplied');
  // A smooth scroll-behavior would animate the assignment and fight the frame.
  check('12 the write is forced instant and is in the same layout effect',
    /el\.style\.scrollBehavior = 'auto'/.test(hook12) &&
    hook12.indexOf("el.style.scrollBehavior = 'auto';") < hook12.indexOf('el.scrollLeft = wantLeft;'));
  check('12 the previous scroll behavior is restored',
    /el\.style\.scrollBehavior = previous;/.test(hook12));

  // Scroll anchoring must be disabled WITH priority, or a later stylesheet
  // rule can re-enable it and the snap-back returns.
  check('12 overflow-anchor is disabled with !important',
    /!\[overflow-anchor:none\]/.test(pdf));

  // Full device pixel ratio, so text is rendered at native density.
  check('12 the render scale follows the real devicePixelRatio',
    /const nativeDpr = window\.devicePixelRatio \|\| 1/.test(pdf) &&
    !/Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(pdf));
  check('12 the backing store uses that ratio times the zoom scale',
    /viewportScale: cssScale \* dpr/.test(pdf) &&
    /canvas\.width = Math\.floor\(pageW \* geo\.viewportScale\)/.test(pdf) &&
    /getViewport\(\{ scale: geo\.viewportScale, rotation \}\)/.test(pdf));
  // Uncapped DPR would allocate an unbounded canvas at high zoom.
  // Mobile budgets. The per-canvas cap alone is not enough — several canvases
  // are alive at once — so the ceiling is divided by the resident page count.
  check('12 the device ratio is bounded by a pixel budget',
    /MAX_CANVAS_PIXELS = 16_777_216/.test(pdf) &&
    /MOBILE_MAX_CANVAS_PIXELS = 8_000_000/.test(pdf) &&
    /MOBILE_MAX_DPR = 2/.test(pdf) &&
    /MOBILE_MAX_TOTAL_CANVAS_PIXELS = 24_000_000/.test(pdf) &&
    /MOBILE_MIN_DPR = 0\.5/.test(pdf) &&
    /MOBILE_MAX_TOTAL_CANVAS_PIXELS \/ Math\.max\(1, livePages\)/.test(pdf) &&
    // The old `Math.max(1, ...)` floor silently UNDID the budget whenever
    // budgetDpr fell below 1 — i.e. precisely on the largest pages. On mobile it
    // must be allowed below 1 so the page renders at lower internal resolution.
    /const minDpr = mobile \? MOBILE_MIN_DPR : 1;/.test(pdf) &&
    /const dpr = Math\.max\(minDpr, Math\.min\(dprCap, budgetDpr\)\);/.test(pdf));
  // Memory is released, not left to the collector: a phone that has visited
  // twenty pages at 4x has no chance of GC reclaiming twenty bitmaps in time.
  check('12 canvases are released when they leave the render window',
    /canvas\.width = 0;[\s\S]{0,120}?canvas\.height = 0;/.test(pdf) &&
    /if \(!inWindow\.has\(n\)\) releaseCanvas\(n\);/.test(pdf));
  check('12 off-screen staging is skipped on mobile',
    /if \(isMobileViewport\(\)\) \{[\s\S]{0,200}?stagedSwapRef\.current = null;[\s\S]{0,80}?fire\(\);/.test(pdf),
    'a second full-size detached set doubles peak memory and kills the tab');

  // 2. Touch: exactly two fingers, and never cancelled otherwise.
  // The gesture maths lives in the SHARED hook now, so both viewers are asserted
  // against that one implementation rather than a copy in each.
  const touchCode = hook10touch.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const touchGuard = touchCode.indexOf('touches.length !== 2');
  const touchBlock = touchCode.indexOf('e.preventDefault()');
  check('10 touch move requires exactly two fingers',
    /const onTouchStart = \(e: TouchEvent\) => \{[\s\S]{0,120}?if \(e\.touches\.length !== 2\) return;/.test(hook10touch) &&
    /const onTouchMove = \(e: TouchEvent\) => \{[\s\S]{0,200}?if \(e\.touches\.length !== 2\) return;/.test(hook10touch));
  check('10 a one-finger pan is never preventDefault-ed',
    touchGuard !== -1 && touchBlock !== -1 && touchGuard < touchBlock,
    `guard@${touchGuard} block@${touchBlock}`);
  check('10 touchstart is passive (nothing is cancelled there)',
    /addEventListener\('touchstart', touchZoom\.onTouchStart, \{ passive: true \}\)/.test(pdf));

  // 3. Programmatic scroll writes during a zoom must be instant. The write lives
  // in the shared hook, so the whole set/restore pair is asserted there.
  const hook10 = readFileSync('src/features/library/useZoomAnchor.ts', 'utf8');
  check('10 the anchor forces scroll-behavior auto before writing',
    /el\.style\.scrollBehavior = 'auto';/.test(hook10) &&
    /const previous = el\.style\.scrollBehavior;/.test(hook10));
  check('10 the previous scroll behavior is restored',
    /el\.style\.scrollBehavior = previous;/.test(hook10));
  const autoAt = hook10.indexOf("el.style.scrollBehavior = 'auto';");
  const writeAt = hook10.indexOf('el.scrollLeft = wantLeft;');
  const restoreAt = hook10.indexOf('el.style.scrollBehavior = previous;');
  check('10 the scroll write happens after auto is set and before the restore',
    autoAt !== -1 && autoAt < writeAt && writeAt < restoreAt,
    `auto@${autoAt} write@${writeAt} restore@${restoreAt}`);

  // 4. No CSS snap / scroll anchoring fighting the correction.
  const surface = (pdf.match(/className="relative flex-1 min-h-\[320px\][^"]*"/) || [''])[0];
  check('10 the page surface disables scroll snapping',
    /\[scroll-snap-type:none\]/.test(surface), surface.slice(0, 60));
  check('10 the page surface disables browser scroll anchoring',
    /\[overflow-anchor:none\]/.test(surface));
  // A `touch-action: none` anywhere would freeze one-finger panning outright.
  check('10 nothing disables native touch panning',
    !/touch-action:\s*none|['"]touch-action['"]:\s*['"]none/.test(pdf));
}

console.log('');

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

