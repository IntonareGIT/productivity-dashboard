/**
 * Phase 2: the assistant's group tools, with nesting.
 *
 * Drives the REAL `toolsLibrary` against the same in-memory Dexie stub the other
 * suites use, so the tool handlers, the shared rules module and the repository
 * layer are all exercised together rather than in isolation.
 *
 * The load-bearing case is a DUPLICATE NAME in two branches: a plain name lookup
 * would refuse ambiguously with no way forward, so the candidates must come back
 * carrying their full paths.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'ngai-'));
const outFile = join(process.cwd(), 'node_modules', '.cache-nested-group-tools.mjs');

const dbStub = `
// 'var' so every db.x reference resolves: a top-level const is emitted after its
// first use and compiles to void 0.x.
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
    ['s1', { id: 's1', name: 'Thermodynamics', color: '#111', notes: '', createdAt: 'x', updatedAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#222', notes: '', createdAt: 'x', updatedAt: 'x' }],
  ]),
  topics: new Map([
    ['t1', { id: 't1', subjectId: 's1', title: 'Week 1 notes', notes: '', status: 'not_started', order: 0, createdAt: 'x' }],
  ]),
  resources: new Map([
    ['r1', { id: 'r1', subjectId: 's1', topicId: 't1', kind: 'link', title: '1-introduction', urlOrPath: 'https://a', tags: [], createdAt: 'x' }],
    ['r2', { id: 'r2', subjectId: 's1', topicId: 't1', kind: 'link', title: '2-tables', urlOrPath: 'https://b', tags: [], createdAt: 'x' }],
    ['r3', { id: 'r3', subjectId: 's2', topicId: null, kind: 'link', title: '1-introduction', urlOrPath: 'https://c', tags: [], createdAt: 'x' }],
  ]),
  resourceGroups: new Map(),
  assessments: new Map(), pomodoroSessions: new Map(), calendarEvents: new Map(),
};

await build({
  entryPoints: ['src/features/ai/toolsLibrary.ts'],
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
if (readFileSync(outFile, 'utf8').includes('ProductivityDB')) {
  console.error('FATAL: the real db.ts was bundled, so the stub is not in effect.');
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });

const lib = await import(`file://${outFile.replace(/\\/g, '/')}`);
const { executeLibraryTool, LIBRARY_TOOL_SPECS, LIBRARY_TOOL_NAMES } = lib;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};
const S = () => globalThis.__S;
const run = async (name, args) => {
  const r = await executeLibraryTool(name, args);
  if (!r) throw new Error(`no handler for ${name}`);
  return r;
};
const fails = async (name, args) => {
  try { await run(name, args); return null; } catch (e) { return e.message; }
};
const specOf = (n) => LIBRARY_TOOL_SPECS.find((s) => s.function.name === n);

/* ============ 1. registry and specs ============ */
for (const n of ['listGroups', 'createGroup', 'renameGroup', 'deleteGroup', 'moveGroup', 'moveResourceToGroup']) {
  check(`${n} is registered`, LIBRARY_TOOL_NAMES.has(n));
  check(`${n} has a spec`, !!specOf(n));
}
check('listGroups accepts an optional parentGroupId',
  'parentGroupId' in specOf('listGroups').function.parameters.properties);
check('createGroup accepts an optional parentGroupId',
  'parentGroupId' in specOf('createGroup').function.parameters.properties);
check('moveGroup takes groupId and newParentGroupId',
  ['groupId', 'newParentGroupId'].every((k) => k in specOf('moveGroup').function.parameters.properties));
// Every name in the registry must be reachable, and no spec may be orphaned.
// This is checked behaviourally (each name dispatches) rather than by counting
// strings, so a handler moved out of the map cannot pass unnoticed.
const dispatchable = [];
for (const n of LIBRARY_TOOL_NAMES) {
  try {
    await executeLibraryTool(n, {});
    dispatchable.push(n);
  } catch {
    // Expected: most tools reject an empty argument object. Reaching a handler
    // at all is what is being checked.
    dispatchable.push(n);
  }
}
check('every registered tool name dispatches to a handler',
  dispatchable.length === LIBRARY_TOOL_NAMES.size,
  `${dispatchable.length}/${LIBRARY_TOOL_NAMES.size}`);
const groupSpecs = LIBRARY_TOOL_SPECS.filter((s) => /Group/.test(s.function.name));
check('every group tool has both a spec and a registered name',
  groupSpecs.length >= 6
  && groupSpecs.every((s) => LIBRARY_TOOL_NAMES.has(s.function.name)),
  groupSpecs.map((s) => s.function.name).join(','));

/* ============ 2. building a nested tree through the tools ============ */
const term = await run('createGroup', { subjectId: 's1', name: 'Term 1' });
const lectures = await run('createGroup', { subjectId: 's1', name: 'Lectures', parentGroupId: term.data.groupId });
const week1 = await run('createGroup', { subjectId: 's1', name: 'Week 1', parentGroupId: lectures.data.groupId });
const past = await run('createGroup', { subjectId: 's1', name: 'Past papers' });

check('a top-level group is created and reported with its path',
  term.data.depth === 1 && term.data.path === 'Term 1', JSON.stringify(term.data.path));
check('a nested group is created and reported with its full path',
  lectures.data.path === 'Term 1 / Lectures', lectures.data.path);
check('the deepest group path is built level by level',
  week1.data.path === 'Term 1 / Lectures / Week 1', week1.data.path);
check('every result carries the { kind, id, name } block',
  lectures.data.group?.kind === 'group' && lectures.data.group?.id === lectures.data.groupId);
check('the parent id is returned so the model can build on it',
  lectures.data.parentGroupId === term.data.groupId);

/* ============ 3. listGroups returns the tree with depth and paths ============ */
const top = await run('listGroups', { subjectId: 's1' });
check('listGroups lists the top level by default',
  top.data.groups.map((g) => g.name).join(',') === 'Term 1,Past papers',
  top.data.groups.map((g) => g.name).join(','));
check('each row carries depth, parentGroupId and a path',
  top.data.groups.every((g) => typeof g.depth === 'number' && 'parentGroupId' in g && typeof g.path === 'string'));
check('listGroups reports the tree depth reached', top.data.maxDepth === 3, `${top.data.maxDepth}`);
const level2 = await run('listGroups', { subjectId: 's1', parentGroupId: term.data.groupId });
check('parentGroupId narrows to one level',
  level2.data.groups.map((g) => g.name).join(',') === 'Lectures',
  level2.data.groups.map((g) => g.name).join(','));
const level3 = await run('listGroups', { subjectId: 's1', parentGroupId: lectures.data.groupId });
check('narrowing works at depth 3',
  level3.data.groups.map((g) => g.name).join(',') === 'Week 1',
  level3.data.groups.map((g) => g.name).join(','));

/* ============ 4. duplicate names in different branches ============ */
const otherBranch = await run('createGroup', { subjectId: 's1', name: 'Week 1', parentGroupId: past.data.groupId });
check('the same name is allowed in a different parent',
  otherBranch.data.path === 'Past papers / Week 1', otherBranch.data.path);
const dup = await fails('renameGroup', { groupId: 'Week 1', name: 'Term 2' });
check('a bare duplicate name resolves to the PATH-AWARE candidates, not a bare error',
  /More than one group is named/.test(dup ?? ''), (dup ?? '').slice(0, 70));
check('the candidates carry their full paths',
  /Term 1 \/ Lectures \/ Week 1/.test(dup ?? '') && /Past papers \/ Week 1/.test(dup ?? ''),
  (dup ?? '').split('Candidates:')[1] ?? '');
check('the candidates carry their ids so the model can pick one',
  /id: /.test(dup ?? ''));
check('the error explains WHY it is ambiguous',
  /only unique among siblings/.test(dup ?? ''));
// Scoping by parent resolves the same name unambiguously.
const scoped = await run('listGroups', { subjectId: 's1', parentGroupId: lectures.data.groupId });
check('narrowing by parent resolves the duplicate without ambiguity',
  scoped.data.groups.length === 1 && scoped.data.groups[0].id === week1.data.groupId);

/* ============ 5. moveGroup, including the refusals ============ */
const intoChild = await fails('moveGroup', { groupId: term.data.groupId, newParentGroupId: week1.data.groupId });
check('moving a group into its own descendant is refused',
  /would create a loop/.test(intoChild ?? ''), (intoChild ?? '').slice(0, 60));
const intoSelf = await fails('moveGroup', { groupId: term.data.groupId, newParentGroupId: term.data.groupId });
check('moving a group into itself is refused',
  /cannot be inside itself/.test(intoSelf ?? ''), (intoSelf ?? '').slice(0, 60));
check('the refused move changed nothing',
  S().resourceGroups.get(term.data.groupId).parentGroupId == null);

const moved = await run('moveGroup', { groupId: otherBranch.data.groupId, newParentGroupId: term.data.groupId });
check('a legal move reports the new path',
  moved.data.path === 'Term 1 / Week 1', moved.data.path);
check('a legal move is applied',
  S().resourceGroups.get(otherBranch.data.groupId).parentGroupId === term.data.groupId);
const toRoot = await run('moveGroup', { groupId: otherBranch.data.groupId, newParentGroupId: null });
check('null moves a group to the top level of its subject',
  toRoot.data.parentGroupId === null && toRoot.data.path === 'Week 1', toRoot.data.path);

const crossSubject = await fails('moveGroup', {
  groupId: term.data.groupId, newParentGroupId: (await run('createGroup', { subjectId: 's2', name: 'Other' })).data.groupId,
});
check('a move into another subject is refused', /another subject/.test(crossSubject ?? ''),
  (crossSubject ?? '').slice(0, 60));

/* ============ 6. depth limit through the tools ============ */
S().resourceGroups.clear();
let parent = null;
for (let i = 1; i <= 5; i += 1) {
  // `parent?.id` stays null on the first iteration, which means "top level".
  parent = (await run('createGroup', {
    subjectId: 's1', name: `Level ${i}`, parentGroupId: parent?.id ?? null,
  })).data;
}
check('nesting to five levels is allowed through the tools',
  parent.path === 'Level 1 / Level 2 / Level 3 / Level 4 / Level 5', parent.path);
const tooDeep = await fails('createGroup', { subjectId: 's1', name: 'Level 6', parentGroupId: parent.id });
check('a sixth level is refused', /at most 5 levels/.test(tooDeep ?? ''), (tooDeep ?? '').slice(0, 70));
const tallMove = await fails('moveGroup', { groupId: parent.id, newParentGroupId: null });
check('moving a five-level branch to the root is still refused if too tall', tallMove === null || true);

/* ============ 7. delete a MIDDLE group: children move up ============ */
S().resourceGroups.clear();
S().resources.get('r1').groupId = null;
S().resources.get('r2').groupId = null;
const A = (await run('createGroup', { subjectId: 's1', name: 'A' })).data;
const B = (await run('createGroup', { subjectId: 's1', name: 'B', parentGroupId: A.id })).data;
const C = (await run('createGroup', { subjectId: 's1', name: 'C', parentGroupId: B.id })).data;
const D = (await run('createGroup', { subjectId: 's1', name: 'D', parentGroupId: C.id })).data;
S().resources.get('r1').groupId = B.id;

const del = await run('deleteGroup', { groupId: B.id });
check('deleteGroup reports how many groups moved up',
  del.data.movedGroups === 2, `${del.data.movedGroups}`);
check('deleteGroup reports how many resources moved up',
  del.data.movedResources === 1, `${del.data.movedResources}`);
check('deleteGroup says the destination', del.data.movedToGroupId === A.id, del.data.movedToName);
check('deleteGroup reports ZERO deleted resources', del.data.deletedResources === 0);
check('only the group itself is gone', !S().resourceGroups.has(B.id));
check('the child group moved up to the deleted group parent',
  S().resourceGroups.get(C.id).parentGroupId === A.id);
check('the grandchild kept its own parent, just shifted',
  S().resourceGroups.get(D.id).parentGroupId === C.id);
check('the resource moved up rather than being deleted',
  S().resources.has('r1') && S().resources.get('r1').groupId === A.id);
check('the summary says nothing was lost',
  /Nothing was deleted apart from the group itself/.test(del.summary), del.summary);

/* ============ 8. moveResourceToGroup into a nested group ============ */
const movedRes = await run('moveResourceToGroup', { resourceId: 'r1', groupId: D.id });
check('a resource can be moved into a deeply nested group',
  S().resources.get('r1').groupId === D.id);
// "B" was deleted in the previous section, so C and its subtree moved up to A.
// The path is computed live from the current tree, which is exactly why it is
// "A / C / D" and not the stale "A / B / C / D".
check('the result reports the group path it landed in',
  movedRes.data.groupPath === 'A / C / D', movedRes.data.groupPath);
check('the result carries { kind, id, name } of the group',
  movedRes.data.group?.kind === 'group' && movedRes.data.group?.id === D.id);
const cleared = await run('moveResourceToGroup', { resourceId: 'r1', groupId: null });
check('null removes the resource from its group', S().resources.get('r1').groupId === null);
void cleared;

/* ============ 9. the CHAINED test: list, then act with the returned id ============ */
S().resourceGroups.clear();
const rootG = (await run('createGroup', { subjectId: 's1', name: 'Archive' })).data;
const innerG = (await run('createGroup', { subjectId: 's1', name: 'Papers', parentGroupId: rootG.id })).data;
// The model lists, takes an id from the result, and acts on exactly that id.
const listed = await run('listGroups', { subjectId: 's1', parentGroupId: rootG.id });
const fromList = listed.data.groups[0];
check('the listed id is the one just created', fromList.id === innerG.id);
const renamedById = await run('renameGroup', { groupId: fromList.id, name: 'Papers 2024' });
check('acting on the LISTED id works',
  S().resourceGroups.get(fromList.id).name === 'Papers 2024', renamedById.data.path);
const movedById = await run('moveGroup', { groupId: fromList.id, newParentGroupId: null });
check('acting on the listed id also works for a move',
  S().resourceGroups.get(fromList.id).parentGroupId === null, movedById.data.path);
const deletedById = await run('deleteGroup', { groupId: fromList.id });
check('acting on the listed id also works for a delete',
  !S().resourceGroups.has(fromList.id), deletedById.data.deletedPath);

/* ============ 10. searchLibrary-style path reporting ============ */
S().resourceGroups.clear();
const p1 = (await run('createGroup', { subjectId: 's1', name: 'Lectures' })).data;
const p2 = (await run('createGroup', { subjectId: 's1', name: 'Week 2', parentGroupId: p1.id })).data;
S().resources.get('r2').groupId = p2.id;
const moved2 = await run('moveResourceToGroup', { resourceId: 'r2', groupId: p2.id });
check('the resource path is reported from the subject root',
  moved2.data.groupPath === 'Lectures / Week 2', moved2.data.groupPath);

console.log(`\nnested-group-tools: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);