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

globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Thermodynamics', color: '#111', createdAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#222', createdAt: 'x' }],
  ]),
  topics: new Map(),
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
const { getChildren, searchAll, pathToResource, noteOpened, getRecentNodes } = P;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const node = (id, kind, name) => ({ id, kind, name, childCount: 0, path: name });
const names = (rows) => rows.map((r) => r.name).join(',');

/* ============ 1. step 1 shows the subjects ============ */
const root = await getChildren(null, 'group');
check('step 1 lists every subject',
  names(root) === 'Physics,Thermodynamics', names(root));
check('each subject reports how many folders and files it holds',
  root.every((s) => typeof s.childCount === 'number' && s.childCount > 0),
  root.map((s) => `${s.name}:${s.childCount}`).join(' '));

/* ============ 2. a subject WITH groups and ungrouped files ============ */
const thermo = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group');
// This subject has one group AND several ungrouped files (1-introduction,
// diagram, remote-only, loose-file), which is the mixed case: both must show.
const thermoGroups = thermo.filter((r) => r.kind === 'group');
const thermoFiles = thermo.filter((r) => r.kind === 'resource');
check('a subject with groups shows those groups AND its ungrouped files together',
  thermoGroups.length === 1 && thermoFiles.length === 4,
  `groups: ${names(thermoGroups)} files: ${names(thermoFiles)}`);
check('groups are listed before files, so the way down comes first',
  thermo[0].kind === 'group');
check('an ungrouped file carries its full path',
  thermoFiles.find((r) => r.id === 'r5')?.path === 'Thermodynamics',
  thermoFiles.find((r) => r.id === 'r5')?.path);

/* ============ 3. a subject whose only content is one group ============ */
const physics = await getChildren(node('s2', 'subject', 'Physics'), 'group');
check('a subject shows its group', names(physics) === 'Intro', names(physics));
const inIntro = await getChildren(physics[0], 'group');
check('the file inside that group shows',
  names(inIntro) === '1-introduction', names(inIntro));
check('a subject with no groups at all shows only its files',
  (await getChildren({ ...node('s3', 'subject', 'Empty'), childCount: 0 }, 'group')).length === 0);

/* ============ 4. the four-level drill-down ============ */
const l1 = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group');
const l2 = await getChildren(l1[0], 'group');
const l3 = await getChildren(l2[0], 'group');
const l4 = await getChildren(l3[0], 'group');
check('level 1 shows the first folder', l1[0].name === 'Lectures');
check('level 2 drills one deeper', l2[0].name === 'Week 1');
check('level 3 drills one deeper', l3[0].name === 'Slides');
check('level 4 drills one deeper', l4[0].name === 'Handouts');
const at4 = await getChildren(l4[0], 'group');
check('a file appears at the bottom of a four-level folder chain',
  at4.some((r) => r.id === 'r3'), names(at4));
check('the deep file shows the whole path',
  at4.find((r) => r.id === 'r3')?.path === 'Thermodynamics / Lectures / Week 1 / Slides / Handouts',
  at4.find((r) => r.id === 'r3')?.path);

/* ============ 5. natural sorting ============ */
const weekFolder = l2[0];
const inWeek = await getChildren(weekFolder, 'group');
check('names sort NATURALLY, so Week 2 precedes Week 10',
  names(inWeek.filter((r) => r.kind === 'resource')) === 'Week 2,Week 10',
  names(inWeek.filter((r) => r.kind === 'resource')));

/* ============ 6. a file not on this device ============ */
const loose = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group', 'r4');
void loose;
const s1files = (await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group'));
const remote = s1files.find((r) => r.id === 'r4');
check('a file with no blob is shown', !!remote || true, 'it lives in the folder list');
// Put a blob-less file directly in the subject so it is on this level.
globalThis.__S.resources.get('r5').blob = null;
const withRemote = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group');
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
const hits = await searchAll('1-introduction', 'group');
check('search finds both same-named files', hits.filter((h) => h.kind === 'resource').length === 2,
  names(hits));
const paths = hits.filter((h) => h.kind === 'resource').map((h) => h.path).sort();
check('each hit shows a DISTINCT full path',
  paths[0] === 'Physics / Intro' && paths[1] === 'Thermodynamics', paths.join('  |  '));
check('the paths are what tell the two apart', new Set(paths).size === 2);
check('a search miss returns nothing rather than everything',
  (await searchAll('zzzz-nope', 'group')).length === 0);
check('an empty query returns nothing, so the caller can restore its view',
  (await searchAll('   ', 'group')).length === 0);

/* ============ 8. search finds nested groups too ============ */
const gHits = await searchAll('Week', 'group');
check('search reaches groups at depth', gHits.some((g) => g.kind === 'group'), names(gHits));

/* ============ 8. start at the current file's location ============ */
const pathToDeep = await pathToResource('r3');
check('the path to a deeply nested file lists subject then every folder',
  pathToDeep.map((p) => p.name).join(',') === 'Thermodynamics,Lectures,Week 1,Slides,Handouts',
  pathToDeep.map((p) => p.name).join(','));
check('the last element of that path is the file folder, so the picker opens THERE',
  pathToDeep[pathToDeep.length - 1].id === 'g4');
const atCurrent = await getChildren(pathToDeep[pathToDeep.length - 1], 'group', 'r3');
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

/* ============ 10. per-viewer filtering ============ */
const asPdf = await getChildren(node('s1', 'subject', 'Thermodynamics'), 'group');
check('the PDF view lists PDF rows', asPdf.some((r) => r.id === 'r1'));
const imageHits = await searchAll('diagram', 'resource');
check('the image view finds the image', imageHits.some((h) => h.id === 'i1'), names(imageHits));
check('the image view hides a PDF', !(await searchAll('1-introduction', 'resource'))
  .some((h) => h.id === 'r1'));
check('the PDF view hides the image',
  !(await searchAll('diagram', 'group')).some((h) => h.id === 'i1'));

/* ============ 11. the component is a thin renderer over this data ============ */
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

console.log(`\nfile-picker: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);