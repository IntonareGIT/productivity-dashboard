import { db } from '../../db/db';
import { defaultShiftConfig } from '../../db/defaultData';
import type { ShiftConfig, ShiftOverride, ShiftOverrideType } from '../../types';
import { newId } from '../../utils/id';

/** Merge a patch into the singleton shift config and persist it. */
export async function saveShiftConfig(patch: Partial<ShiftConfig>): Promise<void> {
  const existing = (await db.shiftConfig.get('default')) ?? defaultShiftConfig;
  const next: ShiftConfig = {
    ...existing,
    ...patch,
    id: 'default',
    // Keep workingDays/offDays consistent regardless of which one is patched.
    offDays: [0, 1, 2, 3, 4, 5, 6].filter(
      (d) => !(patch.workingDays ?? existing.workingDays).includes(d)
    ),
    updatedAt: new Date().toISOString(),
  };
  await db.shiftConfig.put(next);
}

export interface OverrideInput {
  date: string; // yyyy-MM-dd
  type: ShiftOverrideType;
  startTime?: string;
  shiftLengthHours?: number;
  note?: string;
}

/**
 * Save the override for a date (exactly one per date: any existing override
 * for the same date is replaced).
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

/** Remove any override for a date, falling back to the default schedule. */
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
