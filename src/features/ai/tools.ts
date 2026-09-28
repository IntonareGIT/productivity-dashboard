import { addDays, format, isWithinInterval, startOfDay, startOfWeek } from 'date-fns';
import { db } from '../../db/db';
import type { Assessment, Resource, Subject, Topic } from '../../types';
import { occursOn } from '../calendar/recurrence';
import { buildShiftContext, dayEndTime, resolveDay, toDateKey } from '../shifts/shiftLogic';
import { saveWeeklySchedule } from '../shifts/shiftsRepo';
import { usePomodoroStore } from '../../stores/usePomodoroStore';
import type { ToolSpec } from './types';

/**
 * Callable functions exposed to the assistant. Each one performs a REAL
 * operation against Dexie / the app stores — never a mock.
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
  /** Optional toast metadata for the visible confirmation (#9). */
  toast?: { kind: 'success' | 'info' | 'error'; title: string; description?: string };
}

/** Function names that change stored data. */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'addOrUpdateWeeklySchedule',
  'startPomodoroSession',
  'stopPomodoroSession',
]);

/** Destructive / schedule-affecting tools requiring explicit user confirmation. */
export const CONFIRMATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'addOrUpdateWeeklySchedule',
]);

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'getTodaysSchedule',
      description:
        "Get today's work shift (or day off/PTO/unscheduled), today's calendar events and minutes already focused today.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getUpcomingDeadlines',
      description:
        'List pending study-resource due dates and upcoming assessments (exams, quizzes, assignments, projects) inside a look-ahead window.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, description: 'Look-ahead window in days (default 14).' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchLibrary',
      description:
        'Search the Study Library by keyword across subject names, topic titles, topic notes, resource titles and assessment names. Use this before answering questions about the user\'s study material.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Keyword or phrase to search for.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addOrUpdateWeeklySchedule',
      description:
        'Create or replace the work roster for ONE specific Mon–Sun week: which two days are off, the shift start time and the shift length. Only that week is affected. The user must confirm before this runs.',
      parameters: {
        type: 'object',
        properties: {
          weekStartDate: { type: 'string', description: 'Monday of the target week as yyyy-MM-dd. Omit to use the current week.' },
          offDays: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 6 },
            description: 'Days off — 0=Sun, 1=Mon … 6=Sat.',
          },
          shiftStartTime: { type: 'string', description: 'Shift start time in 24h HH:mm.' },
          shiftLengthHours: { type: 'number', description: 'Shift length in hours (e.g. 9).' },
        },
        required: ['offDays', 'shiftStartTime', 'shiftLengthHours'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startPomodoroSession',
      description: 'Start a focus (pomodoro) timer for the given number of minutes.',
      parameters: {
        type: 'object',
        properties: {
          durationMinutes: { type: 'integer', minimum: 1, maximum: 180, description: 'Focus length in minutes.' },
          label: { type: 'string', description: 'Optional label describing what is being focused on.' },
        },
        required: ['durationMinutes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stopPomodoroSession',
      description: 'Stop the running focus timer and return it to idle.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

/* ---------------- Read-only functions ---------------- */

function shiftLabel(day: ReturnType<typeof resolveDay>): string {
  if (day.kind === 'pto') return 'Paid Time Off (no shift)';
  if (day.kind === 'off') return 'Scheduled day off';
  if (day.kind === 'unscheduled') return 'Week not scheduled yet';
  return `${day.startTime}–${day.endTime} (${day.hours}h)${day.hasOverride ? ' — one-off adjustment' : ''}`;
}

async function getTodaysSchedule(): Promise<ToolExecution> {
  const today = new Date();
  const key = toDateKey(today);
  const [schedules, overrides, events, sessions] = await Promise.all([
    db.weeklySchedules.toArray(),
    db.shiftOverrides.toArray(),
    db.calendarEvents.toArray(),
    db.pomodoroSessions.where('date').equals(key).toArray(),
  ]);

  const day = resolveDay(buildShiftContext(overrides, schedules), today);
  const todaysEvents = events
    .filter((e) => occursOn(e, today))
    .map((e) => ({
      title: e.title,
      category: e.category,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
    }))
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const focusMinutes = sessions
    .filter((s) => s.sessionType === 'focus')
    .reduce((sum, s) => sum + s.durationMinutes, 0);

  const data = {
    date: key,
    weekday: format(today, 'EEEE'),
    shift: {
      status: day.kind,
      startTime: day.kind === 'work' ? day.startTime : null,
      endTime: day.kind === 'work' ? day.endTime : null,
      hours: day.hours,
      note: day.note ?? null,
    },
    events: todaysEvents,
    focusMinutesToday: focusMinutes,
  };

  return {
    ok: true,
    summary: `Today (${format(today, 'EEE d MMM')}): shift — ${shiftLabel(day)}; ${todaysEvents.length} calendar event(s); ${focusMinutes} focus minute(s) logged.`,

    data,
  };
}

async function getUpcomingDeadlines(args: Record<string, unknown>): Promise<ToolExecution> {
  const rawDays = Number(args.days ?? 14);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.round(rawDays))) : 14;

  const from = startOfDay(new Date());
  const to = addDays(from, days);
  const [resources, assessments, subjects] = await Promise.all([
    db.resources.toArray(),
    db.assessments.toArray(),
    db.subjects.toArray(),
  ]);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? 'Unknown subject';
  const inWindow = (dateKey: string) => {
    const d = new Date(`${dateKey}T00:00:00`);
    return isWithinInterval(d, { start: from, end: to });
  };

  const resourceItems = resources
    .filter((r) => Boolean(r.dueDate) && !r.completed && inWindow(r.dueDate as string))
    .map((r) => ({
      kind: 'resource' as const,
      title: r.title,
      date: r.dueDate as string,
      subject: subjectName(r.subjectId),
      tags: r.tags,
    }));

  const assessmentItems = assessments
    .filter((a) => a.status === 'upcoming' && inWindow(a.date))
    .map((a) => ({
      kind: 'assessment' as const,
      title: `${a.name} (${a.type})`,
      date: a.date,
      subject: subjectName(a.subjectId),
      weight: a.weight ?? null,
    }));

  const items = [...resourceItems, ...assessmentItems].sort((a, b) => a.date.localeCompare(b.date));

  return {
    ok: true,
    summary:
      items.length === 0
        ? `Nothing due in the next ${days} day(s).`
        : `${items.length} upcoming item(s) in the next ${days} day(s): ${items
            .slice(0, 4)
            .map((i) => `${i.date} ${i.title}`)
            .join('; ')}${items.length > 4 ? ' …' : ''}`,
    data: { window: { from: toDateKey(from), to: toDateKey(to) }, days, items },
  };
}

async function searchLibrary(args: Record<string, unknown>): Promise<ToolExecution> {
  const query = String(args.query ?? '').trim();
  if (!query) throw new ToolError('searchLibrary needs a non-empty "query".');
  const q = query.toLowerCase();

  const [subjects, topics, resources, assessments] = await Promise.all([
    db.subjects.toArray(),
    db.topics.toArray(),
    db.resources.toArray(),
    db.assessments.toArray(),
  ]);

  interface Bucket {
    subject: string;
    matchedSubject: boolean;
    topics: { title: string; status: Topic['status']; excerpt: string }[];
    resources: { title: string; kind: Resource['kind']; dueDate: string | null }[];
    assessments: { name: string; type: Assessment['type']; date: string }[];
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (subject: Subject): Bucket => {
    const existing = buckets.get(subject.id);
    if (existing) return existing;
    const created: Bucket = { subject: subject.name, matchedSubject: false, topics: [], resources: [], assessments: [] };
    buckets.set(subject.id, created);
    return created;
  };

  const excerpt = (text: string, term: string): string => {
    const idx = text.toLowerCase().indexOf(term);
    if (idx < 0) return text.slice(0, 140);
    const start = Math.max(0, idx - 50);
    return `${start > 0 ? '…' : ''}${text.slice(start, start + 160).trim()}${text.length > start + 160 ? '…' : ''}`;
  };

  for (const s of subjects) {
    if (s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)) {
      bucketFor(s).matchedSubject = true;
    }
  }
  for (const t of topics) {
    if (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)) {
      const subject = subjects.find((s) => s.id === t.subjectId);
      if (subject) bucketFor(subject).topics.push({ title: t.title, status: t.status, excerpt: excerpt(t.notes, q) });
    }
  }
  for (const r of resources) {
    const hit = r.title.toLowerCase().includes(q) || (r.fileName ?? '').toLowerCase().includes(q) || r.tags.some((tag) => tag.toLowerCase().includes(q));
    if (hit) {
      const subject = subjects.find((s) => s.id === r.subjectId);
      if (subject) bucketFor(subject).resources.push({ title: r.title, kind: r.kind, dueDate: r.dueDate ?? null });
    }
  }
  for (const a of assessments) {
    if (a.name.toLowerCase().includes(q)) {
      const subject = subjects.find((s) => s.id === a.subjectId);
      if (subject) bucketFor(subject).assessments.push({ name: a.name, type: a.type, date: a.date });
    }
  }

  const results = [...buckets.values()]
    .map((b) => ({
      ...b,
      topics: b.topics.slice(0, 5),
      resources: b.resources.slice(0, 5),
      assessments: b.assessments.slice(0, 5),
    }))
    .slice(0, 6);

  return {
    ok: true,
    summary:
      results.length === 0
        ? `No library matches for “${query}”.`
        : `Found matches in ${results.length} subject(s) for “${query}”.`,
    data: { query, results },
  };
}


/* ---------------- Mutating functions ---------------- */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeOffDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new ToolError('"offDays" must be an array of weekday numbers (0=Sun … 6=Sat).');
  }
  const days = raw
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) {
    throw new ToolError('Provide at least one off day (0=Sun … 6=Sat).');
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function normalizeTime(raw: unknown): string {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new ToolError(`"${value}" is not a valid HH:mm time.`);
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) throw new ToolError(`"${value}" is not a valid HH:mm time.`);
  return `${String(hh).padStart(2, '0')}:${match[2]}`;
}

function normalizeHours(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 24) {
    throw new ToolError('"shiftLengthHours" must be a number between 1 and 24.');
  }
  return Math.round(value * 100) / 100;
}

async function addOrUpdateWeeklySchedule(args: Record<string, unknown>): Promise<ToolExecution> {
  const weekStartDate = args.weekStartDate
    ? format(startOfWeek(new Date(`${String(args.weekStartDate)}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    : format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const offDays = normalizeOffDays(args.offDays);
  const shiftStartTime = normalizeTime(args.shiftStartTime);
  const shiftLengthHours = normalizeHours(args.shiftLengthHours);

  const existing = await db.weeklySchedules.where('weekStartDate').equals(weekStartDate).first();
  await saveWeeklySchedule({ weekStartDate, offDays, shiftStartTime, shiftLengthHours });

  const endTime = dayEndTime(shiftStartTime, shiftLengthHours);
  const offLabel = offDays.map((d) => DAY_NAMES[d]).join(', ');
  const summary = `${existing ? 'Updated' : 'Created'} the roster for the week of ${weekStartDate}: ${shiftStartTime}–${endTime} (${shiftLengthHours}h), off ${offLabel}.`;

  return {
    ok: true,
    summary,
    data: { weekStartDate, offDays, shiftStartTime, shiftLengthHours, endTime, replacedExisting: Boolean(existing) },
    toast: {
      kind: 'success',
      title: existing ? 'Weekly schedule updated' : 'Weekly schedule created',
      description: `${weekStartDate} · ${shiftStartTime}–${endTime} · off ${offLabel}`,
    },
  };
}

async function startPomodoroSession(args: Record<string, unknown>): Promise<ToolExecution> {
  const raw = Number(args.durationMinutes);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new ToolError('"durationMinutes" must be a positive number.');
  }
  const minutes = Math.min(180, Math.max(1, Math.round(raw)));
  const label = String(args.label ?? '').trim();

  const store = usePomodoroStore.getState();
  if (label) store.setSubject(label);
  store.startFocusWithDuration(minutes);

  return {
    ok: true,
    summary: `Focus timer started for ${minutes} minute(s)${label ? ` on “${label}”` : ''}.`,
    data: { durationMinutes: minutes, label: label || null },
    toast: {
      kind: 'success',
      title: 'Focus timer started',
      description: `${minutes} min${label ? ` · ${label}` : ''}`,
    },
  };
}

async function stopPomodoroSession(): Promise<ToolExecution> {
  const store = usePomodoroStore.getState();
  const wasRunning = store.isRunning;
  store.stopTimer();
  return {
    ok: true,
    summary: wasRunning ? 'Focus timer stopped and returned to idle.' : 'No timer was running — the focus timer is idle.',
    data: { wasRunning },
    toast: { kind: 'info', title: wasRunning ? 'Focus timer stopped' : 'Focus timer already idle' },
  };
}



/* ---------------- Dispatcher ---------------- */

/** Human-readable one-liner for the confirmation step / transcript. */
export function describeToolCall(name: string, argsJson: string): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(argsJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    // fall through with empty args — description stays generic
  }

  switch (name) {
    case 'addOrUpdateWeeklySchedule': {
      const off = Array.isArray(args.offDays)
        ? (args.offDays as unknown[]).map((d) => DAY_NAMES[Number(d)] ?? '?').join(', ') || '—'
        : '—';
      const start = String(args.shiftStartTime ?? '—');
      const hours = args.shiftLengthHours != null ? `${args.shiftLengthHours}h` : '—';
      const week = args.weekStartDate ? `week of ${String(args.weekStartDate)}` : 'current week';
      return `Write the work roster for the ${week}: start ${start}, ${hours}, days off ${off}.`;
    }
    case 'startPomodoroSession':
      return `Start a ${String(args.durationMinutes ?? '?')}-minute focus timer.`;
    case 'stopPomodoroSession':
      return 'Stop the running focus timer.';
    case 'getTodaysSchedule':
      return "Read today's shift, events and focus time.";
    case 'getUpcomingDeadlines':
      return `Read pending deadlines for the next ${String(args.days ?? 14)} day(s).`;
    case 'searchLibrary':
      return `Search the library for “${String(args.query ?? '')}”.`;
    default:
      return `Run ${name}.`;
  }
}

/** Execute one model-requested function against real app data. */
export async function executeTool(name: string, argsJson: string): Promise<ToolExecution> {
  let args: Record<string, unknown> = {};
  const raw = (argsJson ?? '').trim();
  if (raw && raw !== '{}') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      throw new ToolError(`Could not parse the arguments for ${name}.`);
    }
  }

  switch (name) {
    case 'getTodaysSchedule':
      return getTodaysSchedule();
    case 'getUpcomingDeadlines':
      return getUpcomingDeadlines(args);
    case 'searchLibrary':
      return searchLibrary(args);
    case 'addOrUpdateWeeklySchedule':
      return addOrUpdateWeeklySchedule(args);
    case 'startPomodoroSession':
      return startPomodoroSession(args);
    case 'stopPomodoroSession':
      return stopPomodoroSession();
    default:
      throw new ToolError(`Unknown function “${name}”.`);
  }
}
