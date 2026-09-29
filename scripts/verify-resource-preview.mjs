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
    /const cssScale = fitScale \* zoom/.test(pdf));
  check('F the auto-fit is capped so a small page is not blown up',
    /MAX_FIT = 3/.test(pdf) && /Math\.min\(availW \/ pageW, availH \/ pageH, MAX_FIT\)/.test(pdf));
  check('F a resize or split-pane drag re-measures and re-fits',
    /new ResizeObserver\(apply\)/.test(pdf) && /ro\.observe\(el\)/.test(pdf));
  check('F the canvas cannot force a horizontal scrollbar',
    /canvas\.style\.maxWidth = '100%'/.test(pdf));
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
  check('T there is exactly ONE toolbar element in the viewer',
    (pdf.match(/aria-label="PDF controls"/g) || []).length === 1);
  // The header is a real flex child BEFORE the scroll area, not a sticky
  // overlay inside it. A `sticky` element inside an `overflow` container is
  // positioned by that container, so pages scrolled upward slid under it and
  // showed through; as a sibling, the viewport starts strictly below it.
  check('T the toolbar is a fixed header, not a sticky/absolute overlay',
    /role="toolbar"[\s\S]{0,900}className="flex-shrink-0 w-full bg-slate-900 text-slate-100 border-b border-slate-800 overflow-x-auto/.test(pdf));
  check('T the toolbar never uses sticky or absolute positioning',
    !/role="toolbar"[\s\S]{0,400}className="[^"]*(sticky|absolute)/.test(pdf));
  check('T the toolbar is declared BEFORE the scroll area',
    pdf.indexOf('aria-label="PDF controls"') < pdf.indexOf('ref={shellRef}'));
  check('T the toolbar has an OPAQUE dark fill, never a blur or gradient',
    /bg-slate-900 text-slate-100 border-b border-slate-800/.test(pdf) &&
    !/backdrop-blur/.test(pdf));
  check('T the root is a definite-height flex column',
    /'flex flex-col gap-0 h-full min-h-0 w-full overflow-hidden'/.test(pdf));
  check('T the scroll area is the second child and scrolls vertically',
    /ref=\{shellRef\}[\s\S]{0,600}className="relative flex-1 min-h-\[320px\] w-full overflow-y-auto overflow-x-hidden/.test(pdf));
  check('T the toolbar rows are split left / centre / right',
    /LEFT: the pane/.test(pdf) && /CENTRE: page navigation/.test(pdf) &&
    /RIGHT: zoom, fit, rotate, download/.test(pdf));
  check('T the toolbar can host the host pane selector in the same row',
    /leadingControls\?: React\.ReactNode/.test(pdf) &&
    /trailingControls\?: React\.ReactNode/.test(pdf) &&
    /\{leadingControls\}/.test(pdf) && /\{trailingControls\}/.test(pdf));

  // ---- narrow toolbars scroll instead of squashing ---------------------
  // The controls used to wrap or truncate on a narrow split pane, hiding
  // Download and Fullscreen past the edge.
  check('T the toolbar scrolls horizontally with a hidden scrollbar',
    /overflow-x-auto overscroll-x-contain/.test(pdf) &&
    /\[&::-webkit-scrollbar\]:hidden/.test(pdf) &&
    /\[scrollbar-width:none\]/.test(pdf));
  check('T the inner row keeps its intrinsic width so controls never shrink',
    /h-11 px-3 flex items-center gap-2 min-w-max justify-between/.test(pdf));
  check('T every toolbar group is shrink-0 and nowrap',
    (pdf.match(/flex-shrink-0 whitespace-nowrap/g) || []).length >= 3 &&
    /\$\{ctrl\} flex-shrink-0 whitespace-nowrap/.test(pdf));

  // ---- pinch / trackpad zoom -------------------------------------------
  check('Z pinch zoom is clamped through a shared multiplier',
    /const scaleZoom = useCallback/.test(pdf) &&
    /Math\.max\(MIN_ZOOM, Math\.min\(MAX_ZOOM, \+\(z \* factor\)/.test(pdf));
  check('Z the zoom bounds are 50%..400%', /MIN_ZOOM = 0\.5/.test(pdf) && /MAX_ZOOM = 4/.test(pdf));
  check('Z a trackpad pinch (ctrlKey wheel) is intercepted, not left to the browser',
    /if \(!e\.ctrlKey\) return;/.test(pdf) &&
    /if \(!e\.ctrlKey\) return;[\s\S]{0,500}e\.preventDefault\(\);[\s\S]{0,500}scaleZoom\(Math\.exp\(-e\.deltaY \* 0\.01\)\)/.test(pdf));
  check('Z the wheel listener is non-passive so preventDefault is honoured',
    /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(pdf) &&
    /removeEventListener\('wheel', onWheel\)/.test(pdf));
  check('Z mobile pinch tracks the two-finger distance',
    /Math\.hypot\(a\.clientX - b\.clientX, a\.clientY - b\.clientY\)/.test(pdf) &&
    /touches\.length !== 2/.test(pdf));
  check('Z the pinch re-anchors on the gesture start so it cannot compound',
    /startZoom = zoomRef\.current/.test(pdf) &&
    /scaleZoom\(\(ratio \* startZoom\) \/ zoomRef\.current\)/.test(pdf));
  check('Z touchmove is non-passive and prevents the default page zoom',
    /addEventListener\('touchmove', onMove, \{ passive: false \}\)/.test(pdf) &&
    /e\.preventDefault\(\);/.test(pdf));
  check('Z the touch handlers are all removed on cleanup',
    /removeEventListener\('touchstart', onStart\)/.test(pdf) &&
    /removeEventListener\('touchmove', onMove\)/.test(pdf));
  check('T the toolbar holds page nav, zoom, fit, rotate, download and fullscreen',
    /aria-label="Previous page"/.test(pdf) && /aria-label="Next page"/.test(pdf) &&
    /aria-label="Zoom out"/.test(pdf) && /aria-label="Zoom in"/.test(pdf) &&
    /aria-label="Fit page to the window"/.test(pdf) && /Rotate, currently/.test(pdf) &&
    /aria-label="Download this file"/.test(pdf) && /Enter full screen/.test(pdf));
  check('T fullscreen is driven by one identical class list in both paths',
    /const boxClass = fullScreen/.test(pdf) &&
    /fixed inset-0 z-\[60\] flex flex-col gap-0 p-0 h-full w-full/.test(pdf));
  check('T fullscreen no longer imposes a max-height on the surface',
    /variant === 'standalone' \|\| fullScreen \? undefined : \{ maxHeight/.test(pdf));
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

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

