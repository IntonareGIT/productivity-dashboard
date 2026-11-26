/**
 * Extended assistant tools verification.
 * Drives the real executeTool()/TOOL_SPECS from src/features/ai/tools.ts with
 * Dexie and the stores stubbed in memory.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'tools-'));
const outFile = join(outDir, 'tools.mjs');

// Minimal in-memory Dexie double covering the queries these tools make.
const dbStub = `
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
export const db = new Proxy({}, { get: (_t, name) => col(String(name)) });
export const S = globalThis.__S;
`;

await build({
  entryPoints: ['src/features/ai/tools.ts'],
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
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: dbStub, loader: 'js' }));
        b.onLoad({ filter: /tools\.ts$/ }, async (args) => {
          const fs = await import('node:fs/promises');
          const code = await fs.readFile(args.path, 'utf8');
          return { contents: code, loader: 'ts' };
        });
      },
    },
  ],
});

globalThis.__S = {
  subjects: new Map(), topics: new Map(), resources: new Map(), assessments: new Map(),
  calendarEvents: new Map(), weeklySchedules: new Map(), shiftOverrides: new Map(),
  pomodoroSessions: new Map(), themeStatusMap: new Map(), appSettings: new Map(),
  aiProviders: new Map(), chatSessions: new Map(), chatMessages: new Map(),
  // v10 resource groups. searchLibrary reads this to label each hit with its
  // folder name, so the table must exist even when no groups have been created.
  resourceGroups: new Map(),
};
// The Dexie Cloud addon wires rxjs fromEvent() against `document` and `window`
// at import time, but only when those globals exist — in Node they don't, and
// the addon then takes its own `of({})` no-DOM path. So we must NOT define
// document/window here; a partial shim is worse than none. The only DOM-ish
// global the stores touch directly is document.documentElement (setStatus),
// which we provide as a bare object; the addon's `typeof document !== 'undefined'`
// check sees it, so we also give it event methods.
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
  documentElement: { setAttribute: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' },
};
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
}
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
const t = await import(`file://${outFile.replace(/\\/g, '/')}`);
const S = globalThis.__S;

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) failures++;
};
const call = (name, args = {}) => t.executeTool(name, JSON.stringify(args));
const specNames = t.TOOL_SPECS.map((s) => s.function.name);

// ---- 1. All 18 new functions are advertised ---------------------------
const NEW = [
  'listSubjects', 'listTopics', 'getWeekSchedule',
  'getFocusStats', 'getSubjectProgress', 'getCurrentStatus',
  'setStatus', 'addCalendarEvent', 'addResourceLink', 'createSubject',
  'createTopic', 'markTopicStatus', 'addTopicNote', 'addAssessment',
  'addPTO', 'addOneOffShiftException', 'deleteCalendarEvent',
  'manage_split_screen',
];
for (const n of NEW) check(`1 spec present: ${n}`, specNames.includes(n));
check('1 no duplicate spec names', new Set(specNames).size === specNames.length,
  `${specNames.length} specs, ${new Set(specNames).size} unique`);

// ---- 2. Confirmation gating ------------------------------------------
for (const n of ['addOrUpdateWeeklySchedule', 'addPTO', 'addOneOffShiftException', 'deleteCalendarEvent']) {
  check(`2 gated: ${n}`, t.CONFIRMATION_TOOL_NAMES.has(n));
}
check('2 setStatus NOT gated', !t.CONFIRMATION_TOOL_NAMES.has('setStatus'));
check('2 createSubject NOT gated', !t.CONFIRMATION_TOOL_NAMES.has('createSubject'));
check('2 listSubjects NOT mutating', !t.MUTATING_TOOL_NAMES.has('listSubjects'));
for (const n of ['setStatus', 'createSubject', 'addAssessment', 'markTopicStatus']) {
  check(`2 mutating: ${n}`, t.MUTATING_TOOL_NAMES.has(n));
}

// ---- 3. Seed data ----------------------------------------------------
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
S.subjects.set('sub1', { id: 'sub1', name: 'Physics', description: 'Term 2', notes: '', color: '#111', createdAt: today, updatedAt: today });
S.subjects.set('sub2', { id: 'sub2', name: 'Physics II', description: 'Term 3', notes: '', color: '#222', createdAt: today, updatedAt: today });
S.topics.set('top1', { id: 'top1', subjectId: 'sub1', title: 'Optics', notes: '', status: 'studying', order: 0, createdAt: today, updatedAt: today });
S.topics.set('top2', { id: 'top2', subjectId: 'sub1', title: 'Thermo', notes: 'old note', status: 'not_started', order: 1, createdAt: today, updatedAt: today });
S.pomodoroSessions.set('p1', { id: 'p1', date: today, durationMinutes: 50, sessionType: 'focus', subjectId: 'sub1', completedAt: today });
S.pomodoroSessions.set('p2', { id: 'p2', date: today, durationMinutes: 25, sessionType: 'focus', subjectId: 'sub2', completedAt: today });
S.pomodoroSessions.set('p3', { id: 'p3', date: today, durationMinutes: 999, sessionType: 'short_break', subjectId: 'sub1', completedAt: today });

// ---- 4. Lookups ------------------------------------------------------
let r = await call('listSubjects');
check('4 listSubjects returns ids+names+term', r.data.subjects.length === 2 && !!r.data.subjects[0].id && !!r.data.subjects[0].name);
r = await call('listTopics', { subjectId: 'sub1' });
check('4 listTopics scoped to subject', r.data.topics.length === 2);
check('4 listTopics includes status', r.data.topics.every((x) => !!x.status));
r = await call('getCurrentStatus');
check('4 getCurrentStatus returns status+theme', typeof r.data.status === 'string' && 'theme' in r.data);

// ---- 5. Progress scoped by the id given ----------------------------
r = await call('getSubjectProgress', { subjectId: 'sub1' });
check('5 subject progress scoped', r.data.subject === 'Physics' && r.data.totalTopics === 2);
check('5 topic counts by status', r.data.topicCounts.studying === 1 && r.data.topicCounts.not_started === 1);
check('5 percent confident', r.data.percentConfident === 0);

// ---- 6. Never guess ids ---------------------------------------------
let threw = null;
try { await call('listTopics', { subjectId: 'sub_does_not_exist' }); } catch (e) { threw = e.message; }
check('6 unknown subjectId rejected', !!threw && /No subject matches/.test(threw), threw);
check('6 the subject rejection offers the closest names', !!threw && /Closest:/.test(threw), threw);
threw = null;
try { await call('markTopicStatus', { topicId: 'nope', status: 'confident' }); } catch (e) { threw = e.message; }
check('6 unknown topicId rejected', !!threw && /No topic matches/.test(threw), threw);
check('6 the topic rejection offers the closest names', !!threw && /Closest:/.test(threw), threw);

// ---- 7. Writes land in the store -------------------------------------
r = await call('createSubject', { name: 'Chemistry' });
check('7 createSubject persists', S.subjects.size === 3 && !!r.data.id);
threw = null;
try { await call('createSubject', { name: 'chemistry' }); } catch (e) { threw = e.message; }
check('7 duplicate subject blocked', !!threw && /already exists/i.test(threw), threw);

r = await call('createTopic', { subjectId: 'sub1', title: 'Waves' });
check('7 createTopic persists', S.topics.has(r.data.id) && S.topics.get(r.data.id).subjectId === 'sub1');
threw = null;
try { await call('createTopic', { subjectId: 'sub1', title: 'optics' }); } catch (e) { threw = e.message; }
check('7 duplicate topic blocked', !!threw && /already has a topic/i.test(threw), threw);

r = await call('markTopicStatus', { topicId: 'top1', status: 'confident' });
check('7 markTopicStatus writes', S.topics.get('top1').status === 'confident' && r.data.previous === 'studying');
threw = null;
try { await call('markTopicStatus', { topicId: 'top1', status: 'bogus' }); } catch (e) { threw = e.message; }
check('7 invalid status rejected', !!threw && /must be one of/.test(threw), threw);

r = await call('addTopicNote', { topicId: 'top2', title: 'Key formulas', content: 'E=mc2' });
check('7 note appended to existing', S.topics.get('top2').notes.includes('old note') && S.topics.get('top2').notes.includes('E=mc2'));
check('7 note heading added', S.topics.get('top2').notes.includes('## Key formulas'));

r = await call('addAssessment', { subjectId: 'sub1', name: 'Midterm', type: 'exam', date: '2026-12-01', weight: 30 });
check('7 assessment persisted', [...S.assessments.values()].some((a) => a.name === 'Midterm' && a.weight === 30));
threw = null;
try { await call('addAssessment', { subjectId: 'sub1', name: 'X', type: 'exam', date: '2026-12-01', weight: 500 }); } catch (e) { threw = e.message; }
check('7 bad weight rejected', !!threw && /between 0 and 100/.test(threw), threw);

r = await call('addResourceLink', { topicId: 'top1', title: 'Lecture notes', url: 'https://example.com/a' });
check('7 resource link persisted', [...S.resources.values()].some((x) => x.urlOrPath === 'https://example.com/a' && x.topicId === 'top1'));
threw = null;
try { await call('addResourceLink', { topicId: 'top1', title: 'x', url: 'not-a-url' }); } catch (e) { threw = e.message; }
check('7 non-http url rejected', !!threw && /not a valid http/.test(threw), threw);

r = await call('addCalendarEvent', { title: 'Lab', date: '2026-11-05', time: '14:00', category: 'class' });
check('7 calendar event persisted', [...S.calendarEvents.values()].some((e) => e.title === 'Lab' && e.startTime === '14:00'));
threw = null;
try { await call('addCalendarEvent', { title: 'X', date: '05-11-2026', category: 'class' }); } catch (e) { threw = e.message; }
check('7 bad date format rejected', !!threw && /yyyy-MM-dd/.test(threw), threw);
threw = null;
try { await call('addCalendarEvent', { title: 'X', date: '2026-11-05', category: 'nonsense' }); } catch (e) { threw = e.message; }
check('7 bad category rejected', !!threw && /must be one of/.test(threw), threw);

r = await call('setStatus', { status: 'Researching' });
check('7 setStatus returns change', r.data.status === 'Researching' && r.data.previous !== 'Researching');
threw = null;
try { await call('setStatus', { status: 'Napping' }); } catch (e) { threw = e.message; }
check('7 bad status rejected', !!threw && /must be one of/.test(threw), threw);

// ---- 8. Focus stats exclude non-focus sessions ----------------------
r = await call('getFocusStats', { range: 'today' });
check('8 total excludes breaks', r.data.totalMinutes === 75, String(r.data.totalMinutes));
check('8 per-subject breakdown', r.data.perSubject.length === 2 && r.data.perSubject[0].minutes === 50);
threw = null;
try { await call('getFocusStats', { range: 'year' }); } catch (e) { threw = e.message; }
check('8 invalid range rejected', !!threw && /must be one of/.test(threw), threw);

// ---- 9. Week schedule includes PTO / one-off exceptions -------------
const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
const wk = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
S.weeklySchedules.set('ws1', { id: 'ws1', weekStartDate: wk, offDays: [0, 6], shiftStartTime: '09:00', shiftLengthHours: 8, createdAt: today, updatedAt: today });
S.shiftOverrides.set('ov1', { id: 'ov1', date: wk, type: 'pto', createdAt: today });
r = await call('getWeekSchedule', { weekStartDate: wk });
check('9 week resolves 7 days', r.data.days.length === 7);
check('9 week shows PTO override', r.data.days[0].kind === 'pto' && r.data.days[0].isOneOffException);
check('9 week shows normal work day', r.data.days.some((d) => d.kind === 'work' && d.startTime === '09:00'));
check('9 exceptions listed', r.data.exceptions.length === 1);

// ---- 10. Gated writes report what they replaced ---------------------
r = await call('addPTO', { date: wk });
check('10 addPTO reports replacement', r.data.replacedExisting === true && r.data.previousOverrideType === 'pto');
check('10 addPTO wrote override', [...S.shiftOverrides.values()].some((o) => o.date === wk && o.type === 'pto'));

r = await call('addOneOffShiftException', { date: '2026-11-09', startTime: '11:00', hours: 6 });
check('10 exception computed end time', r.data.endTime === '17:00', r.data.endTime);
threw = null;
try { await call('addOneOffShiftException', { date: '2026-11-09', startTime: '11:00', hours: 99 }); } catch (e) { threw = e.message; }
check('10 bad hours rejected', !!threw && /between 1 and 24/.test(threw), threw);

const ev = [...S.calendarEvents.values()].find((e) => e.title === 'Lab');
r = await call('deleteCalendarEvent', { eventId: ev.id });
check('10 deleteCalendarEvent removed row', !S.calendarEvents.has(ev.id) && r.data.title === 'Lab');
threw = null;
try { await call('deleteCalendarEvent', { eventId: 'ghost' }); } catch (e) { threw = e.message; }
check('10 deleting unknown event rejected', !!threw && /No event matches/.test(threw), threw);

// ---- 13. manage_split_screen queues commands for App ------------------
// Seed two PDF resources: one with a blob (previewable), one without.
S.resources.set('pdf1', { id: 'pdf1', subjectId: 'subA', topicId: 'topB', title: 'Calculus Ch.3', blob: new Blob(['x']) });
S.resources.set('pdf2', { id: 'pdf2', subjectId: 'subA', topicId: null, title: 'Orphan notes' });
// Notes, for the notes-pane resolution tests. `nAmb` and `nAmb2` deliberately
// share a title so ambiguity can be proved rather than assumed.
const noteRow = (id, title, subjectId) => ({
  id, subjectId, title, topicId: id, notes: 'body',
  status: 'not_started', order: 0, createdAt: 'x', updatedAt: 'x',
});
S.subjects.set('subA', { id: 'subA', name: 'Calculus', color: '#111', notes: '', createdAt: 'x', updatedAt: 'x' });
S.subjects.set('subZ', { id: 'subZ', name: 'Algebra', color: '#222', notes: '', createdAt: 'x', updatedAt: 'x' });
S.topics.set('noteA', noteRow('noteA', "Calculus's Notes", 'subA'));
S.topics.set('noteZ', noteRow('noteZ', "Algebra's Notes", 'subZ'));
S.topics.set('nAmb', noteRow('nAmb', 'Shared recap', 'subA'));
S.topics.set('nAmb2', noteRow('nAmb2', 'Shared recap', 'subZ'));

r = await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'pdf', resourceId: 'pdf1' });
check('13 open queues a left-pane PDF command', r.data.pane === 'left' && r.data.action === 'open');
check('13 open names the resource in the summary', /Calculus Ch\.3/.test(r.summary), r.summary);

r = await call('manage_split_screen', { action: 'swap' });
check('13 swap queues without a pane or view', r.data.action === 'swap');

r = await call('manage_split_screen', { action: 'close' });
check('13 close queues without a pane or view', r.data.action === 'close' && /single pane/.test(r.summary));

threw = null;
try { await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'pdf', resourceId: 'ghost' }); } catch (e) { threw = e.message; }
// The wording is now the shared resolver's: it says what was searched and that
// nothing changed, rather than the old id-only "No resource has id ...".
check('13 unknown resource rejected, never guessed', !!threw && /No resource matches/.test(threw), threw);
check('13 the rejection says nothing was changed', !!threw && /Nothing was changed/.test(threw), threw);

threw = null;
try { await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'pdf' }); } catch (e) { threw = e.message; }
check('13 a PDF pane requires a resource', !!threw && /needs a "resourceId"/.test(threw), threw);

threw = null;
try { await call('manage_split_screen', { action: 'open', pane: 'right' }); } catch (e) { threw = e.message; }
check('13 an open needs a view or a resource', !!threw && /needs a "viewType"/.test(threw), threw);

r = await call('manage_split_screen', { action: 'open', pane: 'right', viewType: 'notes', resourceId: 'pdf1' });
check('13 a notes pane derives the topic from its resource', r.data.action === 'open' && /Notes/.test(r.summary), r.summary);

// A note can now be named DIRECTLY, by the id searchLibrary returns. Before this
// a note was unreachable: the tool could only borrow a resource's topic.
{
  // searchLibrary must give notes a PATH in the same shape resources get, or two
  // notes with the same title are indistinguishable to the model.
  const found = await call('searchLibrary', { query: 'recap' });
  const hits = found.data?.topics ?? [];
  check('searchLibrary returns notes', hits.length === 2, JSON.stringify(hits));
  check('each note carries its path, like a resource carries its folder',
    hits.every((h) => typeof h.path === 'string' && h.path.length > 0),
    JSON.stringify(hits.map((h) => h.path)));
  check('two same-titled notes are told apart by their subject path',
    new Set(hits.map((h) => h.path)).size === 2,
    hits.map((h) => `${h.title}@${h.path}`).join(' | '));
}
r = await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'notes', resourceId: 'noteA' });
check('13 a notes pane opens from a NOTE id, not only from a resource',
  r.ok === true && r.data.requested.topicId === 'noteA',
  JSON.stringify(r.data.requested));
r = await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'notes', resourceId: "Algebra's Notes" });
check('13 a note is also resolvable by its exact title',
  r.ok === true && r.data.requested.topicId === 'noteZ',
  JSON.stringify(r.data.requested));
r = await call('manage_split_screen', { action: 'open', pane: 'left', viewType: 'notes', resourceId: 'recap' });
check('13 an ambiguous note name returns candidates, never a guess',
  r.ok === false && r.data.error === 'ambiguous_note' && r.data.candidates.length === 2,
  JSON.stringify(r.data));
check('13 the ambiguous candidates carry ids, so the model can retry',
  r.data.candidates.every((c) => !!c.id && c.type === 'note'),
  JSON.stringify(r.data.candidates));

threw = null;
try { await call('manage_split_screen', { action: 'open', pane: 'right', viewType: 'notes', resourceId: 'pdf2' }); } catch (e) { threw = e.message; }
check('13 a notes pane that resolves to no note is rejected', !!threw && /No note matches|needs a note/.test(threw), threw);

threw = null;
try { await call('manage_split_screen', { action: 'teleport' }); } catch (e) { threw = e.message; }
check('13 a bogus action is rejected', !!threw && /must be one of/.test(threw), threw);

const dSplit = t.describeToolCall('manage_split_screen', JSON.stringify({ action: 'open', pane: 'left', viewType: 'pdf' }));
check('13 the description names the open', /Opening/.test(dSplit), dSplit);

// ---- 11. Confirmation text states what will change ------------------
const dPTO = t.describeToolCall('addPTO', JSON.stringify({ date: '2026-11-10' }));
const dDel = t.describeToolCall('deleteCalendarEvent', JSON.stringify({ eventId: 'e1' }));
const dExc = t.describeToolCall('addOneOffShiftException', JSON.stringify({ date: '2026-11-10', startTime: '10:00', hours: 4 }));
check('11 addPTO names the date', dPTO.includes('2026-11-10') && /replaces/i.test(dPTO), dPTO);
check('11 delete warns it is permanent', /cannot be undone/i.test(dDel), dDel);
check('11 exception states the change', dExc.includes('10:00') && dExc.includes('4h'), dExc);

// ---- 12. Unknown function still errors -----------------------------
threw = null;
try { await call('totallyUnknownFn', {}); } catch (e) { threw = e.message; }
check('12 unknown function rejected', !!threw && /Unknown function/.test(threw), threw);

// ---- 14. The "ABUK" bug: ids must reach the model ------------------------
// Reported failure: the model passed the FILE NAME as a resource id, the tool
// threw "No resource has id 'ABUK'", and the chat then stopped dead. The root
// cause was that searchLibrary never returned an id at all, so "ABUK" was the
// only string the model had to hand over.
{
  const sub = { id: 's-phys', name: 'Physics', color: '#000', description: '', createdAt: '', updatedAt: '' };
  const top = { id: 't-mech', subjectId: 's-phys', title: 'Mechanics', status: 'studying', notes: 'notes', createdAt: '', updatedAt: '' };
  S.subjects.set(sub.id, sub);
  S.topics.set(top.id, top);
  const abuk = {
    id: 'r-abuk-1', subjectId: 's-phys', topicId: 't-mech', kind: 'file',
    title: 'ABUK', fileName: 'ABUK.pdf', mimeType: 'application/pdf',
    urlOrPath: null, tags: [], dueDate: null, blob: { size: 10 },
    fileSize: 10, createdAt: '', updatedAt: '',
  };
  const pic = {
    id: 'r-pic-2', subjectId: 's-phys', topicId: 't-mech', kind: 'file',
    title: 'pic file', fileName: 'pic file.pdf', mimeType: 'application/pdf',
    urlOrPath: null, tags: [], dueDate: null, blob: { size: 10 },
    fileSize: 10, createdAt: '', updatedAt: '',
  };
  S.resources.set(abuk.id, abuk);
  S.resources.set(pic.id, pic);

  // 1. What the MODEL receives, not what the UI shows. This is the payload
  //    appended to history as the tool response.
  const found = await call('searchLibrary', { query: 'ABUK' });
  const modelSees = JSON.parse(found.data === undefined ? '{}' : JSON.stringify(found.summary));
  check('14 searchLibrary returns a flat id-carrying resource list',
    Array.isArray(found.data?.resources) && found.data.resources.length === 1,
    JSON.stringify(found.data?.resources));
  const first = (found.data?.resources ?? [])[0] ?? {};
  check('14 the resource entry carries a real id, not the title',
    first.id === 'r-abuk-1', String(first.id));
  check('14 the entry carries title/type/subject/topic',
    first.title === 'ABUK' && first.type === 'file' &&
    first.subject === 'Physics' && first.topic === 'Mechanics',
    JSON.stringify(first));
  check('14 the summary tells the model to use the id field',
    /"id" field/.test(String(found.summary)) || /id/.test(String(found.summary)),
    String(found.summary));
  check('14 the summary is not the old subject-count stub',
    !/Found matches in \d+ subject/.test(String(found.summary)), String(found.summary));

  // 2. The reported failure, replayed verbatim: the model passes the FILE NAME.
  const byName = await call('manage_split_screen', {
    action: 'open', pane: 'left', viewType: 'pdf', resourceId: 'ABUK',
  });
  check('14 a file name passed as an id now resolves', byName.ok === true, byName.summary);
  check('14 it resolves to the real resource id',
    byName.data?.requested?.resourceId === 'r-abuk-1',
    JSON.stringify(byName.data?.requested));

  // 3. The second half of the user's sentence.
  const second = await call('manage_split_screen', {
    action: 'open', pane: 'right', viewType: 'pdf', resourceId: 'pic file',
  });
  check('14 both panes of the reported request resolve',
    byName.ok === true && second.ok === true, `${byName.summary} / ${second.summary}`);

  // 4. An unknown value still errors, and the message says where ids come from.
  const bogus = await call('manage_split_screen', {
    action: 'open', pane: 'left', viewType: 'pdf', resourceId: 'zzz-nothing',
  }).catch((e) => ({ ok: false, summary: e.message }));
  check('14 a genuinely unknown id still fails', bogus.ok === false, bogus.summary);
  check('14 the error points at the id field, not the file name',
    /"id" field/.test(bogus.summary) && /never the file name/.test(bogus.summary),
    bogus.summary);

  // 5. An ambiguous name returns CANDIDATES with ids rather than a dead end.
  const twin = { ...pic, id: 'r-pic-3', title: 'pic file', fileName: 'pic file copy.pdf' };
  S.resources.set(twin.id, twin);
  const amb = await call('manage_split_screen', {
    action: 'open', pane: 'left', viewType: 'pdf', resourceId: 'pic file',
  });
  check('14 an ambiguous name returns a candidate list, not a bare error',
    amb.ok === false && amb.data?.error === 'ambiguous_resource', JSON.stringify(amb.data));
  check('14 the candidates carry their ids so the model can retry',
    Array.isArray(amb.data?.candidates) && amb.data.candidates.length === 2 &&
    amb.data.candidates.every((c) => !!c.id),
    JSON.stringify(amb.data?.candidates));
  check('14 the summary asks for an id, not a correction',
    /one of these ids/i.test(String(amb.summary)), amb.summary);
  S.resources.delete(twin.id);

  // 6. Descriptions steer the model before it ever guesses.
  const searchSpec = t.TOOL_SPECS.find((s) => s.function.name === 'searchLibrary');
  const splitSpec = t.TOOL_SPECS.find((s) => s.function.name === 'manage_split_screen');
  check('14 searchLibrary documents the id field',
    /"id" field/.test(searchSpec.function.description) && /never the file name/.test(searchSpec.function.description));
  check('14 manage_split_screen documents the id field',
    /"id" field/.test(splitSpec.function.description) && /never the file name/.test(splitSpec.function.description));
}

// ---- 15. searchLibrary must see BOTH note formats -------------------------
// A note edited in the rich-text editor has its real text in `contentHtml`,
// while `notes` still holds the original markdown. Searching `notes` alone made
// everything the user typed in the new editor invisible to the assistant.
{
  const sub = { id: 's-rich', name: 'RichText', color: '#000', description: '', createdAt: '', updatedAt: '' };
  S.subjects.set(sub.id, sub);
  // Converted note: markdown backup says "old", editor body says the real thing.
  const rich = {
    id: 't-rich', subjectId: 's-rich', title: 'Converted', status: 'studying',
    notes: 'old markdown body', contentHtml: '<p>quokka telemetry</p>', contentFormat: 'html',
    createdAt: '', updatedAt: '',
  };
  // Legacy note: markdown only, never opened in the editor.
  const legacy = {
    id: 't-legacy', subjectId: 's-rich', title: 'Legacy', status: 'studying',
    notes: 'aardvark sighting', createdAt: '', updatedAt: '',
  };
  S.topics.set(rich.id, rich);
  S.topics.set(legacy.id, legacy);

  const idsFor = async (q) => {
    const r = await call('searchLibrary', { query: q });
    return JSON.stringify(r.data);
  };
  const inHtml = await idsFor('quokka');
  check('15 search finds text that exists ONLY in the rich-text field',
    inHtml.includes('t-rich') && !inHtml.includes('t-legacy'), inHtml.slice(0, 200));
  const inMarkdown = await idsFor('aardvark');
  check('15 search still finds text in the untouched markdown field',
    inMarkdown.includes('t-legacy') && !inMarkdown.includes('t-rich'), inMarkdown.slice(0, 200));
  // The markdown backup must not become searchable noise for converted notes:
  // "old markdown body" exists only in `notes`, which is no longer authoritative.
  const backup = await idsFor('markdown');
  check('15 the stale markdown backup is not searched once a note is converted',
    !backup.includes('t-rich'), backup.slice(0, 200));
  S.topics.delete(rich.id);
  S.topics.delete(legacy.id);
  S.subjects.delete(sub.id);
}


rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
