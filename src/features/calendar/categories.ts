import type { EventCategory } from '../../types';

/**
 * Fixed (theme-independent) category colors, matching the requirement that
 * only color tokens change between themes — category hues stay constant.
 */
export interface CategoryMeta {
  value: EventCategory;
  label: string;
  /** pill/badge classes for event chips */
  badge: string;
  /** small dot classes for compact month cells */
  dot: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    value: 'class',
    label: 'Class',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  {
    value: 'deadline',
    label: 'Deadline',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
  {
    value: 'personal',
    label: 'Personal',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  {
    value: 'work',
    label: 'Work',
    badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
];

export const CATEGORY_MAP: Record<EventCategory, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c }),
  {} as Record<EventCategory, CategoryMeta>
);

/* ---------------- Event kind and period (schema v12) ---------------- */

/**
 * What KIND of thing an event is.
 *
 * `none` is the default and is what every existing event reads as, so nothing
 * changes for rows created before this field existed. Stored additively as
 * `eventKind` next to the existing `subjectId` link; there is no second way to
 * express this.
 */
export type EventKind = 'studying' | 'lecture' | 'section' | 'lab';

export const EVENT_KINDS: EventKind[] = ['studying', 'lecture', 'section', 'lab'];

/** Human labels. Kept here so the form, chips and the assistant never diverge. */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  studying: 'Studying',
  lecture: 'Lecture',
  section: 'Section',
  lab: 'Lab',
};

/**
 * Kinds that occupy a timetabled PERIOD, and therefore show the Period picker
 * and get their times from PERIODS. Studying is deliberately excluded: it is
 * self-directed study, so the user picks their own times.
 */
export const PERIOD_KINDS: EventKind[] = ['lecture', 'section', 'lab'];

export function usesPeriod(kind: EventKind | undefined | null): boolean {
  return kind != null && PERIOD_KINDS.includes(kind);
}

/**
 * The day the app considers the start of the week.
 *
 * Declared ONCE here and reused by the calendar page, the shifts page and the
 * assistant tools. It was previously repeated as `weekStartsOn: 1` and a
 * hand-rolled "Monday" calculation in several files, which is exactly how a
 * tool ends up disagreeing with the UI about which week it means.
 */
export const WEEK_STARTS_ON = 1 as const; // 1 = Monday

/** A single teaching-period span, used to detect overlaps and free slots. */
export interface TimeSpan {
  start: string;
  end: string;
}

/** Minutes since midnight for an "HH:mm" string, or null if unparseable. */
export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True when two spans share any time. Touching ends do NOT count as overlap. */
export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  const as = toMinutes(a.start);
  const ae = toMinutes(a.end);
  const bs = toMinutes(b.start);
  const be = toMinutes(b.end);
  if (as == null || ae == null || bs == null || be == null) return false;
  return as < be && bs < ae;
}

/**
 * The six teaching periods, in ONE place.
 *
 * Every consumer — the event form, the calendar chips, the day panel and the
 * assistant's create/edit tools — reads these times from here. That is the point
 * of the constant: if the timetable ever changes, it changes once, and the
 * assistant cannot invent times that disagree with the UI.
 *
 * Each period is 1h40m, separated by a 10 minute break. 08:30 + 6 periods,
 * 10 minutes apart, ends at 19:20.
 */
export interface Period {
  /** 1..6 */
  n: number;
  start: string; // HH:mm, 24-hour
  end: string;
}

export const PERIODS: Period[] = [
  { n: 1, start: '08:30', end: '10:10' },
  { n: 2, start: '10:20', end: '12:00' },
  { n: 3, start: '12:10', end: '13:50' },
  { n: 4, start: '14:00', end: '15:40' },
  { n: 5, start: '15:50', end: '17:30' },
  { n: 6, start: '17:40', end: '19:20' },
];

/** The period with this number, or null when out of range. */
export function periodByNumber(n: number | null | undefined): Period | null {
  if (n == null) return null;
  return PERIODS.find((p) => p.n === n) ?? null;
}

/** Accepts a model-supplied or user-supplied value and normalises it. */
export function normalizePeriod(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > PERIODS.length) return null;
  return n;
}
