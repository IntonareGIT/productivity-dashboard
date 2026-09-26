import { addDays, differenceInCalendarDays, format, parse, startOfDay } from 'date-fns';
import type { CalendarEvent, RecurrenceType } from '../../types';

/**
 * Recurrence engine (schema v4). Rules live on the parent event only —
 * occurrences are computed on demand for a visible range and never stored
 * as rows. Legacy rows without recurrence fields behave as 'none'.
 */

export interface Occurrence {
  event: CalendarEvent;
  dateKey: string; // yyyy-MM-dd of this occurrence
  date: Date;      // local midnight
}

const DATE_FORMAT = 'yyyy-MM-dd';

export function recurrenceTypeOf(event: CalendarEvent): RecurrenceType {
  return event.recurrenceType ?? 'none';
}

export function isRecurring(event: CalendarEvent): boolean {
  return recurrenceTypeOf(event) !== 'none';
}

export function parseDateKey(dateKey: string): Date {
  return startOfDay(parse(dateKey, DATE_FORMAT, new Date()));
}

export function dayBefore(dateKey: string): string {
  return format(addDays(parseDateKey(dateKey), -1), DATE_FORMAT);
}

/**
 * Dates (yyyy-MM-dd) on which the event occurs inside [rangeStart, rangeEnd].
 * Iteration always starts at the event's anchor so `recurrenceCount`
 * ordinals stay exact even when the range begins later.
 */
export function occurrenceDateKeys(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date
): string[] {
  const anchor = parseDateKey(event.date);
  const type = recurrenceTypeOf(event);

  if (type === 'none') {
    return anchor >= rangeStart && anchor <= rangeEnd ? [format(anchor, DATE_FORMAT)] : [];
  }
  if (rangeEnd < anchor) return [];

  const endLimit = event.recurrenceEndDate ? parseDateKey(event.recurrenceEndDate) : null;
  const maxCount =
    typeof event.recurrenceCount === 'number' && event.recurrenceCount > 0
      ? Math.floor(event.recurrenceCount)
      : null;
  const interval =
    type === 'custom' ? Math.max(1, Math.floor(event.recurrenceInterval ?? 1)) : 1;
  const daysOfWeek =
    type === 'weekly'
      ? event.recurrenceDaysOfWeek && event.recurrenceDaysOfWeek.length > 0
        ? event.recurrenceDaysOfWeek
        : [anchor.getDay()]
      : [];

  const out: string[] = [];
  let count = 0;
  let cursor = anchor;

  while (cursor <= rangeEnd) {
    if (endLimit && cursor > endLimit) break;

    const matches =
      type === 'weekly'
        ? daysOfWeek.includes(cursor.getDay())
        : differenceInCalendarDays(cursor, anchor) % interval === 0;

    if (matches) {
      count += 1;
      if (maxCount !== null && count > maxCount) break;
      if (cursor >= rangeStart) out.push(format(cursor, DATE_FORMAT));
    }
    cursor = addDays(cursor, 1);
  }

  return out;
}

function sortOccurrences(a: Occurrence, b: Occurrence): number {
  const aAllDay = !a.event.startTime;
  const bAllDay = !b.event.startTime;
  if (aAllDay && !bAllDay) return -1;
  if (!aAllDay && bAllDay) return 1;
  if (a.event.startTime && b.event.startTime && a.event.startTime !== b.event.startTime) {
    return a.event.startTime.localeCompare(b.event.startTime);
  }
  return a.event.title.localeCompare(b.event.title);
}

/** Expand every event over the range, grouped by date key for cell lookups. */
export function occurrencesInRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): Record<string, Occurrence[]> {
  const map: Record<string, Occurrence[]> = {};
  for (const event of events) {
    for (const dateKey of occurrenceDateKeys(event, rangeStart, rangeEnd)) {
      (map[dateKey] ??= []).push({ event, dateKey, date: parseDateKey(dateKey) });
    }
  }
  for (const key of Object.keys(map)) map[key].sort(sortOccurrences);
  return map;
}

export function occursOn(event: CalendarEvent, date: Date): boolean {
  return occurrenceDateKeys(event, startOfDay(date), startOfDay(date)).length > 0;
}

/** 1-based position of an occurrence in its series (0 = not an occurrence). */
export function occurrenceOrdinal(event: CalendarEvent, dateKey: string): number {
  const date = parseDateKey(dateKey);
  return occurrenceDateKeys(event, parseDateKey(event.date), date).length;
}

/** Next occurrence strictly after `date`, or null if the series ends. */
export function nextOccurrenceAfter(event: CalendarEvent, dateKey: string): Date | null {
  const from = addDays(parseDateKey(dateKey), 1);
  const horizon = addDays(from, 400); // covers weekly/daily/custom intervals
  const keys = occurrenceDateKeys(event, from, horizon);
  return keys.length > 0 ? parseDateKey(keys[0]) : null;
}

/** First `limit` occurrences at/after `from` (used by the Library list). */
export function upcomingOccurrences(
  events: CalendarEvent[],
  from: Date,
  limit: number
): Occurrence[] {
  const start = startOfDay(from);
  const horizon = addDays(start, 400);
  const all: Occurrence[] = [];
  for (const event of events) {
    for (const dateKey of occurrenceDateKeys(event, start, horizon)) {
      all.push({ event, dateKey, date: parseDateKey(dateKey) });
    }
  }
  all.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || sortOccurrences(a, b));
  return all.slice(0, limit);
}
