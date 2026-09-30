import { format } from 'date-fns';
import { db } from '../../db/db';
import type { CalendarEvent, EventCategory, EventKind, RecurrenceType } from '../../types';
import { newId } from '../../utils/id';
import { normalizePeriod, usesPeriod } from './categories';
import {
  dayBefore,
  isRecurring,
  nextOccurrenceAfter,
  occurrenceOrdinal,
  parseDateKey,
  occursOn,
} from './recurrence';

export interface EventInput {
  id?: string; // present = update existing
  title: string;
  date: string; // yyyy-MM-dd (anchor date for recurring events)
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  category: EventCategory;
  description?: string;
  // recurrence (v4)
  recurrenceType?: RecurrenceType;
  recurrenceInterval?: number | null;
  recurrenceDaysOfWeek?: number[] | null;
  recurrenceEndDate?: string | null;
  recurrenceCount?: number | null;
  subjectId?: string | null;
  // kind + period (v12, additive)
  eventKind?: EventKind | null;
  period?: number | null;
}

/** Editing/deleting a series asks which part is affected. */
export type SeriesScope = 'this' | 'future' | 'all';

type NormalizedFields = Omit<CalendarEvent, 'id' | 'createdAt'>;

/** Clean + normalize form values (rule fields only kept for their type). */
function normalize(input: EventInput): NormalizedFields {
  const title = input.title.trim();
  if (!title) throw new Error('Event title is required');
  const type: RecurrenceType = input.recurrenceType ?? 'none';

  return {
    title,
    date: input.date,
    startTime: input.startTime || undefined,
    endTime: input.endTime || undefined,
    category: input.category,
    description: input.description?.trim() || undefined,
    recurrenceType: type,
    recurrenceInterval:
      type === 'custom' ? Math.max(1, Math.floor(input.recurrenceInterval ?? 1)) : null,
    recurrenceDaysOfWeek:
      type === 'weekly'
        ? input.recurrenceDaysOfWeek && input.recurrenceDaysOfWeek.length > 0
          ? [...input.recurrenceDaysOfWeek].sort((a, b) => a - b)
          : [parseDateKey(input.date).getDay()]
        : null,
    recurrenceEndDate: type === 'none' ? null : input.recurrenceEndDate || null,
    recurrenceCount:
      type === 'none' || !input.recurrenceCount || input.recurrenceCount <= 0
        ? null
        : Math.floor(input.recurrenceCount),
    subjectId: input.subjectId ?? null,
    // A period only means anything for a timetabled kind. Storing `period: 3`
    // on a Studying event would be a contradiction, so it is dropped rather
    // than persisted: the field stays honest about what it represents.
    eventKind: input.eventKind ?? null,
    period: usesPeriod(input.eventKind) ? normalizePeriod(input.period) : null,
  };
}

/** Create or update a calendar event (rule stored once on the parent row). */
export async function saveEvent(input: EventInput): Promise<void> {
  const fields = normalize(input);

  if (input.id) {
    const existing = await db.calendarEvents.get(input.id);
    if (existing) {
      await db.calendarEvents.put({ ...existing, ...fields });
      return;
    }
  }

  await db.calendarEvents.put({
    id: newId(),
    ...fields,
    createdAt: new Date().toISOString(),
  });
}

export async function deleteEvent(id: string): Promise<void> {
  await db.calendarEvents.delete(id);
}

/**
 * Events already occupying a period on a date.
 *
 * A WARNING aid, never a block: the form shows this and still saves, because the
 * user may genuinely have two things in period 3 and that is their call.
 *
 * Only timetabled kinds (lecture / section / lab) are considered. Studying and
 * events with no subject are excluded, since "another lecture in the same period"
 * is the only conflict that means a timetable mistake.
 *
 * `excludeId` keeps an event from conflicting with itself while being edited.
 * The `date` index narrows this to the events anchored on that day; recurring
 * series are matched by checking whether the date is one of their occurrences.
 */
export async function periodConflictsOn(
  date: string,
  period: number | null,
  excludeId?: string
): Promise<CalendarEvent[]> {
  if (period == null) return [];
  const onDate = await db.calendarEvents.where('date').equals(date).toArray();
  return onDate.filter((e) => {
    if (e.id === excludeId) return false;
    if (e.period !== period) return false;
    if (!usesPeriod(e.eventKind)) return false;
    // A recurring parent is anchored on its first date, so an occurrence on
    // `date` may come from a different row. Include it if either way.
    return e.date === date || occursOn(e, parseDateKey(date));
  });
}

/* ---------------- Series-scoped operations (no occurrence rows) ----------------
 * A single parent row can't express a gap, so "this event only" and
 * "this and future" are implemented by splitting the series:
 *   - truncate the parent with recurrenceEndDate (keeps earlier occurrences)
 *   - clone a continuation row anchored at the next occurrence (with the
 *     remaining recurrenceCount), when one is needed.
 */

function continuationOf(
  event: CalendarEvent,
  fields: Partial<CalendarEvent>
): CalendarEvent {
  return {
    ...event,
    ...fields,
    id: newId(),
    createdAt: new Date().toISOString(),
  };
}

function remainingCount(event: CalendarEvent, skipped: number): number | null {
  if (typeof event.recurrenceCount !== 'number' || event.recurrenceCount <= 0) return null;
  return Math.max(0, event.recurrenceCount - skipped);
}

/** Remove a single occurrence from its series. */
async function removeOccurrence(event: CalendarEvent, dateKey: string): Promise<void> {
  const ordinal = occurrenceOrdinal(event, dateKey);
  if (ordinal === 0) return;

  const next = nextOccurrenceAfter(event, dateKey);
  const remaining = remainingCount(event, ordinal);

  if (ordinal === 1) {
    // No earlier occurrences: re-anchor at the next one (or drop the series).
    if (!next) {
      await db.calendarEvents.delete(event.id);
      return;
    }
    await db.calendarEvents.put({
      ...event,
      date: format(next, 'yyyy-MM-dd'),
      recurrenceCount: remaining,
    });
    return;
  }

  // Keep occurrences 1..ordinal-1 …
  await db.calendarEvents.put({ ...event, recurrenceEndDate: dayBefore(dateKey) });
  // … and continue after the removed one.
  if (next) {
    await db.calendarEvents.put(
      continuationOf(event, {
        date: format(next, 'yyyy-MM-dd'),
        recurrenceEndDate: event.recurrenceEndDate ?? null,
        recurrenceCount: remaining,
      })
    );
  }
}

/** Drop this occurrence and everything after it. */
async function truncateFuture(event: CalendarEvent, dateKey: string): Promise<void> {
  const ordinal = occurrenceOrdinal(event, dateKey);
  if (ordinal <= 1) {
    await db.calendarEvents.delete(event.id);
    return;
  }
  await db.calendarEvents.put({ ...event, recurrenceEndDate: dayBefore(dateKey) });
}

export async function deleteEventWithScope(
  event: CalendarEvent,
  occurrenceDateKey: string,
  scope: SeriesScope
): Promise<void> {
  if (scope === 'all' || !isRecurring(event)) {
    await db.calendarEvents.delete(event.id);
    return;
  }
  if (scope === 'future') {
    await truncateFuture(event, occurrenceDateKey);
    return;
  }
  await removeOccurrence(event, occurrenceDateKey);
}

export async function updateEventWithScope(
  event: CalendarEvent,
  occurrenceDateKey: string,
  scope: SeriesScope,
  input: EventInput
): Promise<void> {
  const fields = normalize(input);

  if (scope === 'all' || !isRecurring(event)) {
    await db.calendarEvents.put({ ...event, ...fields });
    return;
  }

  const ordinal = occurrenceOrdinal(event, occurrenceDateKey);

  if (scope === 'future') {
    if (ordinal <= 1) {
      // Editing from the first occurrence = editing the whole series.
      await db.calendarEvents.put({ ...event, ...fields });
      return;
    }
    const next = nextOccurrenceAfter(event, occurrenceDateKey);
    await db.calendarEvents.put({ ...event, recurrenceEndDate: dayBefore(occurrenceDateKey) });
    if (next) {
      await db.calendarEvents.put(
        continuationOf(event, {
          ...fields,
          date: format(next, 'yyyy-MM-dd'),
          recurrenceEndDate: fields.recurrenceEndDate ?? event.recurrenceEndDate ?? null,
          recurrenceCount: remainingCount(event, ordinal),
        })
      );
    }
    return;
  }

  // 'this': a standalone (non-recurring) event on the edited date, with the
  // occurrence removed from the series.
  await db.calendarEvents.put({
    ...event,
    ...fields,
    id: newId(),
    recurrenceType: 'none',
    recurrenceInterval: null,
    recurrenceDaysOfWeek: null,
    recurrenceEndDate: null,
    recurrenceCount: null,
    createdAt: new Date().toISOString(),
  });
  await removeOccurrence(event, occurrenceDateKey);
}
