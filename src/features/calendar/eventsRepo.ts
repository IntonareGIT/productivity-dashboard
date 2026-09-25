import { db } from '../../db/db';
import type { CalendarEvent, EventCategory } from '../../types';
import { newId } from '../../utils/id';

export interface EventInput {
  id?: string; // present = update existing
  title: string;
  date: string; // yyyy-MM-dd
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  category: EventCategory;
  description?: string;
}

/** Create or update a calendar event. */
export async function saveEvent(input: EventInput): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error('Event title is required');

  if (input.id) {
    const existing = await db.calendarEvents.get(input.id);
    if (existing) {
      await db.calendarEvents.put({
        ...existing,
        title,
        date: input.date,
        startTime: input.startTime || undefined,
        endTime: input.endTime || undefined,
        category: input.category,
        description: input.description?.trim() || undefined,
      });
      return;
    }
  }

  const record: CalendarEvent = {
    id: newId(),
    title,
    date: input.date,
    startTime: input.startTime || undefined,
    endTime: input.endTime || undefined,
    category: input.category,
    description: input.description?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  await db.calendarEvents.put(record);
}

export async function deleteEvent(id: string): Promise<void> {
  await db.calendarEvents.delete(id);
}

/** Group events by their date key for fast cell lookups. */
export function groupEventsByDate(
  events: CalendarEvent[]
): Record<string, CalendarEvent[]> {
  const map: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    (map[e.date] ??= []).push(e);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => {
      // All-day first, then by start time, then title.
      if (!a.startTime && b.startTime) return -1;
      if (a.startTime && !b.startTime) return 1;
      if (a.startTime && b.startTime && a.startTime !== b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      return a.title.localeCompare(b.title);
    });
  }
  return map;
}
