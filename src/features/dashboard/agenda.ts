/**
 * Pure logic for the hour-by-hour Today agenda. No React, no Dexie.
 * Everything is derived from existing tables: nothing is stored.
 */
import { addDays, format } from 'date-fns';
import type { CalendarEvent, ShiftOverride, TodoItem, WeeklySchedule } from '../../types';
import { buildShiftContext, resolveDay } from '../shifts/shiftLogic';
import { occursOn } from '../calendar/recurrence';
import { buildFreeDays, fmtMin, toMin, type StudyTarget } from './freeHours';

export type AgendaKind = 'event' | 'shift' | 'rest' | 'free';

export interface AgendaBlock {
  id: string;
  kind: AgendaKind;
  /** Minutes from midnight, may exceed 1440 for a shift that runs into tomorrow. */
  start: number;
  end: number;
  title: string;
  sub?: string;
  category?: CalendarEvent['category'];
  /** For events: the calendar event id. */
  eventId?: string;
  /** For free windows: the study suggestion. */
  target?: StudyTarget | null;
}

export interface Agenda {
  dateKey: string;
  blocks: AgendaBlock[];
  /** Open to-dos due that day (or earlier, when the day is today). */
  dueTodos: TodoItem[];
  /** Total free minutes. */
  freeMinutes: number;
  /** One-line shift state: "Night shift 21:00-06:00", "Off day". */
  shiftLine: string;
}

interface Inputs {
  date: Date;
  now: Date;
  events: CalendarEvent[];
  overrides: ShiftOverride[];
  schedules: WeeklySchedule[];
  todos: TodoItem[];
  targets: StudyTarget[];
}

export function buildAgenda({ date, now, events, overrides, schedules, todos, targets }: Inputs): Agenda {
  const dateKey = format(date, 'yyyy-MM-dd');
  const todayKey = format(now, 'yyyy-MM-dd');
  const isToday = dateKey === todayKey;
  const ctx = buildShiftContext(overrides, schedules);
  const blocks: AgendaBlock[] = [];

  for (const e of events) {
    if (!occursOn(e, date)) continue;
    const s = toMin(e.startTime);
    if (s == null) continue; // all-day events are not placed on the hour grid
    const en = Math.max(toMin(e.endTime) ?? s + 60, s + 15);
    blocks.push({
      id: `event-${e.id}`,
      kind: 'event',
      start: s,
      end: en,
      title: e.title,
      sub: `${fmtMin(s)}-${fmtMin(en)}`,
      category: e.category,
      eventId: e.id,
    });
  }

  // Last night's shift spilling past midnight, then rest.
  const prev = resolveDay(ctx, addDays(date, -1));
  if (prev.kind === 'work') {
    const ps = toMin(prev.startTime);
    if (ps != null) {
      const spill = ps + Math.round(prev.hours * 60) - 1440;
      if (spill > 0) {
        blocks.push({ id: 'shift-spill', kind: 'shift', start: 0, end: spill, title: 'Night shift', sub: `ends ${fmtMin(spill)}` });
        blocks.push({ id: 'rest-after', kind: 'rest', start: spill, end: spill + 180, title: 'Rest', sub: 'after the shift' });
      }
    }
  }

  const day = resolveDay(ctx, date);
  let shiftLine = 'No shift';
  if (day.kind === 'work') {
    const ds = toMin(day.startTime);
    if (ds != null) {
      const end = ds + Math.round(day.hours * 60);
      blocks.push({ id: 'shift', kind: 'shift', start: ds, end, title: 'Shift', sub: `${day.startTime}-${day.endTime}` });
      blocks.push({ id: 'rest-before', kind: 'rest', start: Math.max(0, ds - 120), end: ds, title: 'Rest', sub: 'before the shift' });
      shiftLine = `Shift ${day.startTime}-${day.endTime}`;
    }
  } else if (day.kind === 'pto') shiftLine = 'Paid time off';
  else if (day.kind === 'off') shiftLine = 'Off day';
  else shiftLine = 'Week not scheduled';

  // Free windows come from the same engine as the Free Hours card.
  const free = buildFreeDays({ events, overrides, schedules, targets, now: isToday ? now : date, days: 1 })[0];
  let freeMinutes = 0;
  if (free) {
    for (const w of free.windows) {
      freeMinutes += w.minutes;
      blocks.push({
        id: `free-${w.start}`,
        kind: 'free',
        start: w.start,
        end: w.end,
        title: w.target?.label ?? 'Free window',
        sub: w.target?.reason,
        target: w.target,
      });
    }
  }

  const dueTodos = todos
    .filter((t) => !t.done && t.dueDate && (isToday ? t.dueDate <= dateKey : t.dueDate === dateKey))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { dateKey, blocks, dueTodos, freeMinutes, shiftLine };
}
