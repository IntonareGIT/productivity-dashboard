/**
 * Resource groups, end to end, against the REAL repository functions.
 *
 * Phase 1 exists because "New group" appeared to do nothing. The cause was a
 * render guard, not a write failure, so these checks read the data back out of
 * the stubbed Dexie after EVERY action: if a group is not actually stored, or its
 * resources are lost, that fails here rather than in the browser.
 *
 * Also pins the two invariants that protect user data:
 *   - deleting a group UNGROUPS its resources and never deletes them
 *   - deleting a subject deletes its groups
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'groups-phase1-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `export * from '${root}/src/features/library/libraryRepo';`);
const bundleFile = join(process.cwd(), 'node_modules', '.cache-groups-phase1.mjs');

const dbStub = `
const S = globalThis.__S;
const col = (name) => {
  const m = () => Array.from(S[name].values());
  return {
    async toArray() { return m(); },
    async get(id) { return S[name].get(id); },
    async put(v) { S[name].set(v.id, v); return v.id; },
    async count() { return S[name].size; },
    async delete(id) { S[name].delete(id); },
    async bulkDelete(ids) { for (const id of ids) S[name].delete(id); },
    async bulkPut(rows) { for (const r of rows) S[name].set(r.id, r); return rows.map((r) => r.id); },
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
const _db = new Proxy({}, {
  get(_t, name) {
    if (name === 'transaction') return async (...a) => a[a.length - 1]();
    return col(String(name));
  },
});
export const db = _db;
`;

// Seed BEFORE the bundle is imported: the db stub reads `globalThis.__S` at
// module load, so the tables have to exist first.
globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Algorithms', color: '#6366f1', notes: '', createdAt: 'x', updatedAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#22c55e', notes: '', createdAt: 'x', updatedAt: 'x' }],
  ]),
  topics: new Map([
    ['t1', { id: 't1', subjectId: 's1', title: 'Graphs', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
    ['t2', { id: 't2', subjectId: 's1', title: 'Trees', notes: '', status: 'not_started', order: 1, createdAt: 'x', updatedAt: 'x' }],
    ['t3', { id: 't3', subjectId: 's2', title: 'Optics', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
  ]),
  resources: new Map([
    ['r1', { id: 'r1', subjectId: 's1', topicId: 't1', kind: 'link', title: 'A', urlOrPath: 'https://a', tags: [], createdAt: 'x' }],
    ['r2', { id: 'r2', subjectId: 's1', topicId: 't2', kind: 'link', title: 'B', urlOrPath: 'https://b', tags: [], createdAt: 'x' }],
    ['r3', { id: 'r3', subjectId: 's2', topicId: 't3', kind: 'link', title: 'C', urlOrPath: 'https://c', tags: [], createdAt: 'x' }],
  ]),
  resourceGroups: new Map(),
  assessments: new Map(),
  pomodoroSessions: new Map(),
  calendarEvents: new Map(),
};

await build({
  entryPoints: [entry],
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /db\/db$/ }, () => ({ path: 'db-stub', namespace: 'stub' }));
      b.onResolve({ filter: /cloudConfig$/ }, () => ({ path: 'cfg-stub', namespace: 'stub' }));
      b.onLoad({ filter: /db-stub/, namespace: 'stub' }, () => ({ contents: dbStub, loader: 'js' }));
      b.onLoad({ filter: /cfg-stub/, namespace: 'stub' }, () => ({ contents: 'export const LARGE_BLOB_WARNING_BYTES = 1e9;', loader: 'js' }));
    },
  }],
});
rmSync(outDir, { recursive: true, force: true });

const repo = await import(`file://${bundleFile.replace(/\\/g, '/')}`);
const {
  saveResourceGroup, renameResourceGroup, deleteResourceGroup, moveResourceToGroup,
  moveResourcesToGroup, listResourceGroups, saveResource, deleteSubjectCascade,
} = repo;
const S = globalThis.__S;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// ------------------------------------------- 1. create, and READ IT BACK
const g1 = await saveResourceGroup({ subjectId: 's1', name: 'Past papers' });
check('create: the group row is really in the table', S.resourceGroups.get(g1)?.name === 'Past papers',
  JSON.stringify(S.resourceGroups.get(g1)));
check('create: it is owned by the right subject', S.resourceGroups.get(g1)?.subjectId === 's1');
check('create: it gets a string id, not an autoincrement one',
  typeof g1 === 'string' && g1.length > 10, String(g1));
check('create: order is assigned', typeof S.resourceGroups.get(g1)?.order === 'number');
check('create: an EMPTY group is returned by the live list query',
  (await listResourceGroups('s1')).some((g) => g.id === g1), 'a zero-member group must still be listed');

const g2 = await saveResourceGroup({ subjectId: 's1', name: 'Lecture slides' });
const gOther = await saveResourceGroup({ subjectId: 's2', name: 'Physics extras' });
check('create: a second group is appended, not overwritten', S.resourceGroups.size === 3 && S.resourceGroups.get(g2).order === 1);
check('create: a blank name is rejected', await saveResourceGroup({ subjectId: 's1', name: '  ' }).then(() => false, () => true));
check('create: a group for a missing subject is rejected', await saveResourceGroup({ subjectId: 'nope', name: 'x' }).then(() => false, () => true));
check('read back: the list is scoped to one subject',
  (await listResourceGroups('s1')).every((g) => g.subjectId === 's1') && (await listResourceGroups('s1')).length === 2);

// --------------------------------------------------------- 2. rename
await renameResourceGroup(g1, '  Past papers 2024  ');
check('rename: trimmed and stored', S.resourceGroups.get(g1).name === 'Past papers 2024', S.resourceGroups.get(g1).name);
await renameResourceGroup(g1, '   ');
check('rename: a blank rename is ignored', S.resourceGroups.get(g1).name === 'Past papers 2024');
await renameResourceGroup(g1, 'Past papers');
check('rename: a real rename works', S.resourceGroups.get(g1).name === 'Past papers');

// ------------------------------------------------- 3. move, then read back
await moveResourceToGroup('r1', g1);
check('move: the resource is in the group', S.resources.get('r1').groupId === g1);
await moveResourceToGroup('r1', g2);
check('move: at most one group, a second move replaces it', S.resources.get('r1').groupId === g2);
await moveResourceToGroup('r1', gOther);
check('move: a cross-subject group is refused', S.resources.get('r1').groupId === g2);
await moveResourceToGroup('r1', null);
check('move: "No group" clears it', S.resources.get('r1').groupId === null);
await moveResourceToGroup('r1', g1);

// -------------------------------- 4. delete ungroups, never deletes resources
const before = S.resources.size;
await moveResourcesToGroup(['r1', 'r2'], g1);
await deleteResourceGroup(g1);
check('delete: the group row is gone', !S.resourceGroups.has(g1));
check('delete: NO resource was deleted', S.resources.size === before, `${S.resources.size} of ${before}`);
check('delete: members survive and are ungrouped',
  S.resources.has('r1') && S.resources.get('r1').groupId === null && S.resources.get('r1').title === 'A');
check('delete: a group with no members deletes cleanly', await deleteResourceGroup(g2).then(() => true));

// ------------------------------- 5. subject change clears the groupId
await moveResourceToGroup('r3', gOther);
check('setup: r3 is grouped', S.resources.get('r3').groupId === gOther);
await saveResource({ id: 'r3', subjectId: 's1', topicId: 't1', kind: 'link', title: 'C', urlOrPath: 'https://c' });
check('subject change: the groupId is cleared', S.resources.get('r3').groupId === null, String(S.resources.get('r3').groupId));

// ------------------------------------------ 6. subject delete cascades
await saveResourceGroup({ subjectId: 's1', name: 'Doomed' });
await deleteSubjectCascade('s1');
check('subject delete: its groups are deleted', ![...S.resourceGroups.values()].some((g) => g.subjectId === 's1'));
check('subject delete: another subject keeps its groups', S.resourceGroups.has(gOther));
check('subject delete: no resource is left pointing at a deleted group',
  ![...S.resources.values()].some((r) => r.groupId && !S.resourceGroups.has(r.groupId)));

// ------------------------------------------- 7. the render guard that caused it
const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
const menu = readFileSync('src/features/library/components/MoveToGroupMenu.tsx', 'utf8');
check('UI: a zero-member group is NOT skipped', !/if \(members\.length === 0\) return null;/.test(detail));
// The empty-group hint moved into GroupTree.tsx with the rest of the tree
// markup, and now covers both "no resources and no subgroups".
const treeUi = readFileSync('src/features/library/components/GroupTree.tsx', 'utf8');
check('UI: an empty group shows an inline hint', /This group is empty/.test(treeUi));
check('UI: the New group control renders even with zero resources',
  /<NewGroupButton onCreate=\{createGroup\}/.test(detail) &&
  detail.indexOf('<NewGroupButton') < detail.indexOf('topicResources.length === 0 ?'));
check('UI: group writes are awaited and report failures', /runGroupAction/.test(detail) && /toast\('error'/.test(detail));
check('UI: the move menu reports failures too', /toast\('error'/.test(menu));
// Comments stripped: the fix's own note describes the old `void saveResourceGroup(...)`
// form, which would otherwise trip this check.
const detailCode = detail.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('UI: no bare void on a group write', !/void (saveResourceGroup|renameResourceGroup|deleteResourceGroup)\(/.test(detailCode));
check('UI: no window.prompt (an inline input is used instead)', !/window\.prompt/.test(detail + menu));

// ---------------------------------------- 8. primary keys match synced tables
const dbSrc = readFileSync('src/db/db.ts', 'utf8');
check('schema: resourceGroups uses a string id like every other synced table',
  /resourceGroups: 'id, subjectId, order, createdAt'/.test(dbSrc));
check('schema: no autoincrement key on any table', !/\+\+id/.test(dbSrc));
check('schema: v10 is current and has an upgrade', /\.version\(10\)/.test(dbSrc) && /version\(10\)[\s\S]{0,400}?\.upgrade\(async/.test(dbSrc));

console.log(`\nresource-groups-phase1: ${pass} passed, ${fail} failed`);
try { rmSync(bundleFile, { force: true }); } catch { /* best effort */ }
process.exit(fail === 0 ? 0 : 1);
