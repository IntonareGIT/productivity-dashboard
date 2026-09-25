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
import type { ShiftConfig, ShiftOverride } from '../../types';

/**
 * Pure schedule logic for the shift tracker. No Dexie imports, so it can be
 * reused by the Dashboard, Shifts page, and (Phase 3) Calendar tinting.
 *
 * Day resolution rules (in priority order):
 *  1. override 'pto'         -> PTO (never counted as scheduled hours)
 *  2. override 'custom_off'  -> Off for this date only
 *  3. override 'custom_hours'-> Work on this date, with its own start/length
 *                              (works even on a normally-off day)
 *  4. default schedule       -> work if config.workingDays includes weekday
 */

export type DayKind = 'work' | 'off' | 'pto';

export interface ResolvedShiftDay {
  date: Date;                    // local midnight
  dateKey: string;               // yyyy-MM-dd (matches shiftOverrides.date)
  kind: DayKind;
  isDefaultWorkingDay: boolean;  // weekday in config.workingDays
  hasOverride: boolean;
  overrideType?: ShiftOverride['type'];
  startTime: string;             // HH:mm, only meaningful for 'work'
  endTime: string;               // HH:mm, only meaningful for 'work'
  hours: number;                 // scheduled hours, 0 for off/pto
  note?: string;
  isToday: boolean;
}

export interface ScheduleSummary {
  scheduledHours: number; // sum of work hours (PTO excluded)
  shiftCount: number;
  ptoCount: number;
  offCount: number;
}

export interface WeekSummary extends ScheduleSummary {
  workedHours: number;     // elapsed work time, capped at scheduled
  days: ResolvedShiftDay[];
}

const DATE_FORMAT = 'yyyy-MM-dd';

export function toDateKey(date: Date): string {
  return format(date, DATE_FORMAT);
}

export function dayEndTime(startTime: string, hours: number): string {
  const start = parse(startTime, 'HH:mm', new Date());
  return format(addMinutes(start, Math.round(hours * 60)), 'HH:mm');
}

export function resolveDay(
  config: ShiftConfig,
  overridesByDate: Record<string, ShiftOverride>,
  date: Date,
  now: Date = new Date()
): ResolvedShiftDay {
  const dateKey = toDateKey(date);
  const override = overridesByDate[dateKey];
  const isDefaultWorkingDay = config.workingDays.includes(date.getDay());

  let kind: DayKind = isDefaultWorkingDay ? 'work' : 'off';
  let startTime = config.startTime;
  let hours = config.shiftLengthHours;

  if (override) {
    if (override.type === 'pto') {
      kind = 'pto';
      hours = 0;
    } else if (override.type === 'custom_off') {
      kind = 'off';
      hours = 0;
    } else {
      kind = 'work';
      startTime = override.startTime ?? config.startTime;
      hours = override.shiftLengthHours ?? config.shiftLengthHours;
    }
  }

  if (kind !== 'work') hours = 0;

  return {
    date,
    dateKey,
    kind,
    isDefaultWorkingDay,
    hasOverride: Boolean(override),
    overrideType: override?.type,
    startTime,
    endTime: kind === 'work' ? dayEndTime(startTime, hours) : '',
    hours,
    note: override?.note,
    isToday: differenceInCalendarDays(date, now) === 0,
  };
}

/** Monday-start week containing `anchor`. */
export function getWeekDays(
  config: ShiftConfig,
  overridesByDate: Record<string, ShiftOverride>,
  anchor: Date,
  now: Date = new Date()
): ResolvedShiftDay[] {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) =>
    resolveDay(config, overridesByDate, addDays(weekStart, i), now)
  );
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
  };
}

export function getWeekSummary(
  config: ShiftConfig,
  overridesByDate: Record<string, ShiftOverride>,
  anchor: Date,
  now: Date = new Date()
): WeekSummary {
  const days = getWeekDays(config, overridesByDate, anchor, now);
  return {
    ...baseSummary(days),
    workedHours: round1(days.reduce((sum, d) => sum + workedHoursForDay(d, now), 0)),
    days,
  };
}

/** Scheduled-hours summary for the whole calendar month of `anchor`. */
export function getMonthSummary(
  config: ShiftConfig,
  overridesByDate: Record<string, ShiftOverride>,
  anchor: Date,
  now: Date = new Date()
): ScheduleSummary & { label: string } {
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  const days: ResolvedShiftDay[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    days.push(resolveDay(config, overridesByDate, d, now));
  }
  return { ...baseSummary(days), label: format(first, 'MMMM yyyy') };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
