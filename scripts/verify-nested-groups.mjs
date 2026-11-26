/**
 * Phase 1: nested groups.
 *
 * Two layers are covered:
 *   1. the SHARED rules module (`groupTree.ts`), pure functions with no browser;
 *   2. the REAL repository functions, bundled against the same in-memory Dexie
 *      stub the other suites use, so the enforcement path (not just the rule) is
 *      exercised.
 *
 * Not covered: the IndexedDB upgrade transaction itself (no `fake-indexeddb`
 * dependency). The v14 upgrade body is asserted by shape in
 * verify-app-invariants.mjs, exactly as the v10 one is.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'nested-'));
// The bundle goes in node_modules, NOT outDir: the import happens after the
// build, and deleting outDir first would remove the very file being imported.
const outFile = join(process.cwd(), 'node_modules', '.cache-nested-groups.mjs');

const dbStub = `
// Declared with 'var' (hoisted) so every db.x reference resolves. A top-level
// const is emitted after its first use and compiles to void 0.x.
export var db = new Proxy({}, {
  get(_t, name) {
    if (name === 'transaction') return async (...a) => a[a.length - 1]();
    var S = globalThis.__S;
    var col = function (n) {
      var m = () => Array.from((S[n] ?? new Map()).values());
      return {
        async toArray() { return m(); },
        async get(id) { return (S[n] ?? new Map()).get(id); },
        async put(v) { S[n].set(v.id, v); return v.id; },
        async count() { return (S[n] ?? new Map()).size; },
        async delete(id) { S[n].delete(id); },
        async bulkDelete(ids) { for (const id of ids) S[n].delete(id); },
        async bulkPut(rows) { for (const r of rows) S[n].set(r.id, r); return rows.map((r) => r.id); },
        where: (idx) => ({ equals: (val) => ({
          toArray: async () => m().filter((r) => r[idx] === val),
          first: async () => m().find((r) => r[idx] === val),
          delete: async () => {},
        }) }),
        filter: () => ({ first: async () => m()[0], toArray: async () => m() }),
      };
    };
    return col(String(name));
  },
});
`;

globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Thermodynamics', color: '#6366f1', notes: '', createdAt: 'x', updatedAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#22c55e', notes: '', createdAt: 'x', updatedAt: 'x' }],
  ]),
  topics: new Map([
    ['t1', { id: 't1', subjectId: 's1', title: 'Graphs', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
  ]),
  // Two rows with NO groupId and NO parentGroupId: the pre-v14 data this must
  // leave working.
  resources: new Map([
    ['r1', { id: 'r1', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Legacy A', urlOrPath: 'https://a', tags: [], createdAt: 'x' }],
    ['r2', { id: 'r2', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Legacy B', urlOrPath: 'https://b', tags: [], createdAt: 'x' }],
  ]),
  resourceGroups: new Map(),
  assessments: new Map(), pomodoroSessions: new Map(), calendarEvents: new Map(),
};

await build({
  entryPoints: ['src/features/library/libraryRepo.ts'],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onLoad({ filter: /.*/ }, (args) => {
        const p = args.path.replace(/\\/g, '/');
        if (p.endsWith('/src/db/db.ts')) return { contents: dbStub, loader: 'js' };
        if (p.includes('/cloudConfig')) {
          return { contents: 'export const LARGE_BLOB_WARNING_BYTES = 1e9;', loader: 'js' };
        }
        if (p.includes('/dexie-cloud-addon/')) return { contents: 'export default () => ({});', loader: 'js' };
        return undefined;
      });
    },
  }],
});
// Guard BEFORE the temp dir is removed: the real db.ts being bundled here would
// silently make every scenario talk to an empty real database instead of the
// stub, and the suite would "pass" while testing nothing.
if (readFileSync(outFile, 'utf8').includes('ProductivityDB')) {
  console.error('FATAL: the real db.ts was bundled, so the stub is not in effect.');
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });

const repo = await import(`file://${outFile.replace(/\\/g, '/')}`);
const {
  saveResourceGroup, renameResourceGroup, deleteResourceGroup, moveGroup,
  moveResourceToGroup, moveResourcesToGroup, listResourceGroups,
  saveResource, deleteSubjectCascade,
} = repo;
// The rules module is bundled separately: it is pure and has no Dexie import, so
// testing it directly keeps the rule tests independent of the repository stub.
const rulesFile = join(process.cwd(), 'node_modules', '.cache-group-tree.mjs');
await build({
  entryPoints: ['src/features/library/groupTree.ts'],
  outfile: rulesFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {
  MAX_GROUP_DEPTH, parentOf, getChildGroups, getAncestors, getDescendants,
  depthOf, wouldCreateCycle, buildGroupTree, pathOf, validateGroupPlacement,
  deleteImpact, validGroupDestinations,
} = await import(`file://${rulesFile.replace(/\\/g, '/')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const S = () => globalThis.__S;
const groupsOf = (subjectId) => [...S().resourceGroups.values()].filter((g) => g.subjectId === subjectId);
const rejects = async (fn) => {
  try { await fn(); return null; } catch (e) { return e.message; }
};

/* ============ 1. the pure rules, on a hand-built tree ============ */
// T (depth 1) -> Lectures (2) -> Week 1 (3) -> Slides (4); P is a sibling branch.
// Plain JS, so no annotations: `t` builds a minimal group row. `order` is
// included because the real repo always sets it, and the tree sorts siblings by
// it before falling back to name.
let orderSeq = 0;
const t = (id, name, parentGroupId, subjectId = 's1') =>
  ({ id, name, parentGroupId, subjectId, order: orderSeq++ });
const tree = [
  t('T', 'Term 1', null), t('L', 'Lectures', 'T'), t('W1', 'Week 1', 'L'),
  t('S', 'Slides', 'W1'), t('P', 'Past papers', null),
];
check('MAX_GROUP_DEPTH has a named default of 5', MAX_GROUP_DEPTH === 5, `${MAX_GROUP_DEPTH}`);
check('getChildGroups finds the root level',
  getChildGroups(tree, null).map((g) => g.id).join(',') === 'T,P');
check('getChildGroups finds one level down',
  getChildGroups(tree, 'L').map((g) => g.id).join(',') === 'W1');
check('getAncestors walks up nearest-first',
  getAncestors(tree, 'S').map((g) => g.id).join(',') === 'W1,L,T',
  getAncestors(tree, 'S').map((g) => g.id).join(','));
check('getDescendants walks down to any depth',
  getDescendants(tree, 'T').map((g) => g.id).sort().join(',') === 'L,S,W1',
  getDescendants(tree, 'T').map((g) => g.id).join(','));
check('getDescendants excludes the group itself',
  !getDescendants(tree, 'T').some((g) => g.id === 'T'));
check('depthOf counts from 1 at the root',
  depthOf(tree, 'T') === 1 && depthOf(tree, 'S') === 4,
  `${depthOf(tree, 'T')}, ${depthOf(tree, 'S')}`);
check('depthOf is 0 for an unknown group', depthOf(tree, 'nope') === 0);
check('pathOf renders the readable path',
  pathOf(tree, 'S') === 'Term 1 / Lectures / Week 1 / Slides', pathOf(tree, 'S'));
check('pathOf is empty for the root', pathOf(tree, null) === '');

check('wouldCreateCycle refuses a move into its own child',
  wouldCreateCycle(tree, 'T', 'W1'));
check('wouldCreateCycle refuses a move into a deeper descendant',
  wouldCreateCycle(tree, 'L', 'S'));
check('wouldCreateCycle refuses a self-move', wouldCreateCycle(tree, 'T', 'T'));
check('wouldCreateCycle allows a sibling branch', !wouldCreateCycle(tree, 'L', 'P'));
check('wouldCreateCycle allows the root', !wouldCreateCycle(tree, 'W1', null));

/* ============ 2. the tree builder ============ */
const counts = new Map([['T', 1], ['L', 2], ['W1', 3], ['S', 4], ['P', 5]]);
const built = buildGroupTree(tree, counts);
check('buildGroupTree is depth-first and ordered',
  built.map((n) => n.id).join(',') === 'T,L,W1,S,P', built.map((n) => n.id).join(','));
check('buildGroupTree reports each node depth', built.find((n) => n.id === 'S')?.depth === 4);
check('buildGroupTree counts DIRECT children only',
  built.find((n) => n.id === 'L')?.childGroupCount === 1);
check('buildGroupTree totals every descendant group',
  built.find((n) => n.id === 'T')?.totalDescendantGroups === 3);
check('buildGroupTree totals resources across the subtree',
  built.find((n) => n.id === 'T')?.totalResources === 1 + 2 + 3 + 4,
  `${built.find((n) => n.id === 'T')?.totalResources}`);
check('buildGroupTree keeps own resources separate from the total',
  built.find((n) => n.id === 'T')?.resourceCount === 1);
check('buildGroupTree gives each node its own path',
  built.find((n) => n.id === 'S')?.path === 'Term 1 / Lectures / Week 1 / Slides');
// Natural sorting only shows up when the stored `order` is EQUAL, because order
// is the primary sort key by design. With distinct orders the name comparison
// never runs, which is correct: a deliberate manual order must win.
const week = (id, name) => ({ id, name, parentGroupId: null, subjectId: 's1', order: 0 });
check('buildGroupTree sorts siblings NATURALLY, so Week 2 precedes Week 10',
  buildGroupTree(
    [week('a', 'Week 10'), week('b', 'Week 2'), week('c', 'Week 1')],
    new Map(),
  ).map((n) => n.name).join(',') === 'Week 1,Week 2,Week 10');
check('buildGroupTree honours the stored order first when orders differ',
  buildGroupTree(
    [week('a', 'Week 1'), { ...week('b', 'Week 10'), order: 5 }],
    new Map(),
  ).map((n) => n.name).join(',') === 'Week 1,Week 10');
check('buildGroupTree surfaces a group whose parent vanished',
  buildGroupTree([t('x', 'Orphan', 'gone')], new Map()).length === 1);

/* ============ 3. the placement rules ============ */
const v = (o) => validateGroupPlacement(o);
check('a legal placement passes',
  v({ groups: tree, subjectId: 's1', name: 'New', parentGroupId: 'L' }) === null);
check('a sibling name clash is refused',
  /already a group called/.test(v({ groups: tree, subjectId: 's1', name: 'lectures', parentGroupId: 'T' })?.message ?? ''));
check('the same name is FINE in a different parent',
  v({ groups: tree, subjectId: 's1', name: 'Lectures', parentGroupId: 'P' }) === null);
check('a group may keep its own name when renamed',
  v({ groups: tree, subjectId: 's1', name: 'Lectures', parentGroupId: 'T', selfId: 'L' }) === null);
check('a self-parent is refused with a clear message',
  /cannot be inside itself/.test(v({ groups: tree, subjectId: 's1', name: 'T', parentGroupId: 'T', selfId: 'T' })?.message ?? ''));
check('a cycle is refused with a clear message',
  /would create a loop/.test(v({ groups: tree, subjectId: 's1', name: 'T', parentGroupId: 'S', selfId: 'T' })?.message ?? ''));
check('a cross-subject parent is refused',
  v({ groups: [...tree, t('other', 'Other', null, 's2')], subjectId: 's1', name: 'X', parentGroupId: 'other' })?.field === 'subject');
check('an empty name is refused',
  v({ groups: tree, subjectId: 's1', name: '   ', parentGroupId: null })?.field === 'name');
check('a missing parent is refused',
  v({ groups: tree, subjectId: 's1', name: 'X', parentGroupId: 'ghost' })?.field === 'parent');

/* ============ 4. the depth limit ============ */
// A chain exactly MAX_GROUP_DEPTH deep, then one level beyond it.
const chain = [];
for (let i = 1; i <= MAX_GROUP_DEPTH; i += 1) {
  chain.push(t(`d${i}`, `Level ${i}`, i === 1 ? null : `d${i - 1}`));
}
check('the chain really sits at the limit',
  depthOf(chain, `d${MAX_GROUP_DEPTH}`) === MAX_GROUP_DEPTH);
check('a top-level group is allowed even when the tree is at the limit',
  v({ groups: chain, subjectId: 's1', name: 'Fresh top', parentGroupId: null }) === null);
const tooDeep = v({
  groups: chain, subjectId: 's1', name: 'One deeper', parentGroupId: `d${MAX_GROUP_DEPTH}`,
});
check('one level beyond the limit is refused', tooDeep?.field === 'depth');
check('the depth error names the limit AND the level reached',
  new RegExp(`at most ${MAX_GROUP_DEPTH} levels`).test(tooDeep?.message ?? '')
  && new RegExp(`level ${MAX_GROUP_DEPTH + 1}`).test(tooDeep?.message ?? ''),
  tooDeep?.message ?? '');
// Moving a whole SUBTREE must account for its height, not just its own level.
const tall = [t('A', 'A', null), t('B', 'B', 'A'), t('C', 'C', 'B'), t('D', 'D', 'C')];
const moveTooDeep = v({
  groups: [...chain, ...tall], subjectId: 's1',
  name: 'A', parentGroupId: `d${MAX_GROUP_DEPTH - 2}`, selfId: 'A',
});
check('moving a tall subtree deep is refused for its whole height',
  moveTooDeep?.field === 'depth', moveTooDeep?.message ?? 'allowed');

/* ============ 5. delete impact ============ */
const impMid = deleteImpact(tree, 'L', counts);
check('deleting a middle group counts the child groups that move up',
  impMid.childGroups === 2, `${impMid.childGroups}`);
check('...the resources that move up', impMid.resources === 2, `${impMid.resources}`);
check('...and the parent they move TO', impMid.newParentId === 'T');
const impTop = deleteImpact(tree, 'T', counts);
check('deleting a TOP-LEVEL group moves children to the subject root',
  impTop.newParentId === null && impTop.childGroups === 3,
  `${impTop.childGroups} -> ${impTop.newParentId}`);

/* ============ 6. valid move destinations ============ */
const dests = validGroupDestinations(tree, 'L');
check('the move destinations exclude the group itself',
  !dests.some((d) => d.id === 'L'));
check('...and every one of its descendants',
  !dests.some((d) => ['W1', 'S'].includes(d.id)));
check('...while the root and other branches remain',
  dests.some((d) => d.id === null) && dests.some((d) => d.id === 'P'));
check('destinations carry a path for the picker',
  dests.find((d) => d.id === 'P')?.path === 'Past papers');

/* ============ 7. the REAL repository enforces the rules ============ */
S().resourceGroups.clear();
const g = async (subjectId, name, parentGroupId = null) =>
  saveResourceGroup({ subjectId, name, parentGroupId });

const top = await g('s1', 'Term 1');
const lectures = await g('s1', 'Lectures', top);
const week1 = await g('s1', 'Week 1', lectures);
check('a group is created top-level when no parent is given',
  parentOf(S().resourceGroups.get(top)) === null);
check('a subgroup stores its parent', parentOf(S().resourceGroups.get(lectures)) === top);
check('nesting two deep works', depthOf(groupsOf('s1'), week1) === 3);

check('the repository refuses a sibling name clash',
  /already a group called/.test((await rejects(() => g('s1', 'lectures', top))) ?? ''));
check('the repository allows the same name in a different parent',
  typeof (await g('s1', 'lectures', week1)) === 'string');
check('the repository refuses a cycle (into a descendant)',
  /would create a loop/.test((await rejects(() => moveGroup(top, week1))) ?? ''));
check('the repository refuses a self-move',
  /cannot be inside itself/.test((await rejects(() => moveGroup(top, top))) ?? ''));
await moveGroup(week1, top);
check('a legal move is applied',
  parentOf(S().resourceGroups.get(week1)) === top);

const otherSubjectGroup = await g('s2', 'Physics top');
check('the repository refuses a cross-subject parent',
  /another subject/.test((await rejects(() => saveResourceGroup({
    subjectId: 's1', name: 'Nope', parentGroupId: otherSubjectGroup,
  }))) ?? ''));

S().resourceGroups.clear();
let last = null;
for (let i = 1; i <= MAX_GROUP_DEPTH; i += 1) last = await g('s1', `L${i}`, last);
check('the repository allows nesting exactly to the limit',
  depthOf(groupsOf('s1'), last) === MAX_GROUP_DEPTH);
check('the repository refuses one deeper',
  /at most/.test((await rejects(() => g('s1', 'Too deep', last))) ?? ''));

/* ============ 8. delete moves children AND resources UP one level ============ */
S().resourceGroups.clear();
const root = await g('s1', 'Root');
const mid = await g('s1', 'Mid', root);
const leaf = await g('s1', 'Leaf', mid);
const deepLeaf = await g('s1', 'DeepLeaf', leaf);
const sibling = await g('s1', 'Sibling', root);
await saveResource({ subjectId: 's1', topicId: 't1', kind: 'link', title: 'In mid', urlOrPath: 'u1', tags: [] });
const inMid = [...S().resources.values()].find((r) => r.title === 'In mid');
await moveResourceToGroup(inMid.id, mid);
check('a resource joined the nested group', S().resources.get(inMid.id).groupId === mid);

// The preview is given the subject's real resource counts, so it reports what
// the user would actually be told.
const impact = deleteImpact(groupsOf('s1'), mid, new Map([
  [mid, [...S().resources.values()].filter((r) => r.groupId === mid).length],
  [leaf, 0], [root, 0], [sibling, 0],
]));
check('the delete preview counts the child groups moving up',
  impact.childGroups === 2, `${impact.childGroups}`);
check('the delete preview counts the resources moving up',
  impact.resources === 1, `${impact.resources}`);

await deleteResourceGroup(mid);
check('only the group itself is deleted', !S().resourceGroups.has(mid));
check('its CHILD groups move up rather than being deleted',
  S().resourceGroups.has(leaf) && S().resourceGroups.has(deepLeaf));
check('...to the deleted group parent', parentOf(S().resourceGroups.get(leaf)) === root);
check('the grandchild keeps its own parent, just shifted',
  parentOf(S().resourceGroups.get(deepLeaf)) === leaf);
check('its RESOURCES move up too, not deleted',
  S().resources.has(inMid.id) && S().resources.get(inMid.id).groupId === root,
  S().resources.get(inMid.id)?.groupId);
check('a sibling group is untouched', parentOf(S().resourceGroups.get(sibling)) === root);

await deleteResourceGroup(root);
check('deleting a top-level group leaves its children at the root',
  parentOf(S().resourceGroups.get(leaf)) === null);
check('...and its resources ungrouped',
  S().resources.get(inMid.id).groupId === null);
check('...and still present', S().resources.has(inMid.id));

/* ============ 9. resources set and clear groupId ============ */
const holder = await g('s1', 'Holder');
await moveResourceToGroup(inMid.id, holder);
check('moving a resource into a group sets groupId',
  S().resources.get(inMid.id).groupId === holder);
await moveResourceToGroup(inMid.id, null);
check('moving a resource out clears groupId', S().resources.get(inMid.id).groupId === null);
await moveResourcesToGroup([inMid.id, 'r1'], holder);
check('a bulk move sets groupId on each',
  S().resources.get(inMid.id).groupId === holder && S().resources.get('r1').groupId === holder);
await g('s2', 'Elsewhere');
const elsewhere = [...S().resourceGroups.values()].find((x) => x.subjectId === 's2');
await moveResourceToGroup(inMid.id, elsewhere.id);
check('a cross-subject group is refused for the resource',
  S().resources.get(inMid.id).groupId === holder, S().resources.get(inMid.id).groupId);

/* ============ 10. a subject delete cascades through EVERY depth ============ */
S().resourceGroups.clear();
let deepest = null;
for (let i = 1; i <= 4; i += 1) deepest = await g('s1', `C${i}`, deepest);
await g('s2', 'Other subject group');
check('four levels exist before the delete', groupsOf('s1').length === 4);
await deleteSubjectCascade('s1');
check('deleting the subject removes EVERY group at every depth',
  groupsOf('s1').length === 0, `${groupsOf('s1').length} left`);
check('...and leaves other subjects alone', groupsOf('s2').length === 1);
// Recreate s1: the legacy checks below run against it, and a deleted subject
// would make every later group creation fail with "Subject not found".
S().subjects.set('s1', {
  id: 's1', name: 'Thermodynamics', color: '#6366f1', notes: '', createdAt: 'x', updatedAt: 'x',
});

/* ============ 11. legacy flat groups still load as top-level ============ */
S().resourceGroups.clear();
// Exactly the shape of a pre-v14 row: no parentGroupId key at all.
S().resourceGroups.set('legacy1', {
  id: 'legacy1', subjectId: 's1', name: 'Old folder', order: 0, createdAt: 'x',
});
S().resourceGroups.set('legacy2', {
  id: 'legacy2', subjectId: 's1', name: 'Another', order: 1, createdAt: 'x',
});
check('a legacy group with no parentGroupId reads as top-level',
  parentOf(S().resourceGroups.get('legacy1')) === null);
check('legacy groups appear at the root of the tree',
  buildGroupTree(groupsOf('s1'), new Map()).map((n) => n.name).join(',')
    === 'Old folder,Another');
check('legacy groups are still listed by the repo',
  (await listResourceGroups('s1')).length === 2);
await g('s1', 'Child of legacy', 'legacy1');
const child = [...S().resourceGroups.values()].find((x) => x.name === 'Child of legacy');
check('a new group can nest inside a legacy group', parentOf(child) === 'legacy1');
check('the mixed tree orders legacy and new groups together',
  buildGroupTree(groupsOf('s1'), new Map()).map((n) => n.name).join(',')
    === 'Old folder,Child of legacy,Another');

/* ============ 12. the schema change is additive and safe ============ */
const dbSrc = readFileSync('src/db/db.ts', 'utf8');
check('v14 exists', /this\.version\(14\)/.test(dbSrc));
check('v14 has an upgrade function',
  /this\.version\(14\)[\s\S]{0,600}?\.upgrade\(async/.test(dbSrc));
check('v14 keeps the string id primary key and the existing index set',
  /this\.version\(14\)[\s\S]{0,300}?resourceGroups: 'id, subjectId, order, createdAt'/.test(dbSrc));
check('v14 adds no new index (parentGroupId is unindexed, like v12/v13)',
  !/this\.version\(14\)[\s\S]{0,300}?resourceGroups: '[^']*parentGroupId/.test(dbSrc));
check('v14 never deletes a row', !/this\.version\(14\)[\s\S]{0,900}?\.delete\(/.test(dbSrc));
check('v14 only ever CLEARS an impossible parentGroupId',
  /parentGroupId: null/.test(dbSrc.split('this.version(14)')[1] ?? ''));
check('v14 is the latest version', !/this\.version\(1[5-9]\)/.test(dbSrc));
check('no table anywhere uses an autoincrement key', !/\+\+id/.test(dbSrc));
const typeSrc = readFileSync('src/types/index.ts', 'utf8');
check('parentGroupId is OPTIONAL on the type, so legacy rows still satisfy it',
  /parentGroupId\?: string \| null;/.test(typeSrc));

console.log(`\nnested-groups: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
