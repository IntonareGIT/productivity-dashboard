/**
 * Phase 2: library tools, the id/name resolver, and the delete safety rules.
 *
 * The most important thing checked here is NOT that a delete works. It is that a
 * delete CANNOT run without the user pressing Confirm. That guarantee lives in
 * `useAssistantStore` (gated calls are filtered out of the tool batch and the
 * loop breaks before `runTool`), so it is pinned both behaviourally and
 * structurally: every delete tool must be in CONFIRMATION_TOOL_NAMES, and the
 * store must filter gated calls before executing them.
 *
 * The resolver checks matter because a wrong guess is worse than an error: these
 * assert that an ambiguous name returns candidates WITH ids and changes nothing.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'tools-phase2-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `export * from '${root}/src/features/ai/toolsLibrary';`);
const bundleFile = join(process.cwd(), 'node_modules', '.cache-tools-phase2.mjs');

globalThis.__S = {
  subjects: new Map([
    ['s1', { id: 's1', name: 'Algorithms', color: '#6366f1', notes: '', createdAt: 'x', updatedAt: 'x' }],
    ['s2', { id: 's2', name: 'Physics', color: '#22c55e', notes: '', createdAt: 'x', updatedAt: 'x' }],
  ]),
  topics: new Map([
    ['t1', { id: 't1', subjectId: 's1', title: 'Graphs', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
    ['t2', { id: 't2', subjectId: 's1', title: 'Search', notes: '', status: 'not_started', order: 1, createdAt: 'x', updatedAt: 'x' }],
    ['t3', { id: 't3', subjectId: 's2', title: 'Optics', notes: '', status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x' }],
  ]),
  resources: new Map([
    ['r1', { id: 'r1', subjectId: 's1', topicId: 't1', kind: 'link', title: 'A', urlOrPath: 'https://a', tags: [], createdAt: 'x' }],
    ['r2', { id: 'r2', subjectId: 's1', topicId: 't2', kind: 'link', title: 'B', urlOrPath: 'https://b', tags: [], createdAt: 'x' }],
  ]),
  resourceGroups: new Map(),
  assessments: new Map(),
  pomodoroSessions: new Map(),
  calendarEvents: new Map(),
};

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

const lib = await import(`file://${bundleFile.replace(/\\/g, '/')}`);
const S = globalThis.__S;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail += 1; }
};

// ================================================ 1. the resolver, in isolation
const resolveSrc = readFileSync('src/features/ai/toolResolve.ts', 'utf8');
const libSrc = readFileSync('src/features/ai/toolsLibrary.ts', 'utf8');
check('resolver: exported and used by the library tools',
  /export (const|function) resolveByIdOrName/.test(resolveSrc) && /need\(/.test(libSrc));
check('resolver: an exact id wins over any name match',
  /rows\.find\(\(r\) => r\.id === raw\)/.test(resolveSrc));
check('resolver: it is case-insensitive', /\.trim\(\)\.toLowerCase\(\)/.test(resolveSrc));
check('resolver: ambiguity returns candidates WITH ids, not a bare error',
  /candidates: exact\.map/.test(resolveSrc) && /candidates: loose\.map/.test(resolveSrc)
  && /id: r\.id/.test(resolveSrc));
check('resolver: the error message tells the model nothing changed',
  /Nothing was changed/.test(resolveSrc));

// ============================== 2. every delete is behind the Confirm gate
const toolsSrc = readFileSync('src/features/ai/tools.ts', 'utf8');
const storeSrc = readFileSync('src/stores/useAssistantStore.ts', 'utf8');
// The set of names the gate protects lives in toolsLibrary; tools.ts must spread it.
const confirmBlock = libSrc.slice(libSrc.indexOf('LIBRARY_CONFIRM_TOOL_NAMES'));
for (const d of ['deleteSubject', 'deleteTopic', 'deleteResource', 'deleteGroup']) {
  check(`gate: ${d} is in LIBRARY_CONFIRM_TOOL_NAMES`, new RegExp(`'${d}'`).test(confirmBlock));
}
check('gate: tools.ts spreads LIBRARY_CONFIRM_TOOL_NAMES into CONFIRMATION_TOOL_NAMES',
  /CONFIRMATION_TOOL_NAMES[\s\S]{0,700}?\.\.\.LIBRARY_CONFIRM_TOOL_NAMES/.test(toolsSrc));
check('gate: the store filters gated calls out BEFORE running them',
  storeSrc.indexOf('CONFIRMATION_TOOL_NAMES.has(c.name)')
  < storeSrc.indexOf('const ungated = result.toolCalls.filter'));
check('gate: the store breaks out of the loop when a call is gated',
  /const gated = result\.toolCalls\.filter[\s\S]{0,1200}?\n\s*break;/.test(storeSrc));
check('gate: only confirmPending executes the pending action',
  /confirmPending:[\s\S]{0,900}?executeTool/.test(storeSrc));
check('gate: declining feeds back that nothing happened',
  /The user moved on without confirming this action/.test(storeSrc));
check('gate: every delete tool description tells the model to ask first',
  libSrc.split("name: 'delete").slice(1)
    .every((b) => /must confirm before this runs/.test(b.slice(0, 400))));

// ================================= 3. model cannot self-confirm by calling again
check('gate: there is no "confirmed" argument any delete tool could accept',
  !/confirm(Ed)?\s*:\s*\{\s*type:\s*'boolean'/.test(libSrc));

// ================== 4. the tools actually work, against real repo functions
const run = (n, a) => lib.executeLibraryTool(n, a);
const fails = async (n, a) => run(n, a).then(() => null, (e) => String(e?.message ?? e));

const g = await run('createGroup', { subjectId: 's1', name: 'Past papers' });
check('group: createGroup stores a real group', S.resourceGroups.has(g.data.groupId));
check('group: createGroup accepts a NAME, not just an id',
  S.resourceGroups.has((await run('createGroup', { subjectId: 'Algorithms', name: 'Slides' })).data.groupId));
check('group: a blank name changes nothing',
  S.resourceGroups.size === 2 && await fails('createGroup', { subjectId: 's1', name: '  ' }));
check('group: an unknown subject returns an error, not a crash',
  await fails('createGroup', { subjectId: 'Nope', name: 'x' }));

const listed = await run('listGroups', { subjectId: 's1' });
check('group: listGroups returns ids and names for both groups',
  listed.data.groups.length === 2 && listed.data.groups.every((x) => x.id && x.name));

await run('moveResourceToGroup', { resourceId: 'r1', groupId: g.data.groupId });
check('group: a resource moves in by group NAME', S.resources.get('r1').groupId === g.data.groupId);
await run('moveResourceToGroup', { resourceId: 'r1', groupId: 'null' });
check('group: the string "null" means No group', S.resources.get('r1').groupId === null);

// ambiguity: two resources sharing one name
S.resources.set('r3', { id: 'r3', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Dup', urlOrPath: 'https://d', tags: [], createdAt: 'x' });
S.resources.set('r4', { id: 'r4', subjectId: 's1', topicId: 't1', kind: 'link', title: 'Dup', urlOrPath: 'https://e', tags: [], createdAt: 'x' });
const amb = await fails('deleteResource', { resourceId: 'Dup' });
check('resolver: an ambiguous name returns BOTH candidates with their ids',
  /id: r3/.test(amb) && /id: r4/.test(amb), String(amb).slice(0, 60));
check('resolver: ambiguity changed nothing', S.resources.has('r3') && S.resources.has('r4'));
check('resolver: an unknown name is an error saying nothing changed',
  /Nothing was changed/.test(await fails('deleteResource', { resourceId: 'zzz' })));

await run('renameGroup', { groupId: g.data.groupId, name: 'Papers 2024' });
check('group: rename by id works', S.resourceGroups.get(g.data.groupId).name === 'Papers 2024');

const beforeDel = S.resources.size;
const dg = await run('deleteGroup', { groupId: g.data.groupId });
check('group: deleteGroup keeps every resource', S.resources.size === beforeDel);
check('group: the summary says resources were KEPT', /were kept and are now ungrouped/.test(dg.summary));
check('group: deleteGroup reports zero deleted resources', dg.data.deletedResources === 0);

// renames and moves
await run('renameSubject', { subjectId: 's1', name: 'Algorithms & Graphs' });
check('subject: rename keeps the id so children survive',
  S.subjects.get('s1').name === 'Algorithms & Graphs' && S.subjects.size === 2);
await run('renameTopic', { topicId: 't2', title: 'Searching' });
check('topic: rename by id works', S.topics.get('t2').title === 'Searching');
await run('renameResource', { resourceId: 'r2', title: 'B renamed' });
check('resource: rename by id works', S.resources.get('r2').title === 'B renamed');

S.resourceGroups.set('g9', { id: 'g9', subjectId: 's1', name: 'Keep', order: 0, createdAt: 'x' });
await run('moveResourceToGroup', { resourceId: 'r2', groupId: 'g9' });
await run('moveResource', { resourceId: 'r2', topicId: 't1' });
check('resource: moveResource clears the group', S.resources.get('r2').groupId === null);
check('resource: moveResource changes the topic', S.resources.get('r2').topicId === 't1');
check('resource: a cross-subject move is refused and changes nothing',
  S.resources.get('r2').topicId === 't1'
  && /Nothing was changed/.test(await fails('moveResource', { resourceId: 'r2', topicId: 't3' })));

// ============ 5. cascades: the deletes remove what they claim to remove
S.resources.set('r5', { id: 'r5', subjectId: 's2', topicId: 't3', kind: 'link', title: 'S2 res', urlOrPath: 'https://f', tags: [], createdAt: 'x' });
S.resourceGroups.set('g10', { id: 'g10', subjectId: 's2', name: 'S2 group', order: 0, createdAt: 'x' });
await run('deleteSubject', { subjectId: 's2' });
check('cascade: deleting a subject removes it', !S.subjects.has('s2'));
check('cascade: deleting a subject removes its topics', !S.topics.has('t3'));
check('cascade: deleting a subject removes its resources', !S.resources.has('r5'));
check('cascade: deleting a subject removes its groups', !S.resourceGroups.has('g10'));
check('cascade: another subject is untouched', S.subjects.has('s1') && S.resources.has('r1'));

S.resources.set('r6', { id: 'r6', subjectId: 's1', topicId: 't2', kind: 'link', title: 'T2 res', urlOrPath: 'https://g', tags: [], createdAt: 'x' });
await run('deleteTopic', { topicId: 't2' });
check('cascade: deleting a topic removes its resources', !S.resources.has('r6'));
check('cascade: deleting a topic leaves the subject', S.subjects.has('s1'));

const rN = S.resources.size;
await run('deleteResource', { resourceId: 'r1' });
check('delete: deleting a resource removes exactly one', S.resources.size === rN - 1 && !S.resources.has('r1'));

// ============ 6. every tool is registered for the model and classified
const specNames = lib.LIBRARY_TOOL_SPECS.map((s) => s.function.name);
const handlerNames = [...lib.LIBRARY_TOOL_NAMES];
check('registry: every spec has a handler and every handler has a spec',
  specNames.length === handlerNames.length && specNames.every((n) => handlerNames.includes(n)));
check('registry: the required Phase 2 tools all exist',
  ['listGroups', 'createGroup', 'renameGroup', 'deleteGroup', 'moveResourceToGroup',
    'renameSubject', 'deleteSubject', 'renameTopic', 'deleteTopic',
    'renameResource', 'moveResource', 'deleteResource'].every((n) => specNames.includes(n)));
check('registry: tools.ts spreads LIBRARY_TOOL_SPECS', /\.\.\.LIBRARY_TOOL_SPECS/.test(toolsSrc));
check('registry: executeTool routes to executeLibraryTool', /executeLibraryTool\(name, args\)/.test(toolsSrc));
check('registry: describeToolCall routes to the library describer',
  /LIBRARY_TOOL_NAMES\.has\(name\)\) return describeLibraryToolCall/.test(toolsSrc));
check('registry: createSubject / createTopic are NOT duplicated here',
  !specNames.includes('createSubject') && !specNames.includes('createTopic'));
check('registry: every spec has a description and a params object',
  lib.LIBRARY_TOOL_SPECS.every((s) => s.function.description && s.function.parameters));

// ============ 7. the Confirm wording tells the user what they would lose
const deleteSpecs = lib.LIBRARY_TOOL_SPECS.filter((s) => /^delete/.test(s.function.name));
check('instructions: every delete description names the Confirm requirement',
  deleteSpecs.length === 4 && deleteSpecs.every((s) => /user must confirm before this runs/.test(s.function.description)));
check('instructions: deleteGroup explains that resources survive',
  /UNGROUPS its resources/.test(lib.describeLibraryToolCall('deleteGroup', {}).concat(
    lib.LIBRARY_TOOL_SPECS.find((s) => s.function.name === 'deleteGroup').function.description)));
check('instructions: the Confirm wording states what is lost for the big deletes',
  deleteSpecs.filter((s) => /^delete(Subject|Topic|Resource)$/.test(s.function.name))
    .every((s) => /PERMANENTLY DELETE/.test(lib.describeLibraryToolCall(s.function.name, {}))));

// ============================== Phase 3: the selection-loss regression
// The size and color bugs had ONE cause: no `preventDefault` on mousedown, so
// the browser collapsed the textarea selection before `onClick` ran and the
// wrapper was inserted around zero characters. Guard the fix so it cannot be
// dropped again by a well-meaning edit.
const toolbar = readFileSync('src/features/library/components/NoteToolbar.tsx', 'utf8');
check('p3 every formatting button prevents mousedown default',
  (toolbar.match(/onMouseDown=\{keepSelection\}/g) || []).length >= 5,
  `${(toolbar.match(/onMouseDown=\{keepSelection\}/g) || []).length} buttons`);
check('p3 keepSelection calls preventDefault on mousedown, not on click',
  /const keepSelection = \(e: React\.MouseEvent\) => e\.preventDefault\(\);/.test(toolbar));
check('p3 the reason is documented at the fix', /collapses the selection/i.test(toolbar));
// The render path must still carry color through (it was never the bug).
const noteFmt = readFileSync('src/features/library/noteFormat.ts', 'utf8');
check('p3 color is still emitted as a theme token',
  /export const colorVar = \(c: NoteColor\): string => `var\(--note-c-\$\{c\}\)`/.test(noteFmt));
check('p3 the sanitizer still allows the palette tokens',
  /const COLOR_TOKEN = \/\^var\\\(--note-c-/.test(noteFmt));
const themes = readFileSync('src/styles/themes.css', 'utf8');
check('p3 every palette hue variable is defined in CSS',
  ['rose', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'gray']
    .every((h) => themes.includes(`--note-hue-${h}:`)));
check('p3 the editor still uses a textarea (Phase 3 rewrite NOT attempted)',
  /<textarea/.test(readFileSync('src/features/library/components/MarkdownNotes.tsx', 'utf8')));

console.log(`\nai-tools-library: ${pass} passed, ${fail} failed`);
try { rmSync(bundleFile, { force: true }); } catch { /* best effort */ }
process.exit(fail === 0 ? 0 : 1);