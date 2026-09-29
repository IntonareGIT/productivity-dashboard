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
  check('Z zoom resets to a consistent default (fit = 1)', /setZoom\(1\)/.test(pdf) && /aria-label="Reset zoom to fit width"/.test(pdf));
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
  check('6 drive keeps an Open link fallback', /kind === 'drive'[\s\S]{0,400}Open link/.test(viewer));
  check('6 drive warns it may be private', /access/i.test(viewer));

  // Actions available regardless of preview success.
  check('6 Download is offered whenever a blob exists', /\{resource\.blob && \(/.test(viewer));
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

