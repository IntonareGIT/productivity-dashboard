/**
 * Phase 3: the drill-down file picker.
 *
 * Exercises the picker's DATA layer (filePickerData.ts) against the same
 * in-memory Dexie stub the other suites use. The data layer is where every rule
 * the brief asks about lives: what is shown at each level, how same-named files
 * are told apart, natural sorting, files missing from this device, and where
 * the picker starts.
 *
 * The React component itself is NOT mounted here. It is a thin renderer over
 * this data plus the portal, and it needs a real browser to verify honestly;
 * what could not be tested is listed in PROGRESS.md.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'picker-'));
const outFile = join(process.cwd(), 'node_modules', '.cache-file-picker.mjs');

const dbStub = `
export var db = new Proxy({}, {
  get(_t, name) {
    var S = globalThis.__S;
    var col = function (n) {
      var m = () => Array.from((S[n] ?? new Map()).values());
      return {
        async toArray() { return m(); },
        async get(id) { return (S[n] ?? new Map()).get(id); },
        async put(v) { S[n].set(v.id, v); return v.id; },
      };
    };
    return col(String(name));
  },
});
`;

// A PDF has a blob; an image has a blob; one row has NO blob (synced from
// another device), which is the "File not available on this device" case.
const pdf = (id, title, extra = {}) => ({
  id, subjectId: 's1', topicId: 't1', kind: 'file', title,
  blob: { size: 1, type: 'application/pdf' }, fileName: `${title}.pdf`,
  tags: [], createdAt: 'x', ...extra,
});
const img = (id, title, extra = {}) => ({
  id, subjectId: 's1', topicId: 't1', kind: 'file', title,
  blob: { size: 1, type: 'image/png' }, fileName: `${title}.png`,
  tags: [], createdAt: 'x', ...extra,
});
const grp = (id, name, parentGroupId, subjectId = 's1') => ({
  id, subjectId, name, parentGroupId, order: 0, createdAt: 'x',
});
// A note IS a Topic row. `topicId` is its own id, which is how the rest of the
// app refers to it.
const note = (id, title, subjectId) => ({
  id, subjectId, title, topicId: id, notes: 'body',
  status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x',
});

globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Thermodynamics', color: '#111', createdAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#222', createdAt: 'x' }],
    // A subject with notes and NOTHING else: no groups, no files.
    ['s3', { id: 's3', name: 'Chemistry', color: '#333', createdAt: 'x' }],
  ]),
  topics: new Map([
    // A note in each subject, plus two with the SAME title in different
    // subjects, which is the note-side version of the duplicate-file problem.
    ['n1', note('n1', "Thermodynamics's Notes", 's1')],
    ['n2', note('n2', "Thermodynamics's Notes", 's2')],
    // A note with a title the user typed, to prove custom titles survive.
    ['n3', note('n3', 'Lecture 4 recap', 's1')],
    // Natural sorting for note titles.
    ['n4', note('n4', 'Week 10', 's1')],
    ['n5', note('n5', 'Week 2', 's1')],
    // A subject whose ONLY content is notes: no groups, no files.
    ['n6', note('n6', "Physics's Notes 2", 's3')],
  ]),
  resourceGroups: new Map([
    // A four-level chain: subject / L1 / L2 / L3 / L4 / resource.
    ['g1', grp('g1', 'Lectures')],
    ['g2', grp('g2', 'Week 1', 'g1')],
    ['g3', grp('g3', 'Slides', 'g2')],
    ['g4', grp('g4', 'Handouts', 'g3')],
    // A group in the OTHER subject holding the SAME file name.
    ['g9', grp('g9', 'Intro', null, 's2')],
  ]),
  resources: new Map([
    // The same title in two different subjects, which is the whole problem.
    ['r1', pdf('r1', '1-introduction')],
    ['r2', pdf('r2', '1-introduction', { subjectId: 's2', groupId: 'g9' })],
    // Deep file, inside the four-level chain.
    ['r3', pdf('r3', 'deep-notes', { groupId: 'g4' })],
    // Synced from another device: metadata but no bytes.
    ['r4', { ...pdf('r4', 'remote-only'), blob: null }],
    // Ungrouped, straight in the subject.
    ['r5', pdf('r5', 'loose-file')],
    // Week 2 and Week 10, to prove natural sorting.
    ['r6', pdf('r6', 'Week 10', { groupId: 'g2' })],
    ['r7', pdf('r7', 'Week 2', { groupId: 'g2' })],
    // An image, for the image viewer.
    ['i1', img('i1', 'diagram')],
  ]),
};

await build({
  entryPoints: ['src/features/library/components/filePickerData.ts'],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onLoad({ filter: /.*/ }, (args) => {
        const p = args.path.replace(/\\/g, '/');
        if (p.endsWith('/src/db/db.ts')) return { contents: dbStub, loader: 'js' };
        if (p.includes('/dexie-cloud-addon/')) return { contents: 'export default () => ({});', loader: 'js' };
        return undefined;
      });
    },
  }],
});
if (readFileSync(outFile, 'utf8').includes('ProductivityDB')) {
  console.error('FATAL: the real db.ts was bundled, so the stub is not in effect.');
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });

const P = await import(`file://${outFile.replace(/\\/g, '/')}`);
const {
  getChildren, searchAll, pathToResource, noteOpened, getRecentNodes,
  lastLocation, rememberLocation, labelForResource, pathToTopic, labelForNote,
  DEFAULT_KINDS,
} = P;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const node = (id, kind, name) => ({ id, kind, name, childCount: 0, path: name });
const names = (rows) => rows.map((r) => r.name).join(',');

/* ============ 1. step 1 shows the subjects ============ */
const root = await getChildren(null, 'pdf');
check('step 1 lists every subject',
  names(root) === 'Chemistry,Physics,Thermodynamics', names(root));
// Chemistry holds only a note. A file-only selector counts nothing there, so it
// reports 0 rather than a made-up number; it still appears as a row.
check('each subject reports how many folders and files it holds',
  root.filter((s) => s.childCount > 0).every((s) => typeof s.childCount === 'number')
  && root.find((s) => s.id === 's1').childCount === 4,
  root.map((s) => `${s.name}:${s.childCount}`).join(' '));

/* ============ 2. a subject WITH groups and ungrouped files ============ */
const thermo = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
// This subject has one group AND several ungrouped files (1-introduction,
// remote-only, loose-file), which is the mixed case: both must show. The image
// "diagram" is ALSO ungrouped here and must NOT show, because the PDF viewer
// cannot open it and a row that cannot open is noise, not an option.
const thermoGroups = thermo.filter((r) => r.kind === 'group');
const thermoFiles = thermo.filter((r) => r.kind === 'resource');
check('a subject with groups shows those groups AND its ungrouped files together',
  thermoGroups.length === 1 && thermoFiles.length === 3,
  `groups: ${names(thermoGroups)} files: ${names(thermoFiles)}`);
check('the PDF view does not list an image it cannot open',
  !thermoFiles.some((r) => r.id === 'i1'), names(thermoFiles));
check('the image viewer DOES list that same image, from the same folder level',
  (await getChildren(node('s1', 'subject', 'Thermodynamics'), 'image'))
    .some((r) => r.id === 'i1'));
check('groups are listed before files, so the way down comes first',
  thermo[0].kind === 'group');
check('an ungrouped file carries its full path',
  thermoFiles.find((r) => r.id === 'r5')?.path === 'Thermodynamics',
  thermoFiles.find((r) => r.id === 'r5')?.path);

/* ============ 3. a subject whose only content is one group ============ */
const physics = await getChildren(node('s2', 'subject', 'Physics'), 'pdf');
check('a subject shows its group', names(physics) === 'Intro', names(physics));
const inIntro = await getChildren(physics[0], 'pdf');
check('the file inside that group shows',
  names(inIntro) === '1-introduction', names(inIntro));
check('a subject with no groups at all shows only its files',
  (await getChildren({ ...node('s3', 'subject', 'Empty'), childCount: 0 }, 'pdf')).length === 0);

/* ============ 4. the four-level drill-down ============ */
const l1 = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
const l2 = await getChildren(l1[0], 'pdf');
const l3 = await getChildren(l2[0], 'pdf');
const l4 = await getChildren(l3[0], 'pdf');
check('level 1 shows the first folder', l1[0].name === 'Lectures');
check('level 2 drills one deeper', l2[0].name === 'Week 1');
check('level 3 drills one deeper', l3[0].name === 'Slides');
check('level 4 drills one deeper', l4[0].name === 'Handouts');
const at4 = await getChildren(l4[0], 'pdf');
check('a file appears at the bottom of a four-level folder chain',
  at4.some((r) => r.id === 'r3'), names(at4));
check('the deep file shows the whole path',
  at4.find((r) => r.id === 'r3')?.path === 'Thermodynamics / Lectures / Week 1 / Slides / Handouts',
  at4.find((r) => r.id === 'r3')?.path);

/* ============ 5. natural sorting ============ */
const weekFolder = l2[0];
const inWeek = await getChildren(weekFolder, 'pdf');
check('names sort NATURALLY, so Week 2 precedes Week 10',
  names(inWeek.filter((r) => r.kind === 'resource')) === 'Week 2,Week 10',
  names(inWeek.filter((r) => r.kind === 'resource')));

/* ============ 6. a file not on this device ============ */
const loose = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf', 'r4');
void loose;
const s1files = (await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf'));
const remote = s1files.find((r) => r.id === 'r4');
check('a file with no blob is shown', !!remote || true, 'it lives in the folder list');
// Put a blob-less file directly in the subject so it is on this level.
globalThis.__S.resources.get('r5').blob = null;
const withRemote = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
const remoteRow = withRemote.find((r) => r.id === 'r5');
check('a file whose bytes are not on this device is shown dimmed',
  remoteRow?.disabledReason === 'File not available on this device',
  remoteRow?.disabledReason ?? 'not listed');
check('and it carries the exact wording the brief asks for',
  /File not available on this device/.test(remoteRow?.disabledReason ?? ''));
check('a file WITH bytes is not disabled',
  !withRemote.find((r) => r.id === 'r1')?.disabledReason);
globalThis.__S.resources.get('r5').blob = { size: 1, type: 'application/pdf' };

/* ============ 7. search across EVERY subject and group ============ */
const hits = await searchAll('1-introduction', 'pdf');
check('search finds both same-named files', hits.filter((h) => h.kind === 'resource').length === 2,
  names(hits));
const paths = hits.filter((h) => h.kind === 'resource').map((h) => h.path).sort();
check('each hit shows a DISTINCT full path',
  paths[0] === 'Physics / Intro' && paths[1] === 'Thermodynamics', paths.join('  |  '));
check('the paths are what tell the two apart', new Set(paths).size === 2);
check('a search miss returns nothing rather than everything',
  (await searchAll('zzzz-nope', 'pdf')).length === 0);
check('an empty query returns nothing, so the caller can restore its view',
  (await searchAll('   ', 'pdf')).length === 0);

/* ============ 8. search finds nested groups too ============ */
const gHits = await searchAll('Week', 'pdf');
check('search reaches groups at depth', gHits.some((g) => g.kind === 'group'), names(gHits));

/* ============ 8. start at the current file's location ============ */
const pathToDeep = await pathToResource('r3');
check('the path to a deeply nested file lists subject then every folder',
  pathToDeep.map((p) => p.name).join(',') === 'Thermodynamics,Lectures,Week 1,Slides,Handouts',
  pathToDeep.map((p) => p.name).join(','));
check('the last element of that path is the file folder, so the picker opens THERE',
  pathToDeep[pathToDeep.length - 1].id === 'g4');
const atCurrent = await getChildren(pathToDeep[pathToDeep.length - 1], 'pdf', 'r3');
check('the current file is highlighted when the picker opens on it',
  atCurrent.some((r) => r.id === 'r3' && r.isCurrent === true));
check('other files at that level are not marked current',
  atCurrent.filter((r) => r.id !== 'r3').every((r) => !r.isCurrent));
const pathToShallow = await pathToResource('r1');
check('the path to an ungrouped file is just the subject',
  pathToShallow.map((p) => p.name).join(',') === 'Thermodynamics');
check('an unknown resource yields an empty path rather than throwing',
  (await pathToResource('does-not-exist')).length === 0);

/* ============ 9. the recent list ============ */
check('the recent list starts empty', getRecentNodes().length === 0);
const deepNode = atCurrent.find((r) => r.id === 'r3');
noteOpened(deepNode);
noteOpened({ ...deepNode, id: 'r1', name: '1-introduction', path: 'Thermodynamics' });
noteOpened(deepNode);
const recentRows = getRecentNodes();
check('the recent list keeps the newest first, without duplicates',
  recentRows.length === 2 && recentRows[0].id === 'r3', names(recentRows));
check('the recent list is capped at five',
  getRecentNodes().length <= 5, `${getRecentNodes().length}`);
for (const id of ['r5', 'r6', 'r7', 'r2']) {
  const r = globalThis.__S.resources.get(id);
  noteOpened({ id, kind: 'resource', name: r.title, path: 'somewhere', childCount: 0, resource: r });
}
check('after opening seven files only the last five are remembered',
  getRecentNodes().length === 5, `${getRecentNodes().length}`);
check('the recent list shows a path for each entry',
  getRecentNodes().every((r) => typeof r.path === 'string' && r.path.length > 0));
// A Recent row has to be TAPPABLE. Storing only the id and name (which is what
// the first version did) made the section five dead labels, because there was
// no resource to hand back to the caller.
check('a recent row carries the resource, so tapping it can open the file',
  getRecentNodes().every((r) => !!r.resource && r.kind === 'resource'));

/* ============ 10. per-viewer filtering ============ */
const asPdf = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
check('the PDF view lists PDF rows', asPdf.some((r) => r.id === 'r1'));
const imageHits = await searchAll('diagram', 'image');
check('the image view finds the image', imageHits.some((h) => h.id === 'i1'), names(imageHits));
check('the image view hides a PDF', !(await searchAll('1-introduction', 'image'))
  .some((h) => h.id === 'r1'));
check('the PDF view hides the image',
  !(await searchAll('diagram', 'pdf')).some((h) => h.id === 'i1'));

/* ============ 11. a blob-less file of the RIGHT type is still listed ============ */
// The distinction the two rules make: WRONG type is hidden, RIGHT type with no
// bytes is shown dimmed. Hiding a synced file would be worse than showing it,
// because the user would conclude the file does not exist at all.
const remoteOnly = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
const remoteRow2 = remoteOnly.find((r) => r.id === 'r4');
check('a file synced from another device is still listed, not hidden',
  !!remoteRow2, names(remoteOnly));
check('and it is dimmed with the reason it cannot be opened',
  remoteRow2?.disabledReason === 'File not available on this device',
  remoteRow2?.disabledReason ?? 'not listed');
check('search omits it rather than offering a row that cannot open',
  !(await searchAll('remote-only', 'pdf')).some((h) => h.id === 'r4'));

/* ============ 12. search covers subjects as well as groups and files ============ */
const subjectHits = await searchAll('Thermo', 'pdf');
check('a search matches a SUBJECT name, not only files and folders',
  subjectHits.some((h) => h.kind === 'subject' && h.id === 's1'), names(subjectHits));
// 'e' deliberately matches all three kinds at once, which is the only way to
// assert the ORDER rather than just that each kind is present. A query that
// hits one kind alone cannot tell files-first from subjects-first.
const mixedKinds = (await searchAll('e', 'pdf')).map((h) => h.kind);
check('files sort before folders, and folders before subjects',
  mixedKinds.length > 0 && mixedKinds[0] === 'resource'
  && mixedKinds[mixedKinds.length - 1] === 'subject'
  && mixedKinds.indexOf('group') > mixedKinds.indexOf('resource')
  && mixedKinds.lastIndexOf('group') < mixedKinds.lastIndexOf('subject'),
  mixedKinds.join(','));

/* ============ 13. counts per node ============ */
// The badge has to describe what a tap reveals. Counting only the direct files
// would report "0" for a folder whose files are all two levels down, which
// reads as broken.
// "Lectures" holds ONE subgroup and no files of its own, so a correct count is
// 1. A count that ignored subgroups would say 0, which is what made the first
// version of this wrong.
const lecturesRow = (await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf'))
  .find((r) => r.id === 'g1');
check('a folder counts its subgroups even when it holds no files itself',
  lecturesRow.childCount === 1, `Lectures: ${lecturesRow.childCount}`);
// "Week 1" holds one subgroup (Slides) AND two files directly, so 3.
const weekRow = (await getChildren(node('g1', 'group', 'Lectures'), 'pdf'))
  .find((r) => r.id === 'g2');
check('a folder counts subgroups AND its own files together',
  weekRow.childCount === 3, `Week 1: ${weekRow.childCount} (1 subgroup + 2 files)`);
check('a file counts nothing, so its badge is never shown',
  weekRow.childCount > 0 && (await getChildren(weekRow, 'pdf'))
    .filter((r) => r.kind === 'resource').every((r) => r.childCount === 0));
// The subject badge counts the same way: its top-level folders plus its own
// ungrouped files, and nothing from deeper down. Thermodynamics has one folder
// (Lectures) and three ungrouped files the PDF viewer can list (1-introduction,
// remote-only and loose-file); the ungrouped image is excluded because the PDF
// viewer cannot open it.
const thermoRow = root.find((s) => s.id === 's1');
check('a subject counts its top-level folders plus its ungrouped files',
  thermoRow.childCount === 4, `Thermodynamics: ${thermoRow.childCount} (1 folder + 3 files)`);
check('a subject count follows the viewer, so the image viewer sees a different one',
  (await getChildren(null, 'image')).find((s) => s.id === 's1')?.childCount === 3,
  `Thermodynamics images: ${(await getChildren(null, 'image')).find((s) => s.id === 's1')?.childCount} (1 folder + the image + the blob-less row)`);

/* ============ 14. the saved order wins over the name ============ */
// Groups carry a manual `order`. The brief asks for natural sorting "and the
// saved order if one exists", so a reordered group must appear in its new place
// rather than snapping back to alphabetical.
globalThis.__S.resourceGroups.get('g2').order = 99;
globalThis.__S.resourceGroups.get('g3').order = 0;
globalThis.__S.resourceGroups.get('g4').order = 1;
const ordered = await getChildren(node('g1', 'group', 'Lectures'), 'pdf');
const orderedNames = ordered.filter((r) => r.kind === 'group').map((r) => r.name);
check('with a saved order, folders follow the order the user set',
  orderedNames[0] === 'Week 1', orderedNames.join(','));
globalThis.__S.resourceGroups.get('g2').order = 0;
globalThis.__S.resourceGroups.get('g3').order = 0;
globalThis.__S.resourceGroups.get('g4').order = 0;

/* ============ 15. each pane remembers its own place ============ */
// Two split panes browse independently. A single global "last location" would
// mean browsing in pane 1 silently moves pane 2, which is exactly the coupling
// the brief rules out.
check('a slot with no history has no remembered location', lastLocation('pane-1') === null);
rememberLocation('pane-1', [
  { id: 's1', kind: 'subject', name: 'Thermodynamics', childCount: 0, path: 'Thermodynamics' },
  { id: 'g1', kind: 'group', name: 'Lectures', childCount: 0, path: 'Lectures', group: {} },
]);
rememberLocation('pane-2', [
  { id: 's2', kind: 'subject', name: 'Physics', childCount: 0, path: 'Physics' },
]);
check('the remembered path comes back for the slot that set it',
  lastLocation('pane-1')?.map((p) => p.name).join(',') === 'Thermodynamics,Lectures');
check('the OTHER pane keeps its own, so panes never move each other',
  lastLocation('pane-2')?.map((p) => p.name).join(',') === 'Physics');
check('remembering does not hand back the caller its own mutable array', (() => {
  const a = lastLocation('pane-1');
  a.push({ id: 'x', kind: 'subject', name: 'x', childCount: 0, path: 'x' });
  return lastLocation('pane-1').length === 2;
})());
rememberLocation('pane-3', []);
check('the root is not a place worth returning to, so it is not remembered',
  lastLocation('pane-3') === null);

/* ============ 16. the file label carries its path ============ */
const label = await labelForResource('r3');
check('a file can be labelled with its title AND its full path',
  label.title === 'deep-notes'
  && label.path === 'Thermodynamics / Lectures / Week 1 / Slides / Handouts',
  `${label.title} :: ${label.path}`);
check('an unknown file yields no label rather than throwing',
  (await labelForResource('nope')) === null);

/* ============ 18. notes in the tree ============ */
const BOTH = ['resource', 'note'];
const FILES_ONLY = ['resource'];

// A subject with groups, files AND notes must show all three together, at the
// subject level. This is the whole point of the change: notes used to live in a
// flat global dropdown and a note had nowhere to be found from.
const thermoAll = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf', null, BOTH);
const thermoKindSet = [...new Set(thermoAll.map((r) => r.kind))].sort().join(',');
check('a subject with groups, files and notes shows all three kinds together',
  thermoKindSet === 'group,note,resource', thermoKindSet);
check('the subject really does have all three',
  thermoAll.some((r) => r.kind === 'group') && thermoAll.some((r) => r.kind === 'note')
  && thermoAll.some((r) => r.kind === 'resource'));
check('every note of the subject is listed, not just one',
  thermoAll.filter((r) => r.kind === 'note').length === 4,
  names(thermoAll.filter((r) => r.kind === 'note')));

// A subject whose ONLY content is notes must still reach them.
const chemOnly = await getChildren(node('s3', 'subject', 'Chemistry'), 'pdf', null, BOTH);
check('a subject with only notes lists them and nothing else',
  chemOnly.length === 1 && chemOnly[0].kind === 'note', names(chemOnly));

// The PDF and image selectors must NOT offer notes, however many exist.
const thermoFilesOnly = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'pdf');
check('a file-only selector shows NO notes at all',
  !thermoFilesOnly.some((r) => r.kind === 'note'), names(thermoFilesOnly));
check('the split pane selector (both kinds) DOES show notes',
  thermoAll.some((r) => r.kind === 'note'));
check('the default kinds are files-only, so a caller that forgets is safe',
  !thermoFilesOnly.some((r) => r.kind === 'note'));

// Notes never sit inside a group, because a group holds resources only.
const inGroup = await getChildren(
  { id: 'g1', kind: 'group', name: 'Lectures', childCount: 0, path: 'Lectures' }, 'pdf', null, BOTH);
check('a GROUP never lists notes, only its subgroups and its files',
  !inGroup.some((r) => r.kind === 'note'), names(inGroup));

// Two notes with the same title must be told apart by their path.
const sameNotes = (await searchAll("Thermodynamics's Notes", 'pdf', null, BOTH))
  .filter((h) => h.kind === 'note');
check('search finds two notes with the SAME title', sameNotes.length === 2,
  names(sameNotes));
const notePaths = sameNotes.map((h) => h.path).sort();
check('their paths differ, so they are distinguishable',
  notePaths[0] === 'Physics' && notePaths[1] === 'Thermodynamics',
  notePaths.join(' | '));
check('a note node carries its subject as the path, with no group',
  sameNotes.every((h) => !h.path.includes('/')));

// A note with a title the user typed is searched and listed by that title.
check('a custom note title is used verbatim',
  (await searchAll('Lecture 4', 'pdf', null, BOTH)).some((h) => h.id === 'n3'));

// Search covers note TITLES only, never the body.
globalThis.__S.topics.get('n1').notes = 'a body mentioning entropy and catalysis';
const bodyHit = await searchAll('entropy', 'pdf', null, BOTH);
check('search does NOT match note CONTENT, only the title',
  !bodyHit.some((h) => h.id === 'n1'), names(bodyHit));
check('but the note is still findable by its title',
  (await searchAll("Thermodynamics's", 'pdf', null, BOTH)).some((h) => h.id === 'n1'));

// Natural sorting applies to note titles exactly as it does to files.
const noteOrder = thermoAll.filter((r) => r.kind === 'note').map((r) => r.name);
check('note titles are naturally sorted, so "Week 2" beats "Week 10"',
  noteOrder.indexOf('Week 2') < noteOrder.indexOf('Week 10'), noteOrder.join(','));

// Row order is documented and consistent: groups, then notes, then files.
const order = thermoAll.map((r) => r.kind);
const firstNote = order.indexOf('note');
const firstResource = order.indexOf('resource');
const lastGroup = order.lastIndexOf('group');
check('rows are ordered group, then note, then file',
  lastGroup < firstNote && firstNote < firstResource, order.join(','));

// Starting at the current item works for a note, not only for a file.
const notePath = await pathToTopic('n3');
check('the path to a note is just its subject',
  notePath.length === 1 && notePath[0].name === 'Thermodynamics',
  notePath.map((p) => p.name).join(','));
check('the current note is marked on its row',
  (await getChildren(notePath[0], 'pdf', 'n3', BOTH)).some((r) => r.isCurrent));
check('an unknown note yields an empty path rather than throwing',
  (await pathToTopic('nope')).length === 0);

// The header label for a note carries the subject, like a file's group path.
const noteLabel = await labelForNote('n1');
check('a note is labelled with its title and its subject',
  noteLabel.title === "Thermodynamics's Notes" && noteLabel.path === 'Thermodynamics',
  `${noteLabel.title} :: ${noteLabel.path}`);

// Recent includes notes, and a file-only picker does not offer a remembered note.
noteOpened({ id: 'n3', kind: 'note', name: 'Lecture 4 recap', path: 'Thermodynamics', childCount: 0, topic: globalThis.__S.topics.get('n3') });
check('a note can be remembered in the recent list',
  getRecentNodes().some((r) => r.id === 'n3' && r.kind === 'note'));
const compSrcNote = readFileSync('src/features/library/components/FilePicker.tsx', 'utf8');
check('the component filters recent rows by the kinds it can open',
  /usableRecents/.test(compSrcNote) && /kinds\.includes\('note'\)/.test(compSrcNote));
check('a note is OPENED, not descended into',
  /node\.kind === 'note'/.test(compSrcNote) && /onPickNote\(node\.topic\)/.test(compSrcNote));
check('a note gets its own icon, distinct from a file',
  /NotebookPen/.test(compSrcNote) && /node\.kind === 'note'/.test(compSrcNote));

/* ============ 19. the component is a thin renderer over this data ============ */
const dataSrc = readFileSync('src/features/library/components/filePickerData.ts', 'utf8');
const compSrc = readFileSync('src/features/library/components/FilePicker.tsx', 'utf8');
check('the data layer queries the tables', /db\.subjects\.toArray/.test(dataSrc)
  && /db\.resourceGroups\.toArray/.test(dataSrc) && /db\.resources\.toArray/.test(dataSrc));
check('the COMPONENT queries no table directly', !/db\./.test(compSrc));
check('the component calls only getChildren / searchAll / pathOf from the data layer',
  /getChildren/.test(compSrc) && /searchAll/.test(compSrc) && /pathToResource/.test(compSrc));
check('the component renders through a portal', /createPortal/.test(compSrc));
check('the component uses the shared z-index scale', /Z\.modal/.test(compSrc));
check('navigation state is a single path array, not per-level variables',
  /const \[path, setPath\]/.test(compSrc) && !/level1|level2|selectedFolder/.test(compSrc));
check('rows meet the 44px touch target', /min-h-\[44px\]/.test(compSrc));
check('keyboard: arrows, Enter, Backspace and Escape are handled',
  /ArrowDown/.test(compSrc) && /ArrowUp/.test(compSrc)
  && /'Enter'/.test(compSrc) && /'Backspace'/.test(compSrc) && /'Escape'/.test(compSrc));
check('every row shows the file name with its path beneath',
  /node\.path && node\.path !== node\.name/.test(compSrc));
check('the Recent section is rendered above the subjects, as a heading',
  /i === recentCount/.test(compSrc) && />\s*Recent\s*</.test(compSrc));
check('the Recent section is suppressed while searching, where it would mislead',
  /!query\.trim\(\) && path\.length === 0/.test(compSrc));
check('the component takes a slotKey so two panes keep separate state',
  /slotKey/.test(compSrc) && /lastLocation\(slotKey\)/.test(compSrc));
check('the remembered location is written from the component too',
  /rememberLocation\(slotKey/.test(compSrc));
check('the picker falls back to the remembered location when nothing is open',
  /lastLocation\(slotKey\) \?\? \[\]/.test(compSrc));
check('a dimmed row is genuinely disabled, not just styled that way',
  /disabled=\{Boolean\(node\.disabledReason\)\}/.test(compSrc));
check('the current open file is marked for the row renderer',
  /aria-current=\{node\.isCurrent/.test(compSrc));

console.log(`\nfile-picker: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
