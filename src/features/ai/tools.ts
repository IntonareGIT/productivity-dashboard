import { addDays, format, isWithinInterval, startOfDay, startOfWeek, subDays } from 'date-fns';
import { db } from '../../db/db';
import type { Assessment, AssessmentType, Resource, Subject, Topic, TopicStatus, UserStatus } from '../../types';
import { occursOn } from '../calendar/recurrence';
import { buildShiftContext, dayEndTime, resolveDay, toDateKey } from '../shifts/shiftLogic';
import { saveWeeklySchedule } from '../shifts/shiftsRepo';
import { usePomodoroStore } from '../../stores/usePomodoroStore';
import {
  SPLIT_VIEW_LABELS,
  describeSplitCommand,
  requestSplitCommand,
  type SplitCommand,
} from '../../stores/useSplitCommandStore';
import {
  DAY_NAMES,
  ToolError,
  normalizeHours,
  normalizeOffDays,
  normalizeTime,
  requireOneOf,
  type ToolExecution,
} from './toolRuntime';
import {
  EXTENDED_TOOL_SPECS,
  describeExtendedToolCall,
  executeExtendedTool,
} from './toolsExtended';
import {
  LIBRARY_CONFIRM_TOOL_NAMES,
  LIBRARY_TOOL_NAMES,
  LIBRARY_TOOL_SPECS,
  describeLibraryToolCall,
  executeLibraryTool,
} from './toolsLibrary';
import { topicPlainText } from '../library/libraryRepo';
import {
  CALENDAR_CONFIRM_TOOL_NAMES,
  CALENDAR_TOOL_NAMES,
  CALENDAR_TOOL_SPECS,
  describeCalendarToolCall,
  executeCalendarTool,
} from './toolsCalendar';
import { isAmbiguous, resolveItem } from './toolResolve';
import { parentOf } from '../library/groupTree';
import type { ToolSpec } from './types';

/**
 * Callable functions exposed to the assistant. Each one performs a REAL
 * operation against Dexie / the app stores — never a mock.
 *
 * `toolsExtended.ts` holds the library/calendar/status functions; the two
 * modules are merged here so the model sees one flat tool list and the
 * dispatcher stays a single switch.
 */

export { ToolError } from './toolRuntime';
export type { ToolExecution } from './toolRuntime';


/** Function names that change stored data. */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'addOrUpdateWeeklySchedule',
  'startPomodoroSession',
  'stopPomodoroSession',
  'setStatus',
  'addCalendarEvent',
  'addResourceLink',
  'createSubject',
  'createTopic',
  'markTopicStatus',
  'addTopicNote',
  'addAssessment',
  'addPTO',
  'addOneOffShiftException',
  'deleteCalendarEvent',
  // Phase 2 library tools. Spread from one source of truth so a new tool
  // cannot be added without also being classified.
  ...LIBRARY_TOOL_NAMES,
  // Phase 4 calendar writes. createEvent, updateEvent, moveEvent,
  // setEventSubject, createAssessment, updateAssessment and
  // createRecurringEvents all change stored rows.
  ...CALENDAR_TOOL_NAMES.filter((n) => !/^(get|list|find)/.test(n)),
]);

/** Destructive / schedule-affecting tools requiring explicit user confirmation. */
export const CONFIRMATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'addOrUpdateWeeklySchedule',
  'addPTO',
  'addOneOffShiftException',
  'deleteCalendarEvent',
  // Every library delete joins the gate. `deleteGroup` is here even though it
  // only ungroups, because it still removes a row the user made, so it asks
  // first. A second model call CANNOT perform it; only Confirm can.
  ...LIBRARY_CONFIRM_TOOL_NAMES,
  // Phase 4: the three calendar deletes, plus createRecurringEvents because it
  // can create up to 60 events and the user must see the list first.
  ...CALENDAR_CONFIRM_TOOL_NAMES,
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
        'Search the Study Library by keyword across subject names, topic titles, topic notes, resource titles and assessment names. Use this before answering questions about the user\'s study material. ' +
        'The result includes a "resources" array of { id, title, type, subject, topic, group } and a "topics" array of { id, title, subject }. ' +
        '"group" is the name of the resource\'s folder within its subject, or null when it is ungrouped — a resource matches a search on its group name too. ' +
        'Any other tool that asks for a resource_id needs the "id" field from these results — never the file name or the title.',
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
      name: 'manage_split_screen',
      description:
        'Control the two-pane split view for side-by-side work: show a PDF, its notes, the dashboard or the assistant in a pane, close the split, or swap the panes. Use searchLibrary first and pass resource_id as the "id" field from its "resources" results — never the file name or the title.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'close', 'swap'],
            description: 'open shows a view in a pane, close returns to a single pane, swap exchanges the two panes.',
          },
          pane: {
            type: 'string',
            enum: ['left', 'right'],
            description: 'Which pane to act on. Optional for close and swap.',
          },
          viewType: {
            type: 'string',
            enum: ['pdf', 'notes', 'dashboard', 'assistant'],
            description: 'What to show in the pane. Required for action "open".',
          },
          resourceId: {
            type: 'string',
            description: 'The study resource (PDF) to preview. Required when viewType is "pdf".',
          },
        },
        required: ['action'],
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
  ...EXTENDED_TOOL_SPECS,
  ...LIBRARY_TOOL_SPECS,
  // Phase 4: the calendar tools for the current calendar (subjects, kinds,
  // periods, day panel, assessments). Spread from one list so a new calendar
  // tool cannot be added without being registered for the model too.
  ...CALENDAR_TOOL_SPECS,
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

  const [subjects, topics, resources, assessments, groups] = await Promise.all([
    db.subjects.toArray(),
    db.topics.toArray(),
    db.resources.toArray(),
    db.assessments.toArray(),
    db.resourceGroups.toArray(),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  // Every row carries `id`, `kind`, its display name and its PARENT (subject
  // name and id), so one search result is enough to call any other tool. The
  // subject bucket previously exposed only a NAME, so the model could not get a
  // subjectId from a search at all, and assessments carried no id whatsoever.
  // Groups are nested now, so a NAME alone no longer identifies one. Every
  // resource result carries its group's full path, both as an id/name array
  // (for further tool calls) and as a readable string (for the reply).
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupPathIds = (groupId: string | null | undefined): { id: string; name: string }[] => {
    if (!groupId) return [];
    const chain: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    let cur = groupId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = groupById.get(cur);
      if (!g) break;
      chain.unshift({ id: g.id, name: g.name });
      cur = parentOf(g);
    }
    return chain;
  };
  const groupPathString = (groupId: string | null | undefined): string | null => {
    const chain = groupPathIds(groupId);
    return chain.length ? chain.map((c) => c.name).join(' / ') : null;
  };

  interface Bucket {
    subjectId: string;
    subject: string;
    matchedSubject: boolean;
    topics: {
      id: string; kind: 'topic'; title: string; status: Topic['status'];
      excerpt: string; subjectId: string; subject: string;
    }[];
    resources: {
      id: string; kind: 'resource'; title: string; resourceKind: Resource['kind'];
      dueDate: string | null; group: string | null; groupId: string | null;
      groupPath: { id: string; name: string }[];
      groupPathString: string | null;
      subjectId: string; subject: string; topicId: string | null; topic: string | null;
    }[];
    assessments: {
      id: string; kind: 'assessment'; name: string; type: Assessment['type'];
      date: string; subjectId: string; subject: string;
    }[];
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (subject: Subject): Bucket => {
    const existing = buckets.get(subject.id);
    if (existing) return existing;
    const created: Bucket = {
      subjectId: subject.id, subject: subject.name, matchedSubject: false,
      topics: [], resources: [], assessments: [],
    };
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
    // Search the plain text of WHICHEVER format the note is stored in. Reading
    // `notes` directly would miss everything typed in the rich-text editor,
    // because a converted note keeps its markdown backup but the user's real
    // text now lives in `contentHtml`.
    const body = topicPlainText(t);
    if (t.title.toLowerCase().includes(q) || body.toLowerCase().includes(q)) {
      const subject = subjects.find((s) => s.id === t.subjectId);
      // The id travels with the topic, and so does its parent subject, so one
      // search result is enough to call any later tool with either id.
      if (subject) {
        bucketFor(subject).topics.push({
          id: t.id, kind: 'topic', title: t.title, status: t.status,
          excerpt: excerpt(body, q), subjectId: subject.id, subject: subject.name,
        });
      }
    }
  }
  // Defensive: a row restored from an older backup can be missing `tags` or
  // `fileName`. Throwing here would take down the whole search — and a tool
  // that throws without a response is exactly how a chat stops talking.
  const matchesResource = (r: Resource) => {
    const tags = Array.isArray(r.tags) ? r.tags : [];
    // A resource matches on its group name too, so "show me the past papers"
    // finds the folder as well as its contents.
    const group = r.groupId ? groupName.get(r.groupId) : undefined;
    return (
      r.title.toLowerCase().includes(q) ||
      (r.fileName ?? '').toLowerCase().includes(q) ||
      tags.some((tag) => String(tag).toLowerCase().includes(q)) ||
      (group ?? '').toLowerCase().includes(q)
    );
  };

  for (const r of resources) {
    if (matchesResource(r)) {
      const subject = subjects.find((s) => s.id === r.subjectId);
      if (subject) {
        const topic = r.topicId ? topics.find((t) => t.id === r.topicId) : undefined;
        bucketFor(subject).resources.push({
          id: r.id,
          // `kind` is now the ITEM kind, so it is uniform across topics,
          // resources and assessments. The resource's own link/file type moved
          // to `resourceKind` rather than overloading the word.
          kind: 'resource',
          title: r.title,
          resourceKind: r.kind,
          dueDate: r.dueDate ?? null,
          group: (r.groupId ? groupName.get(r.groupId) : undefined) ?? null,
          // The full group path, so a model (and a reader) can tell two
          // same-named groups apart once nesting is allowed.
          groupId: r.groupId ?? null,
          groupPath: groupPathIds(r.groupId),
          groupPathString: groupPathString(r.groupId),
          subjectId: subject.id, subject: subject.name,
          topicId: topic?.id ?? null, topic: topic?.title ?? null,
        });
      }
    }
  }
  for (const a of assessments) {
    if (a.name.toLowerCase().includes(q)) {
      const subject = subjects.find((s) => s.id === a.subjectId);
      if (subject) {
        bucketFor(subject).assessments.push({
          // Assessments previously carried no id at all, so there was no way to
          // act on one afterwards. The id is what makes updateAssessment and
          // deleteAssessment possible.
          id: a.id, kind: 'assessment', name: a.name, type: a.type,
          date: a.date, subjectId: subject.id, subject: subject.name,
        });
      }
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

  // A FLAT, id-carrying list of every matching resource. The bucketed view above
  // is grouped by subject and is fine for a human, but the model must be able to
  // take an `id` straight from it and hand it to another tool. This is what
  // stops it inventing one: without a real id to copy it has nothing but the
  // file name, and passes that as an id, which then fails to resolve.
  const resourceList = resources
    .filter(matchesResource)
    .slice(0, 25)
    .map((r) => {
      const subject = subjects.find((s) => s.id === r.subjectId);
      const topic = topics.find((t) => t.id === r.topicId);
      return {
        id: r.id,
        title: r.title,
        type: r.kind,
        subject: subject?.name ?? null,
        topic: topic?.title ?? null,
      };
    });

  const topicList = topics
    .filter((t) => t.title.toLowerCase().includes(q) || topicPlainText(t).toLowerCase().includes(q))
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      title: t.title,
      subject: subjects.find((s) => s.id === t.subjectId)?.name ?? null,
    }));

  return {
    ok: true,
    summary:
      results.length === 0
        ? `No library matches for “${query}”.`
        : `Found ${resourceList.length} resource(s) and ${topicList.length} topic(s) for “${query}”. Pass an id from "resources" (or "topics") to any tool that asks for one.`,
    // `resources` / `topics` are the actionable, id-carrying lists the model
    // should read first; `results` keeps the grouped, excerpt-rich view.
    data: { query, resources: resourceList, topics: topicList, results },
  };
}


/* ---------------- Mutating functions ---------------- */

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



/* ---------------- Split-screen multitasking ---------------- */

/**
 * Drive the two-pane split view — open a pane on a chosen view, close it, or
 * swap the panes.
 *
 * The actual layout lives in `App` as React state, so this QUEUES a command and
 * `App` applies it with the very same `splitModel` functions the UI uses
 * (`addSecondPane` / `setPane` / `swapPanes`). The tool never mutates layout
 * itself, which is what keeps AI-driven and user-driven splits identical.
 */
async function manageSplitScreen(args: Record<string, unknown>): Promise<ToolExecution> {
  const action = requireOneOf(args.action, ['open', 'close', 'swap'] as const, 'action');
  const paneRaw = String(args.pane ?? '').trim();
  // `pane` is optional for close/swap: a closed split has no sides, and a swap
  // is symmetric. Validate it when it IS supplied so a typo cannot silently
  // mean "left".
  const pane = paneRaw === '' ? undefined : requireOneOf(paneRaw, ['left', 'right'] as const, 'pane');
  const viewRaw = String(args.viewType ?? '').trim();
  const viewType = viewRaw === ''
    ? undefined
    : requireOneOf(viewRaw, ['pdf', 'notes', 'dashboard', 'assistant'] as const, 'viewType');
  const resourceId = String(args.resourceId ?? '').trim() || undefined;

  if (action === 'open' && !viewType && !resourceId) {
    throw new ToolError('Opening a pane needs a "viewType" (and a "resourceId" for a PDF).');
  }

  // Resolve a real resource through the ONE shared resolver. This had its own
  // hand-rolled copy (id, then exact title, then contains) which was a third
  // variation on the same idea; it now behaves identically to every other tool,
  // including returning candidates on ambiguity rather than a dead end.
  let resource: Resource | undefined;
  let ambiguousIds: { id: string; name: string }[] = [];
  if (resourceId) {
    const r = resolveItem<Resource>({
      kind: 'resource',
      ref: resourceId,
      rows: await db.resources.toArray(),
      nameOf: (row) => row.title,
      label: 'resource',
    });
    if ('row' in r) resource = r.row;
    else if (isAmbiguous(r)) ambiguousIds = r.candidates;
  }

  // Several plausible matches is not an error to throw away: return the
  // candidates WITH their ids so the model can pick one and call again.
  if (ambiguousIds.length > 0) {
    return {
      ok: false,
      summary: `“${resourceId}” matches ${ambiguousIds.length} resources. Call again with one of these ids.`,
      data: {
        error: 'ambiguous_resource',
        query: resourceId,
        candidates: ambiguousIds.map((c) => ({ id: c.id, title: c.name, type: 'resource' })),
      },
    };
  }

  if (resourceId && !resource) {
    throw new ToolError(
      `No resource matches “${resourceId}”, and nothing is titled like it. `
      + `Call searchLibrary and pass the "id" field from its "resources" results — never the file name. `
      + `Nothing was changed.`
    );
  }

  // A PDF pane is meaningless without a document, and notes need a topic.
  let topicId: string | undefined;
  if (viewType === 'pdf') {
    if (!resource) throw new ToolError('A PDF pane needs a "resourceId" — search the library first.');
    if (!resource.blob) {
      throw new ToolError(`“${resource.title}” has no stored file on this device, so it cannot be previewed.`);
    }
  }
  if (viewType === 'notes') {
    topicId = resource?.topicId ?? undefined;
    if (!topicId) {
      throw new ToolError('A notes pane needs a topic. Open a resource that belongs to a topic, or name the topic.');
    }
  }

  const cmd: Omit<SplitCommand, 'id'> = { action, pane, viewType, resourceId: resource?.id, topicId };
  const id = requestSplitCommand(cmd);
  const label = describeSplitCommand(cmd);
  const side = pane === 'right' ? 'right' : 'left';

  const summary =
    action === 'close'
      ? 'Closing the split view and returning to a single pane.'
      : action === 'swap'
        ? 'Swapping the two panes.'
        : viewType === 'pdf'
          ? `Opening “${resource?.title}” in the ${side} pane.`
          : `Opening ${SPLIT_VIEW_LABELS[viewType ?? 'dashboard']} in the ${side} pane.`;

  return {
    ok: true,
    summary,
    data: { requested: cmd, commandId: id, pane: side, action },
    toast: { kind: 'info', title: label.replace(/…$/, ''), description: summary },
  };
}


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
    case 'manage_split_screen':
      return describeSplitCommand({
        action: (String(args.action ?? 'open') as SplitCommand['action']),
        pane: args.pane as SplitCommand['pane'],
        viewType: args.viewType as SplitCommand['viewType'],
      });
    default:
      if (LIBRARY_TOOL_NAMES.has(name)) return describeLibraryToolCall(name, args);
      if (CALENDAR_TOOL_NAMES.includes(name)) return describeCalendarToolCall(name, argsJson);
      return describeExtendedToolCall(name, args);
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
    case 'manage_split_screen':
      return manageSplitScreen(args);
    default: {
      // The calendar tools for the CURRENT calendar (Phase 4) are checked
      // before the older modules, so the new names always win.
      if (CALENDAR_TOOL_NAMES.includes(name)) return executeCalendarTool(name, args);
      // Library write / delete functions live in toolsLibrary.ts.
      const library = await executeLibraryTool(name, args);
      if (library) return library;
      // Library / calendar / status functions live in toolsExtended.ts.
      const extended = await executeExtendedTool(name, args);
      if (extended) return extended;
      throw new ToolError(`Unknown function “${name}”.`);
    }
  }
}
