/**
 * Pure logic for the free-hours finder: no React, no Dexie. Derived live from
 * calendar events, the shift roster and the Library; nothing is stored.
 *
 * ASSUMPTIONS (tune here, they are the only guesses in the feature):
 *  - Study happens between DAY_START and DAY_END.
 *  - EVENT_BUFFER minutes of travel/settling around each calendar event.
 *  - PRE_SHIFT_REST minutes before a shift starts are kept clear (rest, prep).
 *  - POST_SHIFT_REST minutes after a night shift runs past midnight are kept
 *    clear the next day (sleep).
 *  - A window shorter than MIN_WINDOW minutes is not worth showing.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Assessment, CalendarEvent, Resource, Subject, Topic } from '../../types';
import { occursOn } from '../calendar/recurrence';
import { buildShiftContext, resolveDay } from '../shifts/shiftLogic';
import type { ShiftOverride, WeeklySchedule } from '../../types';

export const DAY_START = 7 * 60;
export const DAY_END = 23 * 60;
export const EVENT_BUFFER = 15;
export const PRE_SHIFT_REST = 120;
export const POST_SHIFT_REST = 180;
export const MIN_WINDOW = 45;

export interface Busy { start: number; end: number; label: string }
export interface StudyTarget { label: string; reason: string; urgency: number }
export interface FreeWindow {
  start: number;
  end: number;
  minutes: number;
  target: StudyTarget | null;
}
export interface FreeDay {
  dateKey: string;
  date: Date;
  label: string;
  windows: FreeWindow[];
  /** One line explaining what shaped the day (shift, classes). */
  note: string | null;
  totalMinutes: number;
}

export const toMin = (hhmm: string | undefined | null): number | null => {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmtMin = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fmtDuration = (m: number): string =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;

/** Free windows from awake hours minus busy blocks. Pure and unit-testable. */
export function subtractBusy(busy: Busy[], from: number, to: number): { start: number; end: number }[] {
  const sorted = busy.filter((b) => b.end > from && b.start < to).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out.filter((w) => w.end - w.start >= MIN_WINDOW);
}

/** What to study, most urgent first. */
export function buildTargets(
  assessments: Assessment[],
  subjects: Subject[],
  topics: Topic[],
  resources: Resource[],
  now: Date,
): StudyTarget[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const out: StudyTarget[] = [];
  for (const a of assessments) {
    if (a.status !== 'upcoming' || (a.type !== 'exam' && a.type !== 'quiz') || !a.date) continue;
    const d = parseISO(a.date);
    if (Number.isNaN(d.getTime())) continue;
    const days = differenceInCalendarDays(d, now);
    if (days < 0 || days > 21) continue;
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    const todo = topics
      .filter((t) => t.subjectId === a.subjectId && t.status !== 'confident')
      .sort((x, y) => Number(y.status === 'not_started') - Number(x.status === 'not_started') || x.order - y.order);
    const sName = subjectName.get(a.subjectId) ?? 'this subject';
    if (todo.length === 0) {
      out.push({ label: `Revise ${sName}`, reason: `${a.name} ${when}`, urgency: days });
    } else {
      todo.slice(0, 3).forEach((t, i) =>
        out.push({ label: `${t.title} (${sName})`, reason: `${a.name} ${when}`, urgency: days + i * 0.1 }),
      );
    }
  }
  for (const r of resources) {
    if (!r.dueDate || r.completed) continue;
    const d = parseISO(r.dueDate);
    if (Number.isNaN(d.getTime())) continue;
    const days = differenceInCalendarDays(d, now);
    if (days < 0 || days > 7) continue;
    out.push({
      label: `Work on ${r.title}`,
      reason: `${subjectName.get(r.subjectId) ?? 'Resource'} due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
      urgency: days + 0.5,
    });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}

interface Inputs {
  events: CalendarEvent[];
  overrides: ShiftOverride[];
  schedules: WeeklySchedule[];
  targets: StudyTarget[];
  now?: Date;
  days?: number;
}

export function buildFreeDays({ events, overrides, schedules, targets, now = new Date(), days = 3 }: Inputs): FreeDay[] {
  const ctx = buildShiftContext(overrides, schedules);
  const out: FreeDay[] = [];
  let targetIdx = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(now, i);
    const busy: Busy[] = [];
    const notes: string[] = [];

    for (const e of events) {
      if (!occursOn(e, date)) continue;
      const s = toMin(e.startTime);
      if (s == null) continue; // all-day: does not block study hours
      const en = toMin(e.endTime) ?? s + 60;
      busy.push({ start: s - EVENT_BUFFER, end: Math.max(en, s + 15) + EVENT_BUFFER, label: e.title });
    }
    const classCount = busy.length;
    if (classCount > 0) notes.push(`${classCount} event${classCount === 1 ? '' : 's'}`);

    // Last night's shift spilling past midnight.
    const prev = resolveDay(ctx, addDays(date, -1));
    if (prev.kind === 'work') {
      const ps = toMin(prev.startTime);
      if (ps != null) {
        const spill = ps + Math.round(prev.hours * 60) - 1440;
        if (spill > 0) {
          busy.push({ start: 0, end: spill + POST_SHIFT_REST, label: 'After night shift' });
          notes.push(`night shift ends ${fmtMin(spill)}`);
        }
      }
    }
    const day = resolveDay(ctx, date);
    if (day.kind === 'work') {
      const ds = toMin(day.startTime);
      if (ds != null) {
        busy.push({ start: ds - PRE_SHIFT_REST, end: Math.min(1440, ds + Math.round(day.hours * 60)), label: 'Shift' });
        notes.push(`shift ${day.startTime}`);
      }
    }

    let from = DAY_START;
    if (i === 0) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      from = Math.max(from, Math.ceil(nowMin / 15) * 15);
    }
    const raw = from < DAY_END ? subtractBusy(busy, from, DAY_END) : [];
    const windows: FreeWindow[] = raw.map((w) => {
      const target = targets.length > 0 ? targets[targetIdx++ % targets.length] : null;
      return { start: w.start, end: w.end, minutes: w.end - w.start, target };
    });
    out.push({
      dateKey: format(date, 'yyyy-MM-dd'),
      date,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(date, 'EEEE'),
      windows,
      note: notes.length ? notes.join(' · ') : null,
      totalMinutes: windows.reduce((s, w) => s + w.minutes, 0),
    });
  }
  return out;
}
