import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { ShiftOverride, WeeklySchedule } from '../../types';

/**
 * Pure schedule logic for the shift tracker (schema v3 — weekly roster).
 *
 * Resolution rules for any date (priority order):
 *  1. override 'pto'          -> PTO (never counted as scheduled hours)
 *  2. override 'custom_off'   -> Off for this date only
 *  3. override 'custom_hours' -> Work on this date with its own start/length
 *                                (works even on an unscheduled/off week)
 *  4. weeklySchedules row for the date's week:
 *       - row missing         -> 'unscheduled' (never guessed/reused)
 *       - offDays includes it -> 'off'
 *       - otherwise           -> 'work' with that week's start time/length
 *
 * Each week's record is independent — nothing here mutates state.
 */

export type DayKind = 'work' | 'off' | 'pto' | 'unscheduled';
export type BaseDayKind = 'work' | 'off' | 'unscheduled';

export interface ShiftContext {
  overridesByDate: Record<string, ShiftOverride>;
  schedulesByWeek: Record<string, WeeklySchedule>; // keyed by weekStartDate
}

export interface ResolvedShiftDay {
  date: Date;                    // local midnight
  dateKey: string;               // yyyy-MM-dd (matches shiftOverrides.date)
  kind: DayKind;                 // final state incl. overrides
  baseKind: BaseDayKind;         // state WITHOUT the override
  hasWeekSchedule: boolean;      // weeklySchedules row exists for the week
  hasOverride: boolean;
  overrideType?: ShiftOverride['type'];
  startTime: string;             // HH:mm, only meaningful for 'work'
  endTime: string;               // HH:mm, only meaningful for 'work'
  hours: number;                 // scheduled hours, 0 for off/pto/unscheduled
  note?: string;
  isToday: boolean;
}

export interface ScheduleSummary {
  scheduledHours: number;   // sum of work hours (PTO/unscheduled excluded)
  shiftCount: number;
  ptoCount: number;
  offCount: number;
  unscheduledCount: number;
}

export interface WeekSummary extends ScheduleSummary {
  workedHours: number;      // elapsed work time, capped at scheduled
  days: ResolvedShiftDay[];
}

const DATE_FORMAT = 'yyyy-MM-dd';
const WEEK_OPTS = { weekStartsOn: 1 as const };

export function toDateKey(date: Date): string {
  return format(date, DATE_FORMAT);
}

/** Monday of the week containing `date` (yyyy-MM-dd). */
export function weekStartKeyFor(date: Date): string {
  return format(startOfWeek(date, WEEK_OPTS), DATE_FORMAT);
}

export function dayEndTime(startTime: string, hours: number): string {
  const start = parse(startTime, 'HH:mm', new Date());
  return format(addMinutes(start, Math.round(hours * 60)), 'HH:mm');
}

/** Build a lookup context from raw table rows. */
export function buildShiftContext(
  overrides: ShiftOverride[],
  schedules: WeeklySchedule[]
): ShiftContext {
  const overridesByDate: Record<string, ShiftOverride> = {};
  for (const o of overrides) overridesByDate[o.date] = o;
  const schedulesByWeek: Record<string, WeeklySchedule> = {};
  for (const s of schedules) schedulesByWeek[s.weekStartDate] = s;
  return { overridesByDate, schedulesByWeek };
}

/** Base state (no override) for a date under a given week's record. */
export function getBaseDayKind(
  schedule: WeeklySchedule | undefined,
  date: Date
): BaseDayKind {
  if (!schedule) return 'unscheduled';
  return schedule.offDays.includes(date.getDay()) ? 'off' : 'work';
}

export function resolveDay(
  ctx: ShiftContext,
  date: Date,
  now: Date = new Date()
): ResolvedShiftDay {
  const dateKey = toDateKey(date);
  const override = ctx.overridesByDate[dateKey];
  const schedule = ctx.schedulesByWeek[weekStartKeyFor(date)];
  const baseKind = getBaseDayKind(schedule, date);

  let kind: DayKind = baseKind;
  let startTime = schedule?.shiftStartTime ?? '';
  let hours = kind === 'work' ? (schedule?.shiftLengthHours ?? 0) : 0;

  if (override) {
    if (override.type === 'pto') {
      kind = 'pto';
      hours = 0;
    } else if (override.type === 'custom_off') {
      kind = 'off';
      hours = 0;
    } else {
      kind = 'work';
      startTime = override.startTime ?? schedule?.shiftStartTime ?? '09:00';
      hours =
        override.shiftLengthHours ?? schedule?.shiftLengthHours ?? 8;
    }
  }

  return {
    date,
    dateKey,
    kind,
    baseKind,
    hasWeekSchedule: Boolean(schedule),
    hasOverride: Boolean(override),
    overrideType: override?.type,
    startTime,
    endTime: kind === 'work' ? dayEndTime(startTime, hours) : '',
    hours,
    note: override?.note,
    isToday: differenceInCalendarDays(date, now) === 0,
  };
}

/** Monday-start week containing `anchor`, resolved day by day. */
export function getWeekDays(
  ctx: ShiftContext,
  anchor: Date,
  now: Date = new Date()
): ResolvedShiftDay[] {
  const weekStart = startOfWeek(anchor, WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => resolveDay(ctx, addDays(weekStart, i), now));
}

/** Worked hours for a day: full days in the past, elapsed time for today. */
function workedHoursForDay(day: ResolvedShiftDay, now: Date): number {
  if (day.kind !== 'work') return 0;
  const dayDiff = differenceInCalendarDays(day.date, now);
  if (dayDiff < 0) return day.hours;
  if (dayDiff > 0) return 0;
  const start = parse(day.startTime, 'HH:mm', day.date);
  const end = addMinutes(start, Math.round(day.hours * 60));
  if (now <= start) return 0;
  if (now >= end) return day.hours;
  return (now.getTime() - start.getTime()) / 3_600_000;
}

function baseSummary(days: ResolvedShiftDay[]): ScheduleSummary {
  return {
    scheduledHours: round1(days.reduce((sum, d) => sum + d.hours, 0)),
    shiftCount: days.filter((d) => d.kind === 'work').length,
    ptoCount: days.filter((d) => d.kind === 'pto').length,
    offCount: days.filter((d) => d.kind === 'off').length,
    unscheduledCount: days.filter((d) => d.kind === 'unscheduled').length,
  };
}

export function getWeekSummary(
  ctx: ShiftContext,
  anchor: Date,
  now: Date = new Date()
): WeekSummary {
  const days = getWeekDays(ctx, anchor, now);
  return {
    ...baseSummary(days),
    workedHours: round1(days.reduce((sum, d) => sum + workedHoursForDay(d, now), 0)),
    days,
  };
}

/** Scheduled-hours summary for the whole calendar month of `anchor`. */
export function getMonthSummary(
  ctx: ShiftContext,
  anchor: Date,
  now: Date = new Date()
): ScheduleSummary & { label: string } {
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  const days: ResolvedShiftDay[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    days.push(resolveDay(ctx, d, now));
  }
  return { ...baseSummary(days), label: format(first, 'MMMM yyyy') };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
