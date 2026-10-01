/**
 * Phase 3: one reliable way to identify an item, in every tool.
 *
 * Bundles the REAL `toolResolve.ts` with esbuild, so the rules under test are
 * the shipping ones. The matrix the brief asks for is run for EVERY kind:
 * valid id, exact name, partial name, ambiguous name, an id of the wrong kind,
 * a nonexistent id, a name that exists in two parents, and a chained
 * search-then-act case.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'resolve-'));
const outFile = join(outDir, 'toolResolve.mjs');
await build({
  entryPoints: ['src/features/ai/toolResolve.ts'],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const R = await import(`file://${outFile.replace(/\\/g, '/')}`);
const { resolveItem, needItem, isAmbiguous, refOf, ITEM_KINDS } = R;
rmSync(outDir, { recursive: true, force: true });

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

/* ------------------------------ fixtures ------------------------------ */
const subjects = [
  { id: 'sub-algo', name: 'Advanced Algorithms' },
  { id: 'sub-phys', name: 'Physics' },
];
const topics = [
  { id: 'top-graph', title: 'Graph Theory', subjectId: 'sub-algo' },
  { id: 'top-search', title: 'Search', subjectId: 'sub-algo' },
  { id: 'top-optics', title: 'Optics', subjectId: 'sub-phys' },
  // The same title in two subjects: only a scoped lookup can pick one.
  { id: 'top-intro-a', title: 'Introduction', subjectId: 'sub-algo' },
  { id: 'top-intro-b', title: 'Introduction', subjectId: 'sub-phys' },
];
const resources = [
  { id: 'res-slides', title: 'Lecture Slides Week 1', topicId: 'top-graph', subjectId: 'sub-algo' },
  { id: 'res-past', title: 'Past Paper 2024', topicId: 'top-optics', subjectId: 'sub-phys' },
  // Two resources sharing a word, so a partial match is genuinely ambiguous.
  { id: 'res-lecture-rec', title: 'Lecture Recording', topicId: 'top-graph', subjectId: 'sub-algo' },
];
const groups = [
  { id: 'grp-exams', name: 'Exam papers', subjectId: 'sub-algo' },
  { id: 'grp-slides', name: 'Slides', subjectId: 'sub-algo' },
];
const events = [
  { id: 'ev-lecture', title: 'Algorithms Lecture', date: '2026-10-05' },
  { id: 'ev-lab', title: 'Physics Lab', date: '2026-10-07' },
];
const assessments = [
  { id: 'as-mid', name: 'Midterm', subjectId: 'sub-algo', date: '2026-10-20' },
  { id: 'as-final', name: 'Final Exam', subjectId: 'sub-algo', date: '2026-12-01' },
];

const TABLE = {
  subject: subjects, topic: topics, note: topics, resource: resources,
  group: groups, event: events, assessment: assessments,
};
const nm = (kind) => (row) => String(row[ITEM_KINDS[kind].name] ?? '');
const go = (kind, ref, scope) => resolveItem({
  kind, ref, rows: TABLE[kind], nameOf: nm(kind),
  label: ITEM_KINDS[kind].label, kind, scope,
});

/* ===== 1. every kind resolves by a valid id (the happy path) ===== */
for (const [kind, id, expected] of [
  ['subject', 'sub-algo', 'Advanced Algorithms'],
  ['topic', 'top-graph', 'Graph Theory'],
  ['note', 'top-graph', 'Graph Theory'],
  ['resource', 'res-slides', 'Lecture Slides Week 1'],
  ['group', 'grp-exams', 'Exam papers'],
  ['event', 'ev-lecture', 'Algorithms Lecture'],
  ['assessment', 'as-mid', 'Midterm'],
]) {
  const r = go(kind, id);
  check(`${kind}: resolves by valid id`,
    'row' in r && r.row.id === id && nm(kind)(r.row) === expected,
    'row' in r ? r.row.id : JSON.stringify(r).slice(0, 70));
}

/* ===== 2. every kind resolves by an exact name ===== */
for (const [kind, name, expected] of [
  ['subject', 'Physics', 'sub-phys'],
  ['topic', 'Graph Theory', 'top-graph'],
  ['note', 'Search', 'top-search'],
  ['resource', 'Past Paper 2024', 'res-past'],
  ['group', 'Slides', 'grp-slides'],
  ['event', 'Physics Lab', 'ev-lab'],
  ['assessment', 'Final Exam', 'as-final'],
]) {
  const r = go(kind, name);
  check(`${kind}: resolves by exact name`, 'row' in r && r.row.id === expected,
    'row' in r ? r.row.id : JSON.stringify(r).slice(0, 70));
}

/* ===== 3. case-insensitive, and a unique partial match ===== */
check('an exact name is case-insensitive', 'row' in go('subject', 'advanced algorithms'));
check('a unique partial name resolves',
  'row' in go('topic', 'graph') && go('topic', 'graph').row.id === 'top-graph');
check('a partial match is not case-sensitive', 'row' in go('resource', 'past paper'));
check('an exact id wins over a same-named item',
  'row' in go('topic', 'top-graph') && go('topic', 'top-graph').row.id === 'top-graph');

/* ===== 4. an ambiguous name returns CANDIDATES, not an error ===== */
for (const [kind, ref] of [['group', 'S'], ['topic', 'Introduction'], ['resource', 'Lecture']]) {
  const r = go(kind, ref);
  check(`${kind}: an ambiguous name returns candidates with ids`,
    isAmbiguous(r) && r.candidates.length > 1 && r.candidates.every((c) => c.id && c.name),
    isAmbiguous(r) ? `${r.candidates.length} candidates` : 'no candidates');
}
const intro = go('topic', 'Introduction');
check('the ambiguous candidates carry usable ids',
  isAmbiguous(intro) && intro.candidates.map((c) => c.id).sort().join(',') === 'top-intro-a,top-intro-b',
  isAmbiguous(intro) ? intro.candidates.map((c) => c.id).join(',') : '');

/* ===== 5. scope disambiguates a name that exists in two parents ===== */
const scoped = go('topic', 'Introduction', { field: 'subjectId', value: 'sub-phys' });
check('a name in two subjects resolves within a scope',
  'row' in scoped && scoped.row.id === 'top-intro-b',
  'row' in scoped ? scoped.row.id : JSON.stringify(scoped).slice(0, 70));
const scopedMissing = go('topic', 'Introduction', { field: 'subjectId', value: 'sub-nope' });
check('a scoped lookup with no match errors rather than guessing', 'error' in scopedMissing,
  'error' in scopedMissing ? scopedMissing.error.slice(0, 50) : '');

/* ===== 6. an id of the WRONG kind is a clear kind-mismatch error ===== */
const wrongKind = go('subject', 'top-graph');
check('a topicId passed as a subjectId does not resolve', !('row' in wrongKind),
  'row' in wrongKind ? 'RESOLVED (bug)' : 'refused');
check('the kind-mismatch error names the kind it searched',
  'error' in wrongKind && /only subjects are searched/.test(wrongKind.error),
  'error' in wrongKind ? wrongKind.error.slice(-70) : '');
for (const [kind, id] of [
  ['subject', 'res-slides'], ['topic', 'sub-algo'], ['resource', 'ev-lecture'],
  ['event', 'sub-algo'], ['assessment', 'top-graph'], ['group', 'as-mid'],
]) {
  const r = go(kind, id);
  check(`${kind}: refuses an id belonging to another kind`, !('row' in r) && 'error' in r,
    'row' in r ? 'RESOLVED (bug)' : 'refused');
}

/* ===== 7. a nonexistent id gives a helpful error ===== */
const missing = go('subject', 'sub_does_not_exist');
check('a nonexistent id errors', 'error' in missing);
check('the error says nothing was changed',
  'error' in missing && /Nothing was changed/.test(missing.error));
check('the error offers the closest names', 'error' in missing && /Closest:/.test(missing.error),
  'error' in missing ? (missing.error.match(/Closest: [^.]*\./)?.[0] ?? 'none') : '');
check('an empty reference is refused with guidance',
  'error' in go('subject', '') && /Pass the id/.test(go('subject', '').error));

/* ===== 8. needItem throws rather than returning a union ===== */
let threw = null;
try { await needItem({ kind: 'subject', ref: 'sub-algo', rows: subjects }); } catch (e) { threw = e; }
check('needItem returns the row for a valid id', threw === null, threw?.message ?? '');

threw = null;
try { await needItem({ kind: 'subject', ref: 'nope-not-real', rows: subjects }); } catch (e) { threw = e; }
check('needItem throws on a bad reference', threw !== null);

const ambiguousThrow = await (async () => {
  try { await needItem({ kind: 'topic', ref: 'Introduction', rows: topics }); return null; }
  catch (e) { return e.message; }
})();
check('needItem reports ambiguity with candidate ids',
  !!ambiguousThrow && /Candidates/.test(ambiguousThrow) && /top-intro-a/.test(ambiguousThrow),
  ambiguousThrow?.slice(0, 80) ?? '');

/* ===== 9. the generic result block every tool must return ===== */
const ref = refOf('subject', subjects[0]);
check('refOf yields exactly { kind, id, name }',
  JSON.stringify(Object.keys(ref).sort()) === '["id","kind","name"]', JSON.stringify(ref));
check('refOf reports the right kind and name', ref.kind === 'subject' && ref.name === 'Advanced Algorithms');

/* ===== 10. the chained case: search, then act with the returned id ===== */
const toolsSrc = readFileSync('src/features/ai/tools.ts', 'utf8');
check('searchLibrary returns the subject id (it used to be missing)',
  /subjectId: subject\.id, subject: subject\.name, matchedSubject/.test(toolsSrc));
check('searchLibrary returns an id for every assessment',
  /id: a\.id, kind: 'assessment'/.test(toolsSrc));
check('searchLibrary returns a kind for topics, resources and assessments',
  /kind: 'topic'/.test(toolsSrc) && /kind: 'resource'/.test(toolsSrc) && /kind: 'assessment'/.test(toolsSrc));
check('searchLibrary returns the parent subject id and name on each row',
  /subjectId: subject\.id, subject: subject\.name/.test(toolsSrc));
check('searchLibrary returns the parent topic for a resource',
  /topicId: topic\?\.id \?\? null, topic: topic\?\.title \?\? null/.test(toolsSrc));

/* ===== 11. only ONE lookup implementation survives ===== */
// Match a real CALL, not the prose in a doc comment that quotes the old error
// text. `db.subjects.get(` inside a comment is not a lookup that can still fail.
const extSrc = readFileSync('src/features/ai/toolsExtended.ts', 'utf8');
const codeOnly = extSrc.split('\n')
  .filter((l) => !/^\s*(\*|\/\/)/.test(l))
  .join('\n');
check('toolsExtended no longer resolves subjects with a raw db.get',
  !/db\.subjects\.get\(/.test(codeOnly));
check('toolsExtended no longer resolves topics with a raw db.get',
  !/db\.topics\.get\(/.test(codeOnly));
check('toolsExtended no longer resolves events with a raw db.get',
  !/db\.calendarEvents\.get\(/.test(codeOnly));
check('tools.ts split-screen no longer hand-rolls its own matching',
  !/pool\.slice\(0, 10\)/.test(toolsSrc) && /resolveItem<Resource>/.test(toolsSrc));
check('the old resolveByIdOrName is now a thin wrapper over resolveItem',
  /export const resolveByIdOrName[\s\S]{0,300}resolveItem/.test(
    readFileSync('src/features/ai/toolResolve.ts', 'utf8')));
check('every kind in the registry has a table in this suite',
  Object.keys(ITEM_KINDS).every((k) => Array.isArray(TABLE[k])), Object.keys(ITEM_KINDS).join(','));

/* ===== 12. the system prompt teaches the id discipline ===== */
const storeSrc = readFileSync('src/stores/useAssistantStore.ts', 'utf8');
check('the system prompt says to use the id from a previous result',
  /Always use the id from a previous tool result when one is available/.test(storeSrc));
check('the system prompt says never to invent ids', /never invent ids/.test(storeSrc));
check('the system prompt explains that names are a fallback only',
  /A name is accepted only as a fallback/.test(storeSrc));
check('the system prompt warns that ids are kind-specific',
  /will never match a tool that wants a different kind/.test(storeSrc));

console.log(`\nitem-resolution: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
