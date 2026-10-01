/**
 * Phase 4: calendar tools for the NEW calendar.
 *
 * Drives the real `toolsCalendar` against a Dexie stub, so the period times,
 * the validation and the preview/confirm split under test are the shipping ones.
 *
 * The load-bearing checks are the ones the brief calls out: a period's times
 * come from the SHARED PERIODS constant, a recurring series creates NOTHING
 * until confirmed, and changing an assessment's date moves the calendar item
 * with no event copy.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = mkdtempSync(join(tmpdir(), 'caltools-'));
const root = process.cwd().replace(/\\/g, '/');
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, `
export * from '${root}/src/features/ai/toolsCalendar';
export { PERIODS, WEEK_STARTS_ON } from '${root}/src/features/calendar/categories';
export { isIsoDate, isIsoTime, dateContext, daysUntil } from '${root}/src/features/calendar/dateRules';
`);

const dbStub = `
// Declared with 'var' (hoisted) so every db.x reference resolves: a top-level
// const is emitted after its first use and compiles to void 0.x.
export var db = new Proxy({}, {
  get(_t, name) {
    if (name === 'transaction') return async (...a) => a[a.length - 1]();
    if (name === 'cloud') return undefined;
    var S = globalThis.__S;
    if (!S) throw new Error('stub has no __S');
    var col = function (n) {
      var m = () => Array.from((S[n] ?? new Map()).values());
      return {
        async toArray() { return m(); },
        async get(id) { return (S[n] ?? new Map()).get(id); },
        async put(v) { S[n].set(v.id, v); return v.id; },
        async add(v) { S[n].set(v.id, v); return v.id; },
        async update(id, patch) { if (S[n].has(id)) S[n].set(id, Object.assign({}, S[n].get(id), patch)); },
        async count() { return (S[n] ?? new Map()).size; },
        async clear() { if (S[n]) S[n].clear(); },
        async delete(id) { if (S[n]) S[n].delete(id); },
        async bulkPut(rows) { for (const r of rows) S[n].set(r.id, r); return rows.map(r => r.id); },
        orderBy: () => ({ first: async () => m()[0], toArray: async () => m() }),
        where: (idx) => ({ equals: (val) => ({ toArray: async () => m().filter((r) => r[idx] === val), first: async () => m().find((r) => r[idx] === val) }) }),
        filter: () => ({ first: async () => m()[0], toArray: async () => m() }),
      };
    };
    return col(String(name));
  },
});
`;

const bundleFile = join(process.cwd(), 'node_modules', '.cache-caltools.mjs');
await build({
  entryPoints: [entry], outfile: bundleFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
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
rmSync(outDir, { recursive: true, force: true });
if (readFileSync(bundleFile, 'utf8').includes('ProductivityDB')) {
  console.error('FATAL: the real db.ts was bundled, so the stub is not in effect.');
  process.exit(1);
}

const T = await import(`file://${bundleFile.replace(/\\/g, '/')}`);
// WEEK_STARTS_ON is re-exported through the entry module, so it is read from the
// same bundle rather than a second import that would evaluate the module twice.
const { WEEK_STARTS_ON } = T;
const {
  PERIODS, executeCalendarTool, executeCalendarToolConfirmed, previewSeriesDates,
  CALENDAR_TOOL_SPECS, CALENDAR_TOOL_NAMES, CALENDAR_CONFIRM_TOOL_NAMES,
  MAX_SERIES_EVENTS, isIsoDate, isIsoTime, dateContext, daysUntil, calendarPromptSection,
} = T;

let pass = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`); pass += 1; }
  else { console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); failed += 1; }
};

function seed() {
  globalThis.__S = {
    subjects: new Map([['sub-algo', { id: 'sub-algo', name: 'Algorithms', color: '#111', createdAt: 'x' }]]),
    topics: new Map(), resources: new Map(), resourceGroups: new Map(),
    pomodoroSessions: new Map(), weeklySchedules: new Map(), shiftOverrides: new Map(),
    aiProviders: new Map(), chatSessions: new Map(), chatMessages: new Map(),
    themeStatusMap: new Map(), appSettings: new Map(), uiState: new Map(),
    // Three events on one day (more than the two chips the grid shows), an
    // assessment on the same day, and period 3 already taken.
    calendarEvents: new Map([
      ['ev-1', { id: 'ev-1', title: 'Algorithms Lecture', date: '2026-10-05', startTime: '12:10', endTime: '13:50', category: 'class', subjectId: 'sub-algo', eventKind: 'lecture', period: 3, createdAt: 'x' }],
      ['ev-2', { id: 'ev-2', title: 'Gym', date: '2026-10-05', startTime: '18:00', endTime: '19:00', category: 'personal', createdAt: 'x' }],
      ['ev-3', { id: 'ev-3', title: 'Reading', date: '2026-10-05', category: 'personal', createdAt: 'x' }],
    ]),
    assessments: new Map([
      ['as-1', { id: 'as-1', subjectId: 'sub-algo', name: 'Midterm Quiz', type: 'quiz', date: '2026-10-05', createdAt: 'x' }],
    ]),
  };
}
const S = () => globalThis.__S;
const call = (name, args) => executeCalendarTool(name, args);
const rejects = async (name, args) => {
  try { await call(name, args); return null; } catch (e) { return e.message; }
};

/* ============ 1. period times come from the SHARED constant ============ */
seed();
const p3 = await call('listPeriods', {});
check('listPeriods returns all six periods', p3.data.periods.length === 6, `${p3.data.periods.length}`);
check('period 1 is 08:30-10:10',
  p3.data.periods[0].start === '08:30' && p3.data.periods[0].end === '10:10');
check('period 3 is 12:10-13:50',
  p3.data.periods[2].start === '12:10' && p3.data.periods[2].end === '13:50');
check('period 6 is 17:40-19:20',
  p3.data.periods[5].start === '17:40' && p3.data.periods[5].end === '19:20');
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
check('every period is exactly 1h40m',
  PERIODS.every((p) => toMin(p.end) - toMin(p.start) === 100), `${PERIODS.length} periods`);
check('there is a 10 minute break between consecutive periods',
  PERIODS.every((p, i) => i === 0 || toMin(PERIODS[i].start) - toMin(PERIODS[i - 1].end) === 10));

const made = await call('createEvent', {
  title: 'Physics Lab', date: '2026-11-02', eventKind: 'lab', period: 4, subjectId: 'sub-algo',
});
const lab = [...S().calendarEvents.values()].find((e) => e.title === 'Physics Lab');
check('createEvent sets the times from PERIODS, never from the model',
  lab.startTime === '14:00' && lab.endTime === '15:40', `${lab.startTime}-${lab.endTime}`);
check('createEvent returns { kind, id, name } of what it created',
  made.data.event.kind === 'event' && made.data.event.id === lab.id
  && made.data.event.name === 'Physics Lab', JSON.stringify(made.data.event));
check('createEvent stored the kind and period',
  lab.eventKind === 'lab' && lab.period === 4 && lab.subjectId === 'sub-algo');

/* ============ 2. invalid input is rejected, clearly ============ */
check('a word like "tomorrow" is rejected', !!(await rejects('getDayAgenda', { date: 'tomorrow' })));
check('...and the error states the required format',
  /YYYY-MM-DD/.test((await rejects('getDayAgenda', { date: 'tomorrow' })) || ''));
check('an impossible date is rejected', !!(await rejects('getDayAgenda', { date: '2026-02-30' })));
check('a reversed range is rejected',
  !!(await rejects('listEvents', { fromDate: '2026-10-10', toDate: '2026-10-01' })));
const badPeriod = await rejects('createEvent',
  { title: 'X', date: '2026-11-02', eventKind: 'lecture', period: 9 });
check('a period outside 1-6 is rejected', !!badPeriod);
check('...and the error lists the fixed period times', /08:30-10:10/.test(badPeriod || ''));
check('a period on a studying event is rejected',
  !!(await rejects('createEvent', { title: 'X', date: '2026-11-02', eventKind: 'studying', period: 2 })));
check('a period with no kind is rejected',
  !!(await rejects('createEvent', { title: 'X', date: '2026-11-02', period: 2 })));
check('an end before the start is rejected',
  !!(await rejects('createEvent', { title: 'X', date: '2026-11-02', customStart: '15:00', customEnd: '14:00' })));
check('a bad time format is rejected',
  !!(await rejects('createEvent', { title: 'X', date: '2026-11-02', customStart: '2pm', customEnd: '3pm' })));
check('an unknown eventKind is rejected',
  !!(await rejects('createEvent', { title: 'X', date: '2026-11-02', eventKind: 'seminar' })));
check('isIsoDate accepts a real date', isIsoDate('2026-10-05'));
check('isIsoDate rejects 2026-02-30', !isIsoDate('2026-02-30'));
check('isIsoTime accepts 24-hour times and rejects 2:30pm',
  isIsoTime('14:30') && !isIsoTime('2:30pm'));

/* ============ 3. an overlap is a WARNING, not an error ============ */
seed();
const before = S().calendarEvents.size;
const clash = await call('createEvent', {
  title: 'Algorithms Lecture 2', date: '2026-10-05', eventKind: 'lecture', period: 3,
});
check('a clash in a taken period still creates the event',
  S().calendarEvents.size === before + 1, `${before} -> ${S().calendarEvents.size}`);
check('the clash is reported as a warning, not an error',
  Array.isArray(clash.data.warnings) && clash.data.warnings.length === 1
  && /already taken/.test(clash.data.warnings[0]), clash.data.warnings?.[0] ?? 'none');
const noClash = await call('createEvent', {
  title: 'Free Study', date: '2026-10-05', eventKind: 'lab', period: 5,
});
check('a free period produces no warning', (noClash.data.warnings ?? []).length === 0);

/* ============ 4. read tools on real data ============ */
seed();
const agenda = await call('getDayAgenda', { date: '2026-10-05' });
check('getDayAgenda returns all three events of a busy day',
  agenda.data.events.length === 3, `${agenda.data.events.length}`);
check('getDayAgenda returns them in time order, untimed first',
  agenda.data.events.map((e) => e.title).join('|') === 'Reading|Algorithms Lecture|Gym',
  agenda.data.events.map((e) => e.title).join('|'));
check('getDayAgenda includes the assessment due that day',
  agenda.data.assessments.length === 1 && agenda.data.assessments[0].id === 'as-1');
// Period 3 is taken by the lecture, and period 6 (17:40-19:20) overlaps the
// 18:00-19:00 gym session, so both are correctly NOT free.
check('getDayAgenda marks taken periods as not free',
  !agenda.data.freePeriods.some((p) => p.period === 3)
  && !agenda.data.freePeriods.some((p) => p.period === 6),
  `free: ${agenda.data.freePeriods.map((p) => p.period).join(',')}`);
check('a non-teaching event also blocks a period it overlaps',
  agenda.data.freePeriods.length === 4, `${agenda.data.freePeriods.length}`);
const lecture = agenda.data.events.find((e) => e.id === 'ev-1');
check('each event carries its subject, kind and period',
  lecture.subject === 'Algorithms' && lecture.eventKind === 'lecture' && lecture.period === 3);

const empty = await call('getDayAgenda', { date: '2026-10-07' });
check('an empty day reports nothing and frees all six periods',
  empty.data.events.length === 0 && empty.data.freePeriods.length === 6);

const listed = await call('listEvents', { fromDate: '2026-10-01', toDate: '2026-10-31' });
check('listEvents returns the range with ids and titles',
  listed.data.events.length === 3 && listed.data.events.every((e) => e.id && e.title));
check('listEvents filters by kind',
  (await call('listEvents',
    { fromDate: '2026-10-01', toDate: '2026-10-31', eventKind: 'lecture' })).data.events.length === 1);
check('listEvents accepts a subject NAME through the shared resolver',
  (await call('listEvents',
    { fromDate: '2026-10-01', toDate: '2026-10-31', subjectId: 'Algorithms' })).data.events.length === 1);
check('listEvents says so when it is not truncated', listed.data.truncated === false);

const week = await call('getWeekTimetable', { weekStartDate: '2026-10-05' });
check('getWeekTimetable places the lecture in period 3 on its day',
  Boolean(week.data.timetable.find((d) => d.date === '2026-10-05')?.byPeriod?.['3']
    ?.includes('Algorithms Lecture')), JSON.stringify(week.data.timetable[0]?.byPeriod));
check('getWeekTimetable uses the app week start, not an assumed one',
  week.data.weekStartsOn === 'Monday' && week.data.weekStartDate === '2026-10-05');
check('getWeekTimetable includes that week assessment',
  week.data.assessments.some((a) => a.id === 'as-1'));

const slots = await call('findFreeSlots', { date: '2026-10-05', durationMinutes: 60 });
check('findFreeSlots finds gaps around the busy times', slots.data.slots.length >= 1,
  JSON.stringify(slots.data.slots));
check('findFreeSlots marks the free periods and omits the taken one',
  !slots.data.freePeriods.some((p) => p.period === 3));

const asList = await call('listAssessments', {});
check('listAssessments returns the date and a days-left number',
  asList.data.assessments[0].date === '2026-10-05'
  && typeof asList.data.assessments[0].daysLeft === 'number');
check('an undated assessment is hidden unless asked for',
  (await call('createAssessment', { subjectId: 'sub-algo', title: 'No Date Yet' })).data.date === null);
check('...and appears when includeUndated is set',
  (await call('listAssessments', { includeUndated: true })).data.assessments.length === 2);

/* ============ 5. update, move, link, delete ============ */
seed();
const renamed = await call('updateEvent', { eventId: 'ev-2', title: 'Gym Session' });
check('updateEvent changes only what it was given',
  S().calendarEvents.get('ev-2').title === 'Gym Session'
  && S().calendarEvents.get('ev-2').startTime === '18:00');
check('updateEvent returns { kind, id, name }',
  renamed.data.event.id === 'ev-2' && renamed.data.event.name === 'Gym Session');
const repd = await call('updateEvent', { eventId: 'ev-1', period: 5 });
check('updateEvent with a period resets the times from PERIODS',
  repd.data.startTime === '15:50' && repd.data.endTime === '17:30', `${repd.data.startTime}-${repd.data.endTime}`);

const moved = await call('moveEvent', { eventId: 'ev-3', newDate: '2026-10-06' });
check('moveEvent changes the date', S().calendarEvents.get('ev-3').date === '2026-10-06');
// A period is only legal on a lecture, section or lab, and ev-3 has no kind
// yet, so the kind is set first. Asking for a period on a kindless event is
// correctly rejected rather than silently ignored.
check('moving to a period without a kind is rejected',
  !!(await rejects('moveEvent', { eventId: 'ev-3', newPeriod: 2 })));
check('once the kind is set, the period is accepted and sets the times',
  (await call('moveEvent', { eventId: 'ev-3', eventKind: 'lecture', newPeriod: 2 })).data.startTime === '10:20');

const linked = await call('setEventSubject', {
  eventId: 'ev-3', subjectId: 'sub-algo', eventKind: 'section', period: 6,
});
check('setEventSubject links the subject, kind and period',
  linked.data.subject === 'Algorithms' && linked.data.eventKind === 'section'
  && linked.data.period === 6 && linked.data.startTime === '17:40');
check('setEventSubject resolves the subject by NAME too',
  (await call('setEventSubject', { eventId: 'ev-2', subjectId: 'Algorithms' })).data.subject === 'Algorithms');

const del = await call('deleteEvent', { eventId: 'ev-2' });
check('deleteEvent removes the event and reports { kind, id, name }',
  !S().calendarEvents.has('ev-2') && del.data.event.id === 'ev-2');
check('deleting an unknown event fails clearly',
  /No event matches/.test((await rejects('deleteEvent', { eventId: 'nope-404' })) || ''));
check('an id of the wrong kind is refused',
  !!(await rejects('deleteEvent', { eventId: 'sub-algo' })));

/* ============ 6. assessments: the calendar follows, with no copies ============ */
seed();
const eventsBefore = S().calendarEvents.size;
await call('updateAssessment', { assessmentId: 'as-1', date: '2026-10-09' });
const oldDay = await call('getDayAgenda', { date: '2026-10-05' });
const newDay = await call('getDayAgenda', { date: '2026-10-09' });
check('changing the assessment date moves it off the old day',
  oldDay.data.assessments.length === 0, `${oldDay.data.assessments.length}`);
check('...and onto the new day', newDay.data.assessments.length === 1);
check('...by changing NO event at all (derived, not copied)',
  S().calendarEvents.size === eventsBefore, `${eventsBefore} -> ${S().calendarEvents.size}`);
check('no event was ever created for the assessment',
  ![...S().calendarEvents.values()].some((e) => e.title.includes('Midterm')));

const cleared = await call('updateAssessment', { assessmentId: 'as-1', date: '' });
check('clearing the date removes it from the calendar',
  cleared.data.date === null
  && (await call('getDayAgenda', { date: '2026-10-09' })).data.assessments.length === 0);
check('clearing the date still creates no event copy', S().calendarEvents.size === eventsBefore);
check('the assessment itself is kept, not deleted', S().assessments.has('as-1'));
await call('deleteAssessment', { assessmentId: 'as-1' });
check('deleteAssessment removes it for real', !S().assessments.has('as-1'));

/* ============ 7. createRecurringEvents: preview, then confirm ============ */
seed();
const seriesArgs = {
  title: 'Algorithms Lecture', subjectId: 'sub-algo', eventKind: 'lecture',
  period: 1, weekday: 1, startDate: '2026-10-05', count: 5,
};
const countBefore = S().calendarEvents.size;
const preview = await call('createRecurringEvents', seriesArgs);
check('the FIRST call returns a preview and creates nothing',
  S().calendarEvents.size === countBefore, `${countBefore} -> ${S().calendarEvents.size}`);
check('the preview lists the exact dates',
  preview.data.dates.length === 5 && preview.data.dates[0] === '2026-10-05',
  preview.data.dates.join(','));
check('the preview reports the total and the cap',
  preview.data.total === 5 && preview.data.cap === MAX_SERIES_EVENTS);
check('the preview is weekly (one weekday throughout)',
  new Set(preview.data.dates.map((d) => new Date(`${d}T00:00:00`).getDay())).size === 1);

const confirmed = await executeCalendarToolConfirmed('createRecurringEvents', seriesArgs);
check('confirming creates the events', S().calendarEvents.size === countBefore + 5,
  `${countBefore} -> ${S().calendarEvents.size}`);
// The seeded row already occupies 2026-10-05 with this title, so identify the
// NEW rows by the shared seriesId rather than by title+date, which would match
// the pre-existing lecture.
const created = [...S().calendarEvents.values()]
  .filter((e) => e.seriesId && e.title === 'Algorithms Lecture');
check('confirming created five new rows', created.length === 5, `${created.length}`);
check('every created event shares ONE seriesId',
  new Set(created.map((e) => e.seriesId)).size === 1 && created[0].seriesId === confirmed.data.seriesId,
  created[0]?.seriesId ?? 'none');
check('the created events take their times from PERIODS',
  created.length === 5 && created.every((e) => e.startTime === '08:30' && e.endTime === '10:10'),
  created[0] ? `${created[0].startTime}-${created[0].endTime}` : 'none');

const seriesId = confirmed.data.seriesId;
const dropped = await call('deleteEventSeries', { seriesId });
check('deleteEventSeries reports the count and removes them all',
  dropped.data.count === 5, `${dropped.data.count}`);
check('...and none survive',
  [...S().calendarEvents.values()].filter((e) => e.seriesId === seriesId).length === 0);
check('an unknown seriesId fails clearly',
  /No event series has id/.test((await rejects('deleteEventSeries', { seriesId: 'nope' })) || ''));

// `count` is the number of dates actually CREATED, so a skipped week does not
// consume one: skipping 2026-10-12 from a count of 4 yields 2026-10-05, then
// the three following Mondays.
const skipped = await call('createRecurringEvents', {
  ...seriesArgs, count: 4, skipDates: ['2026-10-12'],
});
check('skipDates removes that date from the preview',
  !skipped.data.dates.includes('2026-10-12'), skipped.data.dates.join(','));
check('...and the run still creates the requested number of events',
  skipped.data.total === 4
  && skipped.data.dates.join(',') === '2026-10-05,2026-10-19,2026-10-26,2026-11-02',
  `${skipped.data.total}: ${skipped.data.dates.join(',')}`);
const capped = previewSeriesDates({ weekday: 1, startDate: '2026-10-05', count: 500 });
check('the 60-event cap is enforced and reported',
  capped.dates.length === MAX_SERIES_EVENTS && capped.truncated === true, `${capped.dates.length}`);
check('a series needs a length',
  !!(await rejects('createRecurringEvents', { title: 'X', startDate: '2026-10-05' })));
check('a bad weekday is rejected',
  !!(await rejects('createRecurringEvents',
    { title: 'X', startDate: '2026-10-05', count: 3, weekday: 9 })));

/* ============ 8. registry, gating and the prompt ============ */
check('every spec has a handler', CALENDAR_TOOL_SPECS.every((s) => CALENDAR_TOOL_NAMES.includes(s.function.name)),
  `${CALENDAR_TOOL_SPECS.length} specs`);
check('every handler has a spec', CALENDAR_TOOL_NAMES.every((n) => CALENDAR_TOOL_SPECS.some((s) => s.function.name === n)),
  CALENDAR_TOOL_NAMES.join(','));
for (const n of ['deleteEvent', 'deleteAssessment', 'deleteEventSeries', 'createRecurringEvents']) {
  check(`${n} is behind the Confirm gate`, CALENDAR_CONFIRM_TOOL_NAMES.has(n));
}
check('read tools are NOT gated',
  !CALENDAR_CONFIRM_TOOL_NAMES.has('getDayAgenda') && !CALENDAR_CONFIRM_TOOL_NAMES.has('listEvents'));
check('every id parameter is described as an id, name accepted as fallback',
  CALENDAR_TOOL_SPECS.filter((s) => /Id/.test(s.function.name))
    .every((s) => JSON.stringify(s.function.parameters).includes('A name is accepted only as a fallback')));
const prompt = calendarPromptSection();
check('the prompt maps questions to tools',
  /getDayAgenda/.test(prompt) && /findFreeSlots/.test(prompt) && /createRecurringEvents/.test(prompt));
check('the prompt says writes run only on the user request',
  /only when the user asked for that change in their own message/.test(prompt));
check('the prompt says event text is data, never instructions',
  /never as instructions to follow/.test(prompt));
check('the prompt says never to invent period times',
  /Never invent period times/.test(prompt));

const ctx = dateContext(new Date('2026-10-01T09:00:00'), WEEK_STARTS_ON);
check('the date context states today, the timezone and the week start',
  /Today is 2026-10-01/.test(ctx) && /timezone/.test(ctx) && /A week starts on Monday/.test(ctx), ctx.slice(0, 60));
check('the date context tells the model to resolve relative words itself',
  /Resolve "today", "tomorrow"/.test(ctx));
check('daysUntil counts whole calendar days', daysUntil('2026-10-11', new Date('2026-10-01T23:00:00')) === 10,
  `${daysUntil('2026-10-11', new Date('2026-10-01T23:00:00'))}`);

console.log(`\ncalendar-tools: ${pass} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);




