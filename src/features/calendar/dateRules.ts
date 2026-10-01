/**
 * Date and time rules shared by the assistant's calendar tools.
 *
 * The tools accept ONLY ISO dates (YYYY-MM-DD) and 24-hour times (HH:mm). Words
 * like "tomorrow" or "next Friday" are rejected with a message the model can act
 * on, rather than guessed: a wrong guess silently puts a lecture on the wrong
 * day, which is worse than one extra round trip.
 */

/** True for a real calendar date in YYYY-MM-DD, e.g. rejects 2026-02-30. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const [y, m, d] = value.trim().split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through a UTC Date: this is what rejects 2026-02-30, which would
  // otherwise silently roll over into March.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True for a 24-hour HH:mm time. */
export function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Parse YYYY-MM-DD into a LOCAL Date at midnight, never UTC-shifted. */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as YYYY-MM-DD in LOCAL time. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The window of the day considered for free-slot maths. */
export const DAY_START_MINUTES = 8 * 60;
export const DAY_END_MINUTES = 20 * 60;

/** "HH:mm" from minutes since midnight. */
export function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Whole calendar days from today to `key`; negative when it has passed. */
export function daysUntil(key: string, now: Date): number {
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

/**
 * The context block injected into the system prompt on EVERY request.
 *
 * Without today's date, the timezone and the week start, a model cannot turn
 * "tomorrow" or "next Sunday" into an exact date, and every such request then
 * fails validation. This is what makes the tools usable with ordinary phrasing.
 */
export function dateContext(now: Date, weekStartsOn: number): string {
  let tz = 'unknown';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    // An environment without full ICU: an honest "unknown" beats a crash.
  }
  return [
    `Today is ${dateKey(now)} (${WEEKDAY_NAMES[now.getDay()]}).`,
    `The device timezone is ${tz}.`,
    `A week starts on ${WEEKDAY_NAMES[weekStartsOn]}.`,
    'Resolve "today", "tomorrow", "next Sunday" and "this week" to exact YYYY-MM-DD dates yourself, then pass those dates to the tools. Never pass words like "tomorrow" as a date.',
    'When a date is ambiguous, state the exact date you used in your reply so the user can correct you.',
  ].join(' ');
}
