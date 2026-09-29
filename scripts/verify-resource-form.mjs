/**
 * Add/Edit Resource form verification.
 *
 * Drives the REAL saveResource() from src/features/library/libraryRepo.ts and
 * the REAL validation branching from ResourceModal.tsx, with Dexie stubbed in
 * memory. Covers both form modes:
 *   - link: requires a title and a URL
 *   - file: requires a title and a selected file, and must NOT require a URL
 *
 * The bug this guards against: ResourceModal did not pass `kind` to
 * saveResource(), so uploads were saved as 'link' and rejected for a missing
 * URL. saveResource defaults kind to 'link', so every call site must be explicit.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'resource-'));
const outFile = join(outDir, 'repo.mjs');

// Minimal in-memory Dexie double covering the queries saveResource makes.
const dbStub = `
const col = (name) => {
  const m = () => Array.from(S[name].values());
  return {
    async toArray() { return m(); },
    async get(id) { return S[name].get(id); },
    async put(v) { S[name].set(v.id, v); return v.id; },
    async delete(id) { S[name].delete(id); },
    where: (idx) => ({
      equals: (val) => ({
        toArray: async () => m().filter((r) => r[idx] === val),
        first: async () => m().find((r) => r[idx] === val),
        sortBy: async (k2) => m().filter((r) => r[idx] === val).sort((a, b) => (a[k2] > b[k2] ? 1 : -1)),
        delete: async () => {},
      }),
    }),
  };
};
export const db = new Proxy({}, { get: (_t, name) => col(String(name)) });
export const S = globalThis.__S;
`;

await build({
  entryPoints: ['src/features/library/libraryRepo.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  plugins: [
    {
      name: 'stub',
      setup(b) {
        b.onResolve({ filter: /db\/db$/ }, () => ({ path: 'db-stub', namespace: 'stub' }));
        b.onResolve({ filter: /cloudConfig$/ }, () => ({ path: 'cfg-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: args.path === 'cfg-stub'
            ? 'export const LARGE_BLOB_WARNING_BYTES = 20971520;'
            : dbStub,
          loader: 'js',
        }));
      },
    },
  ],
});

globalThis.__S = { subjects: new Map(), topics: new Map(), resources: new Map() };
const { saveResource } = await import(`file://${outFile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const reset = () => {
  globalThis.__S.subjects.clear();
  globalThis.__S.topics.clear();
  globalThis.__S.resources.clear();
};

// A stand-in for a picked File: the repo only reads name/type/size and stores
// whatever blob it is handed, so no DOM File constructor is needed.
const fakeFile = (name, type, size) => ({ name, type, size });
const SUBJECT = 'sub-1';
// ---- 1. Link mode still works (regression) ------------------------------
{
  reset();
  const id = await saveResource({
    subjectId: SUBJECT,
    kind: 'link',
    title: 'Lecture slides',
    urlOrPath: 'https://example.com/slides',
    tags: ['week-3'],
  });
  const row = globalThis.__S.resources.get(id);
  check('1 link resource saves', !!row, id);
  check('1 link keeps kind=link', row.kind === 'link', row.kind);
  check('1 link keeps the URL', row.urlOrPath === 'https://example.com/slides', row.urlOrPath);
  check('1 link is auto-assigned a default topic', typeof row.topicId === 'string' && row.topicId.length > 0);
  check('1 link keeps tags', Array.isArray(row.tags) && row.tags[0] === 'week-3');
}

// ---- 2. Link mode validation still rejects a missing URL ---------------
{
  reset();
  let msg = '';
  try { await saveResource({ subjectId: SUBJECT, kind: 'link', title: 'No URL', urlOrPath: '' }); }
  catch (e) { msg = e.message; }
  check('2 link mode rejects an empty URL', /URL or file path is required/.test(msg), msg);
  check('2 nothing was persisted', globalThis.__S.resources.size === 0);

  msg = '';
  try { await saveResource({ subjectId: SUBJECT, kind: 'link', title: '  ', urlOrPath: 'https://x.dev' }); }
  catch (e) { msg = e.message; }
  check('2 link mode still requires a title', /title is required/i.test(msg), msg);
}

// ---- 3. Upload mode: PDF, image and Word, all with NO url ---------------
{
  const cases = [
    ['PDF', fakeFile('lecture.pdf', 'application/pdf', 2048), 'lecture.pdf'],
    ['image', fakeFile('diagram.png', 'image/png', 40960), 'diagram.png'],
    ['Word', fakeFile('essay.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 8192), 'essay.docx'],
  ];
  for (const [label, file, name] of cases) {
    reset();
    // NOTE: no urlOrPath at all — the exact shape ResourceModal sends in upload
    // mode, and the shape that used to be rejected.
    const id = await saveResource({
      subjectId: SUBJECT,
      kind: 'file',
      title: `Upload ${label}`,
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });
    const row = globalThis.__S.resources.get(id);
    check(`3 ${label} upload saves with no URL`, !!row, id);
    check(`3 ${label} upload is kind=file`, row.kind === 'file', row.kind);
    check(`3 ${label} upload has no URL`, !row.urlOrPath, JSON.stringify(row.urlOrPath));
    check(`3 ${label} upload keeps the blob`, row.blob === file);
    check(`3 ${label} upload keeps fileName`, row.fileName === name, row.fileName);
    check(`3 ${label} upload keeps mimeType`, row.mimeType === file.type, row.mimeType);
    check(`3 ${label} upload keeps fileSize`, row.fileSize === file.size, String(row.fileSize));
    check(`3 ${label} upload is auto-assigned a topic`, typeof row.topicId === 'string' && row.topicId.length > 0);
  }
}

// ---- 4. The regression itself: omitting `kind` must not silently pass ----
{
  // This is what ResourceModal used to do. saveResource defaults to 'link', so
  // an upload with no URL was rejected — the reported bug.
  reset();
  let msg = '';
  try {
    await saveResource({
      subjectId: SUBJECT,
      // kind omitted on purpose
      title: 'Missing kind',
      blob: fakeFile('x.pdf', 'application/pdf', 10),
      fileName: 'x.pdf',
    });
  } catch (e) { msg = e.message; }
  check('4 an upload with no `kind` is rejected (the old bug)', /URL or file path is required/.test(msg), msg);
  check('4 the failed upload persisted nothing', globalThis.__S.resources.size === 0);
}

// ---- 5. ResourceModal must pass kind on BOTH branches -------------------
{
  const src = readFileSync('src/features/library/components/ResourceModal.tsx', 'utf8');
  const calls = src.match(/saveResource\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
  check('5 ResourceModal has two saveResource calls', calls.length === 2, String(calls.length));
  check('5 both calls pass kind',
    calls.length === 2 && calls.every((c) => /\bkind,/.test(c)),
    calls.map((c) => (/kind,/.test(c) ? 'ok' : 'MISSING')).join(','));
  check('5 the link branch still sends urlOrPath', /kind === 'link'[\s\S]*?urlOrPath/.test(src));
  check('5 the upload branch requires a file, not a URL',
    /kind === 'file' && !file && !resource\?\.blob/.test(src));
  check('5 the upload branch does not require a URL',
    !/kind === 'file'[\s\S]{0,200}urlOrPath\.trim\(\)/.test(src));
}



// ---- 6. Editing an existing upload keeps its stored bytes ---------------
{
  reset();
  const file = fakeFile('keep.pdf', 'application/pdf', 512);
  const id = await saveResource({
    subjectId: SUBJECT, kind: 'file', title: 'Keep me',
    blob: file, fileName: file.name, mimeType: file.type, fileSize: file.size,
  });
  // Edit the title only: no new file, no URL.
  await saveResource({ id, subjectId: SUBJECT, kind: 'file', title: 'Kept and renamed' });
  const row = globalThis.__S.resources.get(id);
  check('6 editing an upload without a new file keeps the blob', row.blob === file);
  check('6 editing an upload keeps fileName', row.fileName === 'keep.pdf', row.fileName);
  check('6 editing an upload updates the title', row.title === 'Kept and renamed', row.title);
  check('6 editing an upload does not require a URL', !row.urlOrPath);
  check('6 exactly one row remains after the edit', globalThis.__S.resources.size === 1);
}

// ---- 7. Consumers tolerate an absent urlOrPath -------------------------
{
  const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
  check('7 search does not call .toLowerCase() on a bare urlOrPath',
    !/r\.urlOrPath\.toLowerCase\(\)/.test(detail));
  check('7 isUrl tolerates undefined', /\(value: string \| undefined\)/.test(detail));
  check('7 copyPath bails when there is no path', /if \(!resource\.urlOrPath\) return;/.test(detail));
  check('7 a link row with no URL shows a placeholder', /No URL/.test(detail));
}

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
console.log(`${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

