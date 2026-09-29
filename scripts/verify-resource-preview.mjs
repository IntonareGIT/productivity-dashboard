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
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
  check('6 the viewer modal is mounted', /<ResourceViewer resource=\{previewingResource\}/.test(detail));

  // PDF must go through the shared component, not be re-rendered locally.
  check('6 PDF uses the shared PdfViewer', /<PdfViewer\b/.test(viewer));
  check('6 PdfViewer is code-split (lazy)', /lazy\(\(\) =>\s*import\('\.\/PdfViewer'\)/.test(viewer));
  check('6 pdf.js is imported only in PdfViewer',
    !/from 'pdfjs-dist'/.test(viewer) && /from 'pdfjs-dist'/.test(pdf));
  check('6 the shared PdfViewer has page navigation',
    /Page \{page\} of \{pageCount\}/.test(pdf) && /Previous page/.test(pdf) && /Next page/.test(pdf));
  check('6 the worker is registered at module load', /GlobalWorkerOptions\.workerSrc/.test(pdf));

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

