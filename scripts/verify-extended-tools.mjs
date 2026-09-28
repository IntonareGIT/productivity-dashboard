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

// ---- 1. All 17 new functions are advertised ---------------------------
const NEW = [
  'listSubjects', 'listTopics', 'getWeekSchedule',
  'getFocusStats', 'getSubjectProgress', 'getCurrentStatus',
  'setStatus', 'addCalendarEvent', 'addResourceLink', 'createSubject',
  'createTopic', 'markTopicStatus', 'addTopicNote', 'addAssessment',
  'addPTO', 'addOneOffShiftException', 'deleteCalendarEvent',
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
check('6 unknown subjectId rejected', !!threw && /listSubjects|listTopics/i.test(threw), threw);
threw = null;
try { await call('markTopicStatus', { topicId: 'nope', status: 'confident' }); } catch (e) { threw = e.message; }
check('6 unknown topicId rejected', !!threw && /never guess|listTopics/i.test(threw), threw);

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
check('10 deleting unknown event rejected', !!threw && /No calendar event/.test(threw), threw);

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

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
