import { addWeeks, format, startOfWeek } from 'date-fns';
import { db } from '../../db/db';
import type { ShiftOverride, ShiftOverrideType, WeeklySchedule } from '../../types';
import { newId } from '../../utils/id';

/* ---------------- Weekly schedules (schema v3) ---------------- */

export interface WeeklyScheduleInput {
  weekStartDate: string; // Monday (yyyy-MM-dd)
  offDays: number[];
  shiftStartTime: string;
  shiftLengthHours: number;
}

/**
 * Create or update THE record for one specific week (upsert keyed by
 * weekStartDate). Editing a week never touches any other week's record.
 */
export async function saveWeeklySchedule(input: WeeklyScheduleInput): Promise<void> {
  const offDays = [...new Set(input.offDays)].sort();
  const now = new Date().toISOString();
  const existing = await db.weeklySchedules
    .where('weekStartDate')
    .equals(input.weekStartDate)
    .first();

  if (existing) {
    await db.weeklySchedules.put({
      ...existing,
      offDays,
      shiftStartTime: input.shiftStartTime,
      shiftLengthHours: input.shiftLengthHours,
      updatedAt: now,
    });
  } else {
    const record: WeeklySchedule = {
      id: newId(),
      weekStartDate: input.weekStartDate,
      offDays,
      shiftStartTime: input.shiftStartTime,
      shiftLengthHours: input.shiftLengthHours,
      createdAt: now,
      updatedAt: now,
    };
    await db.weeklySchedules.put(record);
  }
}

/** Remove one week's record only — that week becomes unscheduled. */
export async function deleteWeeklySchedule(id: string): Promise<void> {
  await db.weeklySchedules.delete(id);
}

export function indexSchedulesByWeek(
  schedules: WeeklySchedule[]
): Record<string, WeeklySchedule> {
  const map: Record<string, WeeklySchedule> = {};
  for (const s of schedules) map[s.weekStartDate] = s;
  return map;
}

/**
 * First Monday (starting from `from`) that has no schedule record yet —
 * used as the default week for the "Add schedule" action.
 */
export function findUnassignedWeekStart(
  schedules: WeeklySchedule[],
  from: Date = new Date()
): string {
  const taken = new Set(schedules.map((s) => s.weekStartDate));
  let candidate = startOfWeek(from, { weekStartsOn: 1 });
  for (let i = 0; i < 104; i++) {
    const key = format(candidate, 'yyyy-MM-dd');
    if (!taken.has(key)) return key;
    candidate = addWeeks(candidate, 1);
  }
  return format(startOfWeek(from, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/* ---------------- One-off overrides (unchanged) ---------------- */

export interface OverrideInput {
  date: string; // yyyy-MM-dd
  type: ShiftOverrideType;
  startTime?: string;
  shiftLengthHours?: number;
  note?: string;
}

/**
 * Save the override for a date (exactly one per date: any existing override
 * for the same date is replaced). Overrides apply on top of whichever
 * week's base schedule is active for that date.
 */
export async function setOverrideForDate(input: OverrideInput): Promise<void> {
  const existing = await db.shiftOverrides.where('date').equals(input.date).toArray();
  if (existing.length > 0) {
    await db.shiftOverrides.bulkDelete(existing.map((o) => o.id));
  }
  const record: ShiftOverride = {
    id: newId(),
    date: input.date,
    type: input.type,
    startTime: input.startTime,
    shiftLengthHours: input.shiftLengthHours,
    note: input.note?.trim() ? input.note.trim() : undefined,
    createdAt: new Date().toISOString(),
  };
  await db.shiftOverrides.put(record);
}

/** Remove any override for a date, falling back to the week's schedule. */
export async function clearOverrideForDate(date: string): Promise<void> {
  const existing = await db.shiftOverrides.where('date').equals(date).toArray();
  if (existing.length > 0) {
    await db.shiftOverrides.bulkDelete(existing.map((o) => o.id));
  }
}

/** Index overrides by date for shiftLogic lookups. */
export function indexOverridesByDate(
  overrides: ShiftOverride[]
): Record<string, ShiftOverride> {
  const map: Record<string, ShiftOverride> = {};
  for (const o of overrides) map[o.date] = o;
  return map;
}
