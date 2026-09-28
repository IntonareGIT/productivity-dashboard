import { format } from 'date-fns';
import type { AssessmentType, TopicStatus, UserStatus } from '../../types';

/**
 * Shared runtime pieces for assistant tools: the error type, the execution
 * result shape, and argument validation. Kept in its own module so `tools.ts`
 * and `toolsExtended.ts` share one definition instead of importing each other.
 */

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolExecution {
  ok: boolean;
  /** One-line human summary (shown in the chat transcript + toast). */
  summary: string;
  /** JSON payload handed back to the model. */
  data: unknown;
  /** Optional toast metadata for the visible confirmation. */
  toast?: { kind: 'success' | 'info' | 'error'; title: string; description?: string };
}

/* ---------------- Argument validation ---------------- */

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = String(args[key] ?? '').trim();
  if (!value) throw new ToolError(`"${key}" is required and must be a non-empty string.`);
  return value;
}

export function normalizeDateKey(raw: unknown, key: string): string {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ToolError(`"${key}" must be a date in yyyy-MM-dd format (got "${value}").`);
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolError(`"${value}" is not a real calendar date.`);
  }
  return format(parsed, 'yyyy-MM-dd');
}

export function normalizeTime(raw: unknown, key = 'time'): string {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new ToolError(`"${value}" is not a valid HH:mm time.`);
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) throw new ToolError(`"${value}" is not a valid HH:mm time.`);
  return `${String(hh).padStart(2, '0')}:${match[2]}`;
}

export function normalizeHours(raw: unknown, key = 'hours'): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 24) {
    throw new ToolError(`"${key}" must be a number between 1 and 24.`);
  }
  return Math.round(value * 100) / 100;
}

export function normalizeOffDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new ToolError('"offDays" must be an array of weekday numbers (0=Sun … 6=Sat).');
  }
  const days = raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) throw new ToolError('Provide at least one off day (0=Sun … 6=Sat).');
  return [...new Set(days)].sort((a, b) => a - b);
}

export const TOPIC_STATUSES: TopicStatus[] = ['not_started', 'studying', 'confident'];
export const ASSESSMENT_TYPES: AssessmentType[] = ['exam', 'quiz', 'assignment', 'project'];
export const EVENT_CATEGORIES = ['class', 'deadline', 'personal', 'work'] as const;
export const USER_STATUSES: UserStatus[] = ['Studying', 'Working', 'Researching', 'Playing'];

export function requireOneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  key: string
): T {
  const value = String(raw ?? '').trim() as T;
  if (!allowed.includes(value)) {
    throw new ToolError(`"${key}" must be one of: ${allowed.join(', ')} (got "${value}").`);
  }
  return value;
}
