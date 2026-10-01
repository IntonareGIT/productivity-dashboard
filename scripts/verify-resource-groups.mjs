/**
 * Resource-group verification (v10).
 *
 * Groups are a lane over resources inside a subject. The rules that matter, and
 * that this exercises against the REAL repository functions:
 *
 *   - a group belongs to exactly one subject
 *   - only same-subject resources can join it
 *   - a resource is in at most one group, or none
 *   - deleting a group ungroups its members and NEVER deletes them
 *   - moving a resource to another subject clears its groupId
 *   - a subject delete removes its groups
 *   - existing resources load still ungrouped
 *
 * The repo is bundled against the same in-memory Dexie stub the other verify
 * scripts use, so the real code paths run rather than a re-implementation.
 * Not covered: IndexedDB upgrade transactions (no `fake-indexeddb` dependency) —
 * the v10 upgrade body is asserted by shape in verify-app-invariants.mjs.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'groups-'));
const outFile = join(outDir, 'repo.mjs');

const dbStub = `
const S = globalThis.__S;
const col = (name) => {
  const m = () => Array.from(S[name].values());  return {
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
// The real Dexie transaction wrapper. These repo functions only need it to
// group their writes, so run the body inline against the same maps.
const _db = new Proxy({}, {
  get(_t, name) {
    if (name === 'transaction') {
      return async (..._args) => {
        const body = _args[_args.length - 1];
        return body();
      };
    }
    return col(String(name));
  },
});
export const db = _db;
`;

// An in-memory table set. `resources` starts with two legacy rows that have NO
// groupId at all — the "existing data" this migration must leave alone.
globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Algorithms', color: '#6366f1', notes: '', createdAt: 'x', updatedAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#22c55e', notes: '', createdAt: 'x', updatedAt: 'x' }],
  ]),
  topics: new Map([
    ['t1', { id: 't1', subjectId: 's1', title: 'Graphs', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
  ]),
  resources: new Map([
    ['r1', { id: 'r1', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Legacy A', urlOrPath: 'https://a', tags: [], createdAt: 'x' }],
    ['r2', { id: 'r2', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Legacy B', urlOrPath: 'https://b', tags: [], createdAt: 'x' }],
  ]),
  resourceGroups: new Map(),
  assessments: new Map(),
  pomodoroSessions: new Map(),
  calendarEvents: new Map(),
};

await build({
  entryPoints: ['src/features/library/libraryRepo.ts'],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  define: { 'import.meta.url': '"file:///stub"' },
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

const repo = await import(`file://${outFile.replace(/\\/g, '/')}`);
const {
  saveResourceGroup, renameResourceGroup, reorderResourceGroups, deleteResourceGroup,
  moveResourceToGroup, moveResourcesToGroup, listResourceGroups, saveResource,
  deleteSubjectCascade,
} = repo;
const S = globalThis.__S;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// ---------------------------------------------- existing data stays ungrouped
check('existing resource r1 loads with no group', S.resources.get('r1').groupId === undefined, String(S.resources.get('r1').groupId));
check('existing resource r2 loads with no group', S.resources.get('r2').groupId === undefined);
check('existing resource content untouched', S.resources.get('r1').title === 'Legacy A' && S.resources.get('r1').urlOrPath === 'https://a');

// -------------------------------------------------------------- create/rename
const g1 = await saveResourceGroup({ subjectId: 's1', name: 'Past papers' });
const g2 = await saveResourceGroup({ subjectId: 's1', name: 'Lecture slides' });
const gOther = await saveResourceGroup({ subjectId: 's2', name: 'Physics extras' });
check('a group is created', S.resourceGroups.get(g1).name === 'Past papers');
check('a group belongs to its subject', S.resourceGroups.get(g1).subjectId === 's1');
check('order is assigned in creation order', S.resourceGroups.get(g1).order === 0 && S.resourceGroups.get(g2).order === 1, `${S.resourceGroups.get(g1).order}/${S.resourceGroups.get(g2).order}`);
check('a blank group name is rejected', await saveResourceGroup({ subjectId: 's1', name: '   ' }).then(() => false, () => true));
check('a group for a missing subject is rejected', await saveResourceGroup({ subjectId: 'nope', name: 'x' }).then(() => false, () => true));

await renameResourceGroup(g1, '  Past papers 2024  ');
check('rename trims and saves', S.resourceGroups.get(g1).name === 'Past papers 2024', S.resourceGroups.get(g1).name);
await renameResourceGroup(g1, '   ');
check('rename to blank is ignored', S.resourceGroups.get(g1).name === 'Past papers 2024');
await renameResourceGroup(g1, 'Past papers');
check('rename back works', S.resourceGroups.get(g1).name === 'Past papers');

await reorderResourceGroups('s1', [g2, g1]);
check('reorder persists', S.resourceGroups.get(g2).order === 0 && S.resourceGroups.get(g1).order === 1);
await reorderResourceGroups('s1', [g1, g2]);
check('reorder back persists', S.resourceGroups.get(g1).order === 0 && S.resourceGroups.get(g2).order === 1);
await reorderResourceGroups('s1', [g1, g2, gOther]);
check('reorder cannot touch another subject', S.resourceGroups.get(gOther).order === 0, String(S.resourceGroups.get(gOther).order));

// ------------------------------------------------------- at most one group
await moveResourceToGroup('r1', g1);
check('resource joins a group', S.resources.get('r1').groupId === g1);
await moveResourceToGroup('r1', g2);
check('a second move replaces the first (at most one group)', S.resources.get('r1').groupId === g2, String(S.resources.get('r1').groupId));
check('a resource not moved stays ungrouped', S.resources.get('r2').groupId === undefined);

// ------------------------------------------------- the cross-subject invariant
await moveResourceToGroup('r1', gOther);
check("a resource cannot join another subject's group", S.resources.get('r1').groupId === g2, String(S.resources.get('r1').groupId));
await moveResourceToGroup('r1', 'does-not-exist');
check('a missing group id is rejected', S.resources.get('r1').groupId === g2);
await moveResourceToGroup('nope', g1);
check('moving a missing resource is a no-op', !S.resources.has('nope'));

await moveResourceToGroup('r1', null);
check('"No group" clears the groupId', S.resources.get('r1').groupId === null, String(S.resources.get('r1').groupId));
await moveResourceToGroup('r1', g1);

// ------------------------------------------------------- bulk move (bonus)
await moveResourcesToGroup(['r1', 'r2'], g2);
check('bulk move groups both', S.resources.get('r1').groupId === g2 && S.resources.get('r2').groupId === g2);
await moveResourcesToGroup(['r1', 'r2'], gOther);
check('bulk move skips cross-subject targets', S.resources.get('r1').groupId === g2 && S.resources.get('r2').groupId === g2);
await moveResourcesToGroup(['r1', 'r2'], null);
check('bulk move to "No group" clears both', S.resources.get('r1').groupId === null && S.resources.get('r2').groupId === null);
await moveResourcesToGroup([], g1);
check('bulk move of nothing is a no-op', S.resourceGroups.size === 3);

// -------------------- delete ungroups members but never deletes them
await moveResourcesToGroup(['r1', 'r2'], g1);
const beforeCount = S.resources.size;
await deleteResourceGroup(g1);
check('the group is gone', !S.resourceGroups.has(g1));
check('NO member resource was deleted', S.resources.size === beforeCount, `${S.resources.size} of ${beforeCount}`);
check('members are ungrouped, not removed', S.resources.has('r1') && S.resources.get('r1').groupId === null);
check('ungrouping kept the resource content', S.resources.get('r1').title === 'Legacy A' && S.resources.get('r1').urlOrPath === 'https://a');

// ------------------------------------------- moving subject clears the groupId
await moveResourceToGroup('r2', g2);
check('r2 is grouped again to set up the test', S.resources.get('r2').groupId === g2);
await saveResource({ id: 'r2', subjectId: 's2', topicId: null, kind: 'link', title: 'Legacy B', urlOrPath: 'https://b' });
check('moving a resource to another subject clears its groupId', S.resources.get('r2').groupId === null, String(S.resources.get('r2').groupId));

// A group id that is not in the subject is ignored at creation time.
await saveResource({ subjectId: 's1', topicId: 't1', kind: 'link', title: 'New one', urlOrPath: 'https://c', groupId: gOther });
const created = [...S.resources.values()].find((r) => r.title === 'New one');
check('a new resource cannot be born into a foreign group', created.groupId === null, String(created.groupId));
await saveResource({ subjectId: 's1', topicId: 't1', kind: 'link', title: 'New two', urlOrPath: 'https://d', groupId: g2 });
const created2 = [...S.resources.values()].find((r) => r.title === 'New two');
check('a new resource can be created into a valid group', created2.groupId === g2, String(created2.groupId));

// ---------------------------------------------------- subject delete cascades
await deleteSubjectCascade('s1');
check('deleting a subject deletes its groups', ![...S.resourceGroups.values()].some((g) => g.subjectId === 's1'));
check('deleting a subject deletes its resources', ![...S.resources.values()].some((r) => r.subjectId === 's1'));
check("another subject's groups survive", S.resourceGroups.has(gOther));
check("another subject's resources survive", [...S.resources.values()].some((r) => r.subjectId === 's2'));
check('no resource is left pointing at a deleted group',
  ![...S.resources.values()].some((r) => r.groupId && !S.resourceGroups.has(r.groupId)));

// -------------------------------------------------------------- listing order
const listed = await listResourceGroups('s2');
check('listResourceGroups is scoped to one subject', listed.length === 1 && listed[0].id === gOther, JSON.stringify(listed.map((g) => g.name)));

// --------------------------------------------------------- schema and syncing
const dbSrc = readFileSync('src/db/db.ts', 'utf8');
const cloudSrc = readFileSync('src/db/cloudConfig.ts', 'utf8');
check('schema: the resource-group store is still declared at v10 and still present',
  /this\.version\(10\)[\s\S]{0,120}?resourceGroups: 'id, subjectId, order, createdAt'/.test(dbSrc));
check('schema: resourceGroups table is declared', /resourceGroups: 'id, subjectId, order, createdAt'/.test(dbSrc));
check('schema: groupId is indexed on resources', /resources: '[^']*\bgroupId\b[^']*'/.test(dbSrc));
check('schema: the resources primary key is unchanged', /resources: 'id,/.test(dbSrc));
check('schema: v10 has an upgrade()', /this\.version\(10\)[\s\S]*?\.upgrade\(async/.test(dbSrc));
check('schema: additive only — v10 does not restate other tables', /this\.version\(10\)[\s\S]*?\.stores\(\{[\s\S]*?\}\)/.test(dbSrc) && !/version\(10\)[\s\S]{0,220}?subjects:/.test(dbSrc));
check('backup: the new table is exported', /resourceGroups/.test(readFileSync('src/db/backup.ts', 'utf8')));
// Groups are metadata, so they sync: the table must NOT be excluded.
check('cloud: resourceGroups is not excluded from sync', !/resourceGroups/.test(cloudSrc));
check('cloud: blob mode unchanged (still lazy)', /BLOB_MODE = 'lazy'/.test(cloudSrc));

// ------------------------------------------------------------ UI and the AI
const detail = readFileSync('src/features/library/components/SubjectDetail.tsx', 'utf8');
const menu = readFileSync('src/features/library/components/MoveToGroupMenu.tsx', 'utf8');
// The group markup moved into GroupTree.tsx when nesting landed, so the UI
// assertions read the file that actually renders the tree. The properties being
// protected (collapsible, per-group rename/delete, no nested buttons) are
// unchanged; only their location moved.
const tree = readFileSync('src/features/library/components/GroupTree.tsx', 'utf8');
const tools = readFileSync('src/features/ai/tools.ts', 'utf8');
check('UI: "New group" button is rendered', /<NewGroupButton/.test(detail));
check('UI: groups are collapsible',
  /toggleGroupCollapsed/.test(detail) && /aria-expanded/.test(tree));
  // Phase 1 routed these through `renameGroup` / `removeGroup` wrappers that
  // await the write and surface a failure, so assert the handlers now wired
  // rather than the old direct repository calls. The tree calls them with the
  // node id and name.
  check('UI: rename and delete are per group',
  /onCommitRename\(node\.id, name\)/.test(tree) && /onDeleteGroup\(node\.id, node\.name\)/.test(tree));
check('UI: a "Move to group" control is on each resource row', /<MoveToGroupMenu/.test(detail));
check('UI: the move menu offers "No group"', />\s*No group\s*</.test(menu));
check('UI: the move menu offers "New group…"', /New group…/.test(menu));
check('UI: the move menu is tap-driven, not drag-only', /onClick/.test(menu) && !/onDrag|draggable/.test(menu));
check('UI: menu rows meet the 40px touch target', /min-h-\[40px\]/.test(menu));
check('UI: the menu closes on outside tap and Escape', /pointerdown/.test(menu) && /Escape/.test(menu));
check('UI: the move menu shows nested groups as an indented tree',
  /buildGroupTree/.test(menu) && /data-depth/.test(menu));
// A nested control is <button ...> ... <button inside it. Siblings look like
// </button><button>, so the check is for a <button BETWEEN the aria-expanded
// button's own open and close tags.
// Start just before the collapse <button so the tag count is balanced. The
// block now ends at the rename editor, which is the first thing after the
// header controls.
const headerBlock = tree.slice(
  tree.lastIndexOf('<button', tree.indexOf('aria-expanded')),
  tree.indexOf('{renamingGroupId === node.id'),
);
// Five controls now: collapse, new subgroup, move, rename, delete.
check('UI: the group header controls are sibling controls',
  (headerBlock.match(/<button/g) ?? []).length === 5
  && (headerBlock.match(/<\/button>/g) ?? []).length === 5,
  `${(headerBlock.match(/<button/g) ?? []).length} open / ${(headerBlock.match(/<\/button>/g) ?? []).length} close`);
const collapseBtn = tree.slice(
  tree.lastIndexOf('<button', tree.indexOf('aria-expanded')),
  tree.indexOf('</button>', tree.indexOf('aria-expanded')) + '</button>'.length,
);
// Skip the opening tag itself when looking for a nested control.
const collapseInner = collapseBtn.slice(collapseBtn.indexOf('>') + 1, collapseBtn.lastIndexOf('</button>'));
check('UI: the group header is not a button inside a button', !/<button/.test(collapseInner), collapseInner.replace(/\s+/g, ' ').trim().slice(0, 60));
check('AI: searchLibrary reads the group table', /db\.resourceGroups\.toArray\(\)/.test(tools));
check('AI: results carry the group name', /group: \(r\.groupId \? groupName\.get\(r\.groupId\)/.test(tools));
check('AI: a resource also matches on its group name', /\(group \?\? ''\)\.toLowerCase\(\)\.includes\(q\)/.test(tools));

console.log(`\nresource-groups: ${pass} passed, ${fail} failed`);
rmSync(outDir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

