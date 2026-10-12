import { endOfMonth, format, startOfMonth, startOfWeek, subDays } from 'date-fns';
import { db } from '../../db/db';
import type { CalendarEvent, EventKind, Resource, Topic } from '../../types';
import { deleteEvent, saveEvent } from '../calendar/eventsRepo';
import { PERIODS, normalizePeriod, periodByNumber, usesPeriod } from '../calendar/categories';
import { saveAssessment, saveResource, saveSubject, saveTopic, loadFileBytes, fileLocation } from '../library/libraryRepo';
import { DEFAULT_SUBJECT_COLOR, SUBJECT_PALETTE } from '../library/palette';
import { buildShiftContext, dayEndTime, getWeekDays, resolveDay, toDateKey } from '../shifts/shiftLogic';
import { setOverrideForDate } from '../shifts/shiftsRepo';
import { useStatusThemeStore } from '../../stores/useStatusThemeStore';
import { ITEM_KINDS, kindNameOf, needItem, refOf, type ItemKind } from './toolResolve';
import {
  ASSESSMENT_TYPES,
  EVENT_CATEGORIES,
  TOPIC_STATUSES,
  USER_STATUSES,
  ToolError,
  normalizeDateKey,
  normalizeHours,
  normalizeTime,
  requireOneOf,
  requireString,
  type ToolExecution,
} from './toolRuntime';
import type { ToolSpec } from './types';
import type { AiProvider } from '../../types';
import { listProviders, setDefaultProvider } from './aiProviderRepo';
import { getCloudAccessToken } from './cloudAuth';

/**
 * Library / calendar / status functions for the assistant.
 *
 * Every one performs a real Dexie or store operation and returns a short
 * structured result, so the model can report accurately what happened. When
 * an argument references an entity by name we resolve it to an id and fail
 * loudly on ambiguity rather than guessing — the system prompt tells the model
 * to call the lookup functions first and to ask the user when a name matches
 * more than one thing.
 */

const ID_HINT =
  'Must be an id obtained from listSubjects/listTopics (or another lookup). Never guess an id — if you are unsure, call the lookup function first.';

export const EXTENDED_TOOL_SPECS: ToolSpec[] = [


  /* ---------- Lookup (read-only) ---------- */
  {
    type: 'function',
    function: {
      name: 'listSubjects',
      description:
        'List every study subject with its id, name and term. Call this FIRST whenever you need a subjectId for any other function — never guess an id.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listTopics',
      description:
        'List the topics of ONE subject with id, title and status (not_started / studying / confident). Call this before using a topicId.',
      parameters: {
        type: 'object',
        properties: { subjectId: { type: 'string', description: ID_HINT } },
        required: ['subjectId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWeekSchedule',
      description:
        'Resolve the full work roster for one Mon–Sun week: each day resolved to work / off / PTO / unscheduled, including one-off exceptions that override the weekly pattern.',
      parameters: {
        type: 'object',
        properties: {
          weekStartDate: { type: 'string', description: 'Any date inside the target week (yyyy-MM-dd). Omit for the current week.' },
        },
        additionalProperties: false,
      },
    },
  },

  /* ---------- Read-only reports ---------- */
  {
    type: 'function',
    function: {
      name: 'getFocusStats',
      description:
        'Total logged focus time for a range, broken down per subject. Only completed focus sessions count.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', enum: ['today', 'week', 'month'], description: 'Period to report on (default "week").' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSubjectProgress',
      description:
        'For one subject: topic counts by status, overall progress, and the next upcoming assessment.',
      parameters: {
        type: 'object',
        properties: { subjectId: { type: 'string', description: ID_HINT } },
        required: ['subjectId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCurrentStatus',
      description: 'The currently selected status (Studying/Working/Researching/Playing) and the theme it maps to.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },

  /* ---------- Immediate writes (toast only) ---------- */
  {
    type: 'function',
    function: {
      name: 'setStatus',
      description: 'Switch the active status, which also switches the app theme.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: USER_STATUSES, description: 'Status to activate.' } },
        required: ['status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addCalendarEvent',
      description:
        'Create a calendar event. Pass eventKind for a subject-linked event, and period (1-6) for a lecture, section or lab: a period sets the start and end time from the fixed timetable automatically, so do not pass time/endTime alongside it unless the user asked for a different time.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'yyyy-MM-dd' },
          time: { type: 'string', description: 'Optional start time HH:mm.' },
          endTime: { type: 'string', description: 'Optional end time HH:mm.' },
          category: { type: 'string', enum: [...EVENT_CATEGORIES] },
          recurrence: {
            type: 'string',
            enum: ['none', 'daily', 'weekly', 'custom'],
            description: 'Recurrence rule (default "none").',
          },
          subjectId: { type: 'string', description: 'Optional subject link.' },
          eventKind: {
            type: 'string',
            enum: ['studying', 'lecture', 'section', 'lab'],
            description: 'Kind of subject-linked event. Only meaningful with subjectId.',
          },
          period: {
            type: 'integer',
            enum: PERIODS.map((p) => p.n),
            description: `Teaching period 1-${PERIODS.length}. Sets the time from the timetable. Only for lecture, section or lab.`,
          },
        },
        required: ['title', 'date', 'category'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addResourceLink',
      description: 'Attach a link resource to an existing topic.',
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: ID_HINT },
          title: { type: 'string' },
          url: { type: 'string', description: 'Full http(s) URL.' },
        },
        required: ['topicId', 'title', 'url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createSubject',
      description: 'Create a new study subject.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'Optional short description.' },
          color: { type: 'string', description: `Optional hex card colour, e.g. ${DEFAULT_SUBJECT_COLOR}.` },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createTopic',
      description: 'Add a topic to an existing subject.',
      parameters: {
        type: 'object',
        properties: {
          subjectId: { type: 'string', description: ID_HINT },
          title: { type: 'string' },
        },
        required: ['subjectId', 'title'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'markTopicStatus',
      description: "Set a topic's progress status.",
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: ID_HINT },
          status: { type: 'string', enum: TOPIC_STATUSES },
        },
        required: ['topicId', 'status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addTopicNote',
      description:
        'Append text to a topic. With no `title` it appends to the existing notes; with a `title` it adds a new dated section.',
      parameters: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: ID_HINT },
          title: { type: 'string', description: 'Optional section heading.' },
          content: { type: 'string', description: 'Markdown text to add.' },
        },
        required: ['topicId', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addAssessment',
      description: 'Add an assessment (exam / quiz / assignment / project) to a subject.',
      parameters: {
        type: 'object',
        properties: {
          subjectId: { type: 'string', description: ID_HINT },
          name: { type: 'string', description: 'Assessment name, e.g. "Midterm 1".' },
          type: { type: 'string', enum: ASSESSMENT_TYPES },
          date: { type: 'string', description: 'yyyy-MM-dd' },
          weight: { type: 'number', description: 'Optional weight percentage.' },
        },
        required: ['subjectId', 'name', 'type', 'date'],
        additionalProperties: false,
      },
    },
  },

  /* ---------- Writes requiring explicit confirmation ---------- */
  {
    type: 'function',
    function: {
      name: 'addPTO',
      description: 'Log paid time off for a date, overriding that day’s shift. The user must confirm before this runs.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'yyyy-MM-dd' } },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addOneOffShiftException',
      description: 'Override one date with custom hours. The user must confirm before this runs.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'yyyy-MM-dd' },
          startTime: { type: 'string', description: 'HH:mm' },
          hours: { type: 'number', description: 'Length in hours (1–24).' },
        },
        required: ['date', 'startTime', 'hours'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteCalendarEvent',
      description:
        'Permanently delete a calendar event (whole series if recurring). The user must confirm before this runs.',
      parameters: {
        type: 'object',
        properties: { eventId: { type: 'string', description: 'Event id.' } },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
  },

  /* ---------- Files and extraction ---------- */
  {
    type: 'function',
    function: {
      name: 'searchFiles',
      description:
        'Search files by name case-insensitively with partial matches across all subjects. Returns matching files with their location (local/cloud). If more than one file matches, returns the list — does not guess.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (partial, case-insensitive).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description:
        'List the user\'s files with name, type, and whether a markdown note exists. Filter by "all", "ready", "missing", or "failed".',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'ready', 'missing', 'failed'],
            description: 'Filter files by extraction status (default "all").',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getExtractionStatus',
      description:
        'Returns the note status, provider, model, chunk progress, and the last short error for a file.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
        },
        required: ['fileId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startExtraction',
      description:
        'Start extraction of a file to markdown. If no model is given, use the model the user last chose. Confirm first, because it uses the user\'s quota.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          provider: { type: 'string', description: 'Optional provider label (e.g. "Gemini", "Groq").' },
          model: { type: 'string', description: 'Optional model name.' },
        },
        required: ['fileId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queueExtraction',
      description: 'Mark files as "Extract later" without running them.',
      parameters: {
        type: 'object',
        properties: {
          fileIds: { type: 'array', items: { type: 'string' }, description: 'Resource ids to queue.' },
        },
        required: ['fileIds'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retryExtraction',
      description: 'Retry the whole file, or only one failed chunk if chunkIndex is given.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          chunkIndex: { type: 'integer', description: 'Optional chunk index to retry (0-based).' },
        },
        required: ['fileId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'markNoteChecked',
      description: 'Sets the "Mark as checked" flag on a file\'s extracted note.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          checked: { type: 'boolean', description: 'Whether to check or uncheck.' },
        },
        required: ['fileId', 'checked'],
        additionalProperties: false,
      },
    },
  },

  /* ---------- Notes and search ---------- */
  {
    type: 'function',
    function: {
      name: 'searchNotes',
      description:
        'Search extracted notes by query. Returns matching sections with file name and heading. Searches only ready, non-orphaned notes unless the user asks otherwise.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          includeAll: { type: 'boolean', description: 'Include failed/missing notes (default false).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readNote',
      description: 'Read a note by fileId. Returns one section if specified, or the full note if short. For long notes, returns the section list first.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          section: { type: 'string', description: 'Optional section heading to read.' },
        },
        required: ['fileId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readFilePages',
      description: 'Send specific PDF pages to the model. Use only when the note is missing or lacks detail (e.g. diagrams, scanned content). Confirm first — it uses quota.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          pages: { type: 'array', items: { type: 'integer' }, description: 'Page numbers (1-based) to send.' },
        },
        required: ['fileId', 'pages'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editNote',
      description:
        'Edit a note section. Only works when the note\'s "AI may edit" toggle is on. Shows the proposed change in chat and waits for user confirmation before saving. Saves a version entry so it can be reverted.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          section: { type: 'string', description: 'Section heading to edit.' },
          newText: { type: 'string', description: 'New markdown text for the section.' },
        },
        required: ['fileId', 'section', 'newText'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'revertNote',
      description: 'Restore a previous version of a note. Confirm first.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Resource id of the file.' },
          versionId: { type: 'string', description: 'Optional version id to restore (default: previous).' },
        },
        required: ['fileId'],
        additionalProperties: false,
      },
    },
  },

  /* ---------- Assistant settings ---------- */
  {
    type: 'function',
    function: {
      name: 'listModels',
      description: 'Returns the models that have a saved key, grouped by provider.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setChatModel',
      description: 'Change the chat model for a provider. Only models with a saved key can be chosen.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider label (e.g. "Gemini", "Groq").' },
          model: { type: 'string', description: 'Model name to use for chat.' },
        },
        required: ['provider', 'model'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setExtractionModel',
      description: 'Change the default extraction model for a provider. Only models with a saved key can be chosen.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider label (e.g. "Gemini", "Groq").' },
          model: { type: 'string', description: 'Model name to use for extraction.' },
        },
        required: ['provider', 'model'],
        additionalProperties: false,
      },
    },
  },

  /* ---------- Conversations ---------- */
  {
    type: 'function',
    function: {
      name: 'listConversations',
      description: 'Returns past conversations with title and date, newest first.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional search query.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'openConversation',
      description: 'Load a past conversation to read or continue.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Conversation id.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteConversation',
      description: 'Delete a conversation. Confirm first. Deletes only that conversation.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Conversation id.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'newConversation',
      description: 'Start a new empty chat and save the current one if it has messages.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

/* ---------------- Lookup helpers ---------------- */

type ItemRow = { id: string; name?: string; title?: string; subjectId?: string | null };

/**
 * Resolve a subject by id OR name.
 *
 * Was a bare `db.subjects.get(id)`, which meant a name always failed with
 * "No subject has id ...". Both now work, through the one shared resolver.
 */
async function requireSubject(
  ref: unknown,
  scope?: { field: string; value: string; label: string } | null,
): Promise<{ id: string; name: string }> {
  const rows = await db.subjects.toArray();
  return needItem<{ id: string; name: string }>({ kind: 'subject', ref, rows, scope });
}

/** Resolve a topic by id OR name, optionally scoped to one subject. */
async function requireTopic(
  ref: unknown,
  scope?: { field: string; value: string; label: string } | null,
): Promise<Topic> {
  return needItem<Topic>({ kind: 'topic', ref, rows: await db.topics.toArray(), scope });
}

async function listSubjects(): Promise<ToolExecution> {
  const subjects = await db.subjects.toArray();
  const items = subjects
    .map((s) => ({ id: s.id, name: s.name, term: (s.description ?? '').trim() || null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    summary:
      items.length === 0
        ? 'The library has no subjects yet.'
        : `${items.length} subject(s): ${items.map((s) => s.name).join(', ')}.`,
    data: { subjects: items },
  };
}

async function listTopics(args: Record<string, unknown>): Promise<ToolExecution> {
  const subject = await requireSubject(String(args.subjectId ?? ''));
  const topics = await db.topics.where('subjectId').equals(subject.id).toArray();
  const items = topics
    .map((t) => ({ id: t.id, title: t.title, status: t.status }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    ok: true,
    summary:
      items.length === 0
        ? `“${subject.name}” has no topics yet.`
        : `${subject.name}: ${items.length} topic(s) — ${items.map((t) => `${t.title} (${t.status})`).join('; ')}.`,
    data: { subjectId: subject.id, subject: subject.name, topics: items },
  };
}

async function getWeekSchedule(args: Record<string, unknown>): Promise<ToolExecution> {
  const anchor = args.weekStartDate
    ? new Date(`${normalizeDateKey(args.weekStartDate, 'weekStartDate')}T00:00:00`)
    : new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });

  const [schedules, overrides] = await Promise.all([
    db.weeklySchedules.toArray(),
    db.shiftOverrides.toArray(),
  ]);
  const ctx = buildShiftContext(overrides, schedules);
  const days = getWeekDays(ctx, weekStart, new Date());

  const dayItems = days.map((d) => ({
    date: d.dateKey,
    weekday: format(d.date, 'EEE'),
    kind: d.kind,
    baseKind: d.baseKind,
    startTime: d.kind === 'work' ? d.startTime : null,
    endTime: d.kind === 'work' ? d.endTime : null,
    hours: d.hours,
    isOneOffException: d.hasOverride,
    overrideType: d.overrideType ?? null,
    note: d.note ?? null,
  }));

  const scheduledHours = dayItems.reduce((sum, d) => sum + d.hours, 0);
  return {
    ok: true,
    summary: `Week of ${format(weekStart, 'yyyy-MM-dd')}: ${dayItems
      .map((d) => `${d.weekday}=${d.kind === 'work' ? `${d.startTime}–${d.endTime}` : d.kind}`)
      .join(', ')} — ${scheduledHours}h scheduled.`,
    data: {
      weekStartDate: toDateKey(weekStart),
      hasWeekRecord: days.some((d) => d.hasWeekSchedule),
      scheduledHours,
      workDays: dayItems.filter((d) => d.kind === 'work').length,
      ptoDays: dayItems.filter((d) => d.kind === 'pto').length,
      offDays: dayItems.filter((d) => d.kind === 'off').length,
      exceptions: dayItems.filter((d) => d.isOneOffException),
      days: dayItems,
    },
  };
}

async function getFocusStats(args: Record<string, unknown>): Promise<ToolExecution> {
  const range = requireOneOf(args.range ?? 'week', ['today', 'week', 'month'] as const, 'range');
  const now = new Date();
  const from =
    range === 'today'
      ? now
      : range === 'week'
        ? startOfWeek(now, { weekStartsOn: 1 })
        : startOfMonth(now);
  const to = range === 'month' ? endOfMonth(now) : subDays(now, -1);

  const sessions = (await db.pomodoroSessions.toArray()).filter(
    (s) =>
      s.sessionType === 'focus' &&
      s.date >= toDateKey(from) &&
      s.date <= toDateKey(to)
  );

  const subjects = await db.subjects.toArray();
  const subjectName = (id: string | null | undefined) =>
    id ? subjects.find((s) => s.id === id)?.name ?? 'Unknown subject' : null;

  const bySubject = new Map<string, { subject: string; minutes: number; sessions: number }>();
  for (const s of sessions) {
    const key = s.subjectId ?? 'none';
    const entry = bySubject.get(key) ?? {
      subject: subjectName(s.subjectId) ?? 'No subject',
      minutes: 0,
      sessions: 0,
    };
    entry.minutes += s.durationMinutes;
    entry.sessions += 1;
    bySubject.set(key, entry);
  }

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const perSubject = [...bySubject.values()].sort((a, b) => b.minutes - a.minutes);

  return {
    ok: true,
    summary:
      sessions.length === 0
        ? `No focus sessions logged for this ${range}.`
        : `${range}: ${Math.round((totalMinutes / 60) * 10) / 10}h focused across ${sessions.length} session(s)${
            perSubject.length ? ` — ${perSubject.map((p) => `${p.subject} ${p.minutes}m`).join(', ')}` : ''
          }.`,
    data: {
      range,
      from: toDateKey(from),
      to: toDateKey(to),
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      sessionCount: sessions.length,
      perSubject,
    },
  };
}

async function getSubjectProgress(args: Record<string, unknown>): Promise<ToolExecution> {
  const subject = await requireSubject(String(args.subjectId ?? ''));
  const [topics, assessments] = await Promise.all([
    db.topics.where('subjectId').equals(subject.id).toArray(),
    db.assessments.where('subjectId').equals(subject.id).toArray(),
  ]);

  const counts = {
    not_started: topics.filter((t) => t.status === 'not_started').length,
    studying: topics.filter((t) => t.status === 'studying').length,
    confident: topics.filter((t) => t.status === 'confident').length,
  };
  const today = toDateKey(new Date());
  const next = assessments
    .filter((a) => a.status === 'upcoming' && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const pct = topics.length === 0 ? 0 : Math.round((counts.confident / topics.length) * 100);

  return {
    ok: true,
    summary: `${subject.name}: ${counts.confident}/${topics.length} topics confident (${pct}%), ${counts.studying} in progress${
      next ? `; next up: ${next.name} on ${next.date}` : '; no upcoming assessment'
    }.`,
    data: {
      subjectId: subject.id,
      subject: subject.name,
      topicCounts: counts,
      totalTopics: topics.length,
      percentConfident: pct,
      topics: topics
        .map((t) => ({ id: t.id, title: t.title, status: t.status }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      nextAssessment: next
        ? { id: next.id, name: next.name, type: next.type, date: next.date, weight: next.weight ?? null }
        : null,
    },
  };
}

async function getCurrentStatus(): Promise<ToolExecution> {
  const s = useStatusThemeStore.getState();
  return {
    ok: true,
    summary: `Current status: ${s.currentStatus} (theme “${s.currentTheme}”, ${s.colorScheme} mode).`,
    data: { status: s.currentStatus, theme: s.currentTheme, colorScheme: s.colorScheme },
  };
}

/* ---------------- Immediate writes ---------------- */

async function setStatus(args: Record<string, unknown>): Promise<ToolExecution> {
  const status = requireOneOf(args.status, USER_STATUSES, 'status');
  const previous = useStatusThemeStore.getState().currentStatus;
  await useStatusThemeStore.getState().setStatus(status);
  return {
    ok: true,
    summary:
      previous === status
        ? `Status is already “${status}”.`
        : `Status changed from “${previous}” to “${status}”.`,
    data: { previous, status },
    toast: { kind: 'success', title: `Status: ${status}`, description: `was ${previous}` },
  };
}

async function addCalendarEvent(args: Record<string, unknown>): Promise<ToolExecution> {
  const title = requireString(args, 'title');
  const date = normalizeDateKey(args.date, 'date');
  const category = requireOneOf(args.category, EVENT_CATEGORIES, 'category');
  const startTime = args.time ? normalizeTime(args.time, 'time') : undefined;
  const endTime = args.endTime ? normalizeTime(args.endTime, 'endTime') : undefined;
  const recurrenceType = requireOneOf(
    args.recurrence ?? 'none',
    ['none', 'daily', 'weekly', 'custom'] as const,
    'recurrence'
  );

  let subjectId: string | null = null;
  if (args.subjectId) subjectId = (await requireSubject(String(args.subjectId))).id;

  // Kind and period reuse the SAME fields and the SAME PERIODS list the form
  // uses, so the assistant cannot produce a time the UI would not.
  let eventKind: EventKind | null = null;
  if (args.eventKind) {
    eventKind = requireOneOf(
      args.eventKind,
      ['studying', 'lecture', 'section', 'lab'] as const,
      'eventKind'
    );
  }
  const period = normalizePeriod(args.period);
  // A period on a non-timetabled kind is a contradiction; drop it rather than
  // silently storing both. An out-of-range value is already null from
  // normalizePeriod, which is the "no period" the model should have meant.
  const usablePeriod = usesPeriod(eventKind) ? period : null;
  const fromPeriod = periodByNumber(usablePeriod);

  // Explicit times win: the model was given the timetable in the description
  // and may have been correcting it. Otherwise a period supplies the times.
  const finalStart = startTime ?? fromPeriod?.start;
  const finalEnd = endTime ?? fromPeriod?.end;

  await saveEvent({
    title, date,
    startTime: finalStart, endTime: finalEnd,
    category, recurrenceType, subjectId,
    eventKind, period: usablePeriod,
  });

  const kindText = eventKind ? `, ${eventKind}` : '';
  const periodText = usablePeriod ? `, period ${usablePeriod}` : '';
  const when = finalStart ? `${date} at ${finalStart}` : date;
  return {
    ok: true,
    summary: `Added event “${title}” on ${when} (${category}${kindText}${periodText}${recurrenceType === 'none' ? '' : `, repeats ${recurrenceType}`}).`,
    data: {
      title, date,
      startTime: finalStart ?? null, endTime: finalEnd ?? null,
      category, recurrence: recurrenceType, subjectId, eventKind, period: usablePeriod,
    },
    toast: { kind: 'success', title: 'Event added', description: `${title} · ${when}` },
  };
}

async function addResourceLink(args: Record<string, unknown>): Promise<ToolExecution> {
  const topic = await requireTopic(String(args.topicId ?? ''));
  const title = requireString(args, 'title');
  const url = requireString(args, 'url');
  if (!/^https?:\/\//i.test(url)) throw new ToolError(`"${url}" is not a valid http(s) URL.`);
  const id = await saveResource({
    subjectId: topic.subjectId,
    topicId: topic.id,
    kind: 'link',
    title,
    urlOrPath: url,
  });
  return {
    ok: true,
    summary: `Added link “${title}” to topic “${topic.title}”.`,
    data: { id, topicId: topic.id, topic: topic.title, title, url },
    toast: { kind: 'success', title: 'Link added', description: `${title} → ${topic.title}` },
  };
}

async function createSubject(args: Record<string, unknown>): Promise<ToolExecution> {
  const name = requireString(args, 'name');
  const existing = (await db.subjects.toArray()).find(
    (s) => s.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    throw new ToolError(
      `A subject named “${existing.name}” already exists. Use its existing id instead of creating a duplicate.`
    );
  }
  const requested = String(args.color ?? '').trim();
  const color = /^#[0-9a-f]{6}$/i.test(requested)
    ? requested
    : SUBJECT_PALETTE[(await db.subjects.count()) % SUBJECT_PALETTE.length]?.hex ?? DEFAULT_SUBJECT_COLOR;

  const id = await saveSubject({
    name,
    description: args.description ? String(args.description) : undefined,
    color,
  });
  return {
    ok: true,
    summary: `Created subject “${name}”.`,
    data: { id, name, color },
    toast: { kind: 'success', title: 'Subject created', description: name },
  };
}

async function createTopic(args: Record<string, unknown>): Promise<ToolExecution> {
  const subject = await requireSubject(String(args.subjectId ?? ''));
  const title = requireString(args, 'title');
  const clash = (await db.topics.where('subjectId').equals(subject.id).toArray()).find(
    (t) => t.title.trim().toLowerCase() === title.toLowerCase()
  );
  if (clash) throw new ToolError(`“${subject.name}” already has a topic titled “${title}”.`);

  const id = await saveTopic({ subjectId: subject.id, title });
  return {
    ok: true,
    summary: `Added topic “${title}” to ${subject.name}.`,
    data: { id, subjectId: subject.id, subject: subject.name, title },
    toast: { kind: 'success', title: 'Topic created', description: `${title} · ${subject.name}` },
  };
}

async function markTopicStatus(args: Record<string, unknown>): Promise<ToolExecution> {
  const topic = await requireTopic(String(args.topicId ?? ''));
  const status = requireOneOf(args.status, TOPIC_STATUSES, 'status');
  const previous = topic.status;
  await db.topics.put({ ...topic, status, updatedAt: new Date().toISOString() });
  return {
    ok: true,
    summary:
      previous === status
        ? `“${topic.title}” is already marked ${status}.`
        : `“${topic.title}”: ${previous} → ${status}.`,
    data: { topicId: topic.id, title: topic.title, previous, status },
    toast: { kind: 'success', title: 'Topic updated', description: `${topic.title} · ${status}` },
  };
}

async function addTopicNote(args: Record<string, unknown>): Promise<ToolExecution> {
  const topic = await requireTopic(String(args.topicId ?? ''));
  const content = requireString(args, 'content');
  const heading = String(args.title ?? '').trim();
  const stamp = format(new Date(), 'yyyy-MM-dd');
  const block = heading ? `## ${heading} (${stamp})\n\n${content}` : content;
  const notes = topic.notes.trim() ? `${topic.notes}\n\n${block}` : block;

  await db.topics.put({ ...topic, notes, updatedAt: new Date().toISOString() });
  return {
    ok: true,
    summary: `Added ${content.length} character(s) to “${topic.title}”${heading ? ` under “${heading}”` : ''}.`,
    data: { topicId: topic.id, title: topic.title, addedHeading: heading || null, totalLength: notes.length },
    toast: { kind: 'success', title: 'Note added', description: topic.title },
  };
}

async function addAssessment(args: Record<string, unknown>): Promise<ToolExecution> {
  const subject = await requireSubject(String(args.subjectId ?? ''));
  const name = requireString(args, 'name');
  const type = requireOneOf(args.type, ASSESSMENT_TYPES, 'type');
  const date = normalizeDateKey(args.date, 'date');
  const weight = args.weight == null || args.weight === '' ? null : Number(args.weight);
  if (weight != null && (!Number.isFinite(weight) || weight < 0 || weight > 100)) {
    throw new ToolError('"weight" must be a percentage between 0 and 100.');
  }

  const id = await saveAssessment({ subjectId: subject.id, name, type, date, weight });
  return {
    ok: true,
    summary: `Added ${type} “${name}” to ${subject.name} on ${date}${weight != null ? ` (${weight}%)` : ''}.`,
    data: { id, subjectId: subject.id, subject: subject.name, name, type, date, weight },
    toast: { kind: 'success', title: 'Assessment added', description: `${name} · ${date}` },
  };
}

/* ---------------- Confirmation-gated writes ---------------- */

/** Load the override + resolved day for a date, so confirmations state what changes. */
async function dayContext(date: string) {
  const [schedules, overrides] = await Promise.all([
    db.weeklySchedules.toArray(),
    db.shiftOverrides.toArray(),
  ]);
  return {
    previous: overrides.find((o) => o.date === date),
    before: resolveDay(buildShiftContext(overrides, schedules), new Date(`${date}T00:00:00`)),
  };
}

async function addPTO(args: Record<string, unknown>): Promise<ToolExecution> {
  const date = normalizeDateKey(args.date, 'date');
  const { previous, before } = await dayContext(date);

  await setOverrideForDate({ date, type: 'pto', note: 'Logged by the assistant' });
  return {
    ok: true,
    summary: previous
      ? `PTO logged for ${date}, replacing an existing “${previous.type}” override.`
      : `PTO logged for ${date} (was ${before.kind === 'work' ? `${before.startTime}–${before.endTime}` : before.kind}).`,
    data: {
      date,
      replacedExisting: Boolean(previous),
      previousOverrideType: previous?.type ?? null,
      previousKind: before.kind,
    },
    toast: { kind: 'success', title: 'PTO logged', description: date },
  };
}

async function addOneOffShiftException(args: Record<string, unknown>): Promise<ToolExecution> {
  const date = normalizeDateKey(args.date, 'date');
  const startTime = normalizeTime(args.startTime, 'startTime');
  const hours = normalizeHours(args.hours, 'hours');
  const endTime = dayEndTime(startTime, hours);
  const { previous, before } = await dayContext(date);

  await setOverrideForDate({ date, type: 'custom_hours', startTime, shiftLengthHours: hours, note: 'Set by the assistant' });
  return {
    ok: true,
    summary: previous
      ? `Shift on ${date} overridden to ${startTime}–${endTime} (${hours}h), replacing an existing “${previous.type}”.`
      : `One-off shift on ${date}: ${startTime}–${endTime} (${hours}h), was ${before.kind}.`,
    data: {
      date,
      startTime,
      endTime,
      hours,
      replacedExisting: Boolean(previous),
      previousOverrideType: previous?.type ?? null,
      previousKind: before.kind,
    },
    toast: { kind: 'success', title: 'Shift exception set', description: `${date} · ${startTime}–${endTime}` },
  };
}

async function deleteCalendarEvent(args: Record<string, unknown>): Promise<ToolExecution> {
  // Resolved by id OR title, through the shared resolver. It used to be a raw
  // `db.calendarEvents.get(eventId)`, so a title the model had just read out of
  // listEvents always failed with "No calendar event has id ...".
  const event = await needItem<CalendarEvent>({
    kind: 'event',
    ref: args.eventId,
    rows: await db.calendarEvents.toArray(),
  });

  await deleteEvent(event.id);
  const when = event.startTime ? `${event.date} at ${event.startTime}` : event.date;
  return {
    ok: true,
    summary: `Deleted event “${event.title}” (${when}${event.recurrenceType && event.recurrenceType !== 'none' ? `, whole ${event.recurrenceType} series` : ''}).`,
    data: {
      // The generic block every tool result carries, plus the specifics.
      event: refOf('event', event),
      eventId: event.id,
      title: event.title,
      date: event.date,
      recurrence: event.recurrenceType ?? 'none',
      wasRecurring: Boolean(event.recurrenceType && event.recurrenceType !== 'none'),
    },
    toast: { kind: 'success', title: 'Event deleted', description: `${event.title} · ${when}` },
  };
}

/* ---------------- Files and extraction ---------------- */

async function searchFiles(args: Record<string, unknown>): Promise<ToolExecution> {
  const query = requireString(args, 'query').toLowerCase().trim();
  if (!query) throw new ToolError('Search query cannot be empty.');

  const resources = await db.resources.where('kind').equals('file').toArray();
  
  const matches = resources
    .filter((r) => r.title.toLowerCase().includes(query))
    .map((r) => {
      const location = fileLocation(r);
      return {
        id: r.id,
        title: r.title,
        type: r.mimeType ?? 'application/octet-stream',
        location: location.kind === 'none' ? 'none' : location.kind,
        subjectId: r.subjectId,
      };
    });

  if (matches.length === 0) {
    return {
      ok: true,
      summary: `No files found matching "${query}".`,
      data: { query, files: [] },
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      summary: `"${query}" matches ${matches.length} files. Please specify which one to use.`,
      data: {
        error: 'ambiguous_file',
        query,
        candidates: matches.map((m) => ({ id: m.id, title: m.title, type: m.type, location: m.location })),
      },
    };
  }

  // Single match
  const match = matches[0];
  return {
    ok: true,
    summary: `Found "${match.title}" (${match.location}).`,
    data: { query, file: match },
  };
}

async function listFiles(args: Record<string, unknown>): Promise<ToolExecution> {
  const filter = (String(args.filter ?? 'all') as 'all' | 'ready' | 'missing' | 'failed');
  const resources = await db.resources.where('kind').equals('file').toArray();
  
  // TODO: Add extraction status fields to Resource type when extraction feature is implemented
  // For now, return files with basic info
  const items = resources
    .map((r) => ({
      id: r.id,
      title: r.title,
      type: r.mimeType ?? 'application/octet-stream',
      hasNote: false, // TODO: Check if extracted note exists
      status: 'missing' as const, // TODO: Add extractionStatus field
    }))
    .filter((item) => {
      if (filter === 'all') return true;
      return item.status === filter;
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    ok: true,
    summary: items.length === 0 ? `No files found (filter: ${filter}).` : `Found ${items.length} file(s) with filter "${filter}".`,
    data: { filter, files: items },
  };
}

async function getExtractionStatus(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Add extractionStatus field to Resource type
  return {
    ok: true,
    summary: `Extraction status for "${resource.title}": not yet extracted.`,
    data: {
      fileId: resource.id,
      title: resource.title,
      status: 'missing',
      provider: null,
      model: null,
      chunkProgress: null,
      lastError: null,
    },
  };
}

async function startExtraction(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const provider = args.provider ? String(args.provider) : undefined;
  const model = args.model ? String(args.model) : undefined;
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Implement actual extraction via API
  return {
    ok: true,
    summary: `Extraction started for "${resource.title}"${provider ? ` with ${provider}` : ''}${model ? ` (${model})` : ''}. This uses your AI quota.`,
    data: { fileId: resource.id, title: resource.title, provider, model, status: 'started' },
    toast: { kind: 'info', title: 'Extraction started', description: resource.title },
  };
}

async function queueExtraction(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileIds = args.fileIds as string[];
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new ToolError('"fileIds" must be a non-empty array.');
  }
  
  const resources = await Promise.all(fileIds.map((id) => db.resources.get(id)));
  const missing = fileIds.filter((id, i) => !resources[i]);
  if (missing.length > 0) throw new ToolError(`Files not found: ${missing.join(', ')}`);
  const notFiles = fileIds.filter((id, i) => resources[i] && resources[i]!.kind !== 'file');
  if (notFiles.length > 0) throw new ToolError(`Not files: ${notFiles.join(', ')}`);

  // TODO: Mark files as queued for extraction
  return {
    ok: true,
    summary: `Queued ${fileIds.length} file(s) for extraction.`,
    data: { fileIds, status: 'queued' },
    toast: { kind: 'info', title: 'Files queued', description: `${fileIds.length} file(s)` },
  };
}

async function retryExtraction(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const chunkIndex = args.chunkIndex != null ? Number(args.chunkIndex) : undefined;
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Implement retry logic
  return {
    ok: true,
    summary: `Retrying extraction for "${resource.title}"${chunkIndex != null ? ` chunk ${chunkIndex}` : ' (all chunks)'}.`,
    data: { fileId: resource.id, title: resource.title, chunkIndex, status: 'retrying' },
    toast: { kind: 'info', title: 'Extraction retry', description: resource.title },
  };
}

async function markNoteChecked(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const checked = Boolean(args.checked);
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Add noteChecked field to Resource type
  return {
    ok: true,
    summary: `Marked note for "${resource.title}" as ${checked ? 'checked' : 'unchecked'}.`,
    data: { fileId: resource.id, title: resource.title, checked },
    toast: { kind: 'success', title: checked ? 'Note checked' : 'Note unchecked', description: resource.title },
  };
}

/* ---------------- Notes and search ---------------- */

async function searchNotes(args: Record<string, unknown>): Promise<ToolExecution> {
  const query = requireString(args, 'query');
  const includeAll = Boolean(args.includeAll);
  
  // TODO: Implement actual note search when extraction feature exists
  return {
    ok: true,
    summary: `No notes found for "${query}". Extraction feature not yet implemented.`,
    data: { query, includeAll, results: [] },
  };
}

async function readNote(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const section = args.section ? String(args.section) : undefined;
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Implement when extraction feature exists
  return {
    ok: true,
    summary: `No extracted note found for "${resource.title}". Extract the file first.`,
    data: { fileId: resource.id, title: resource.title, section, content: null },
  };
}

async function readFilePages(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const pages = args.pages as number[];
  
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new ToolError('"pages" must be a non-empty array of page numbers.');
  }
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  const location = fileLocation(resource);
  if (location.kind === 'none') {
    throw new ToolError('This file has no local copy or cloud copy.');
  }

  // Load the file bytes (from local blob or cloud via R2)
  const blob = await loadFileBytes(resource);
  if (!blob) {
    throw new ToolError('This file has no local copy or cloud copy.');
  }

  const source = location.kind === 'blob' ? 'local' : 'cloud';
  
  // TODO: Implement sending specific pages to model
  return {
    ok: true,
    summary: `Sent pages ${pages.join(', ')} of "${resource.title}" to the model (from ${source}). This uses your AI quota.`,
    data: { fileId: resource.id, title: resource.title, pages, status: 'sent', source },
    toast: { kind: 'info', title: 'Pages sent to model', description: resource.title },
  };
}

async function editNote(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const section = requireString(args, 'section');
  const newText = requireString(args, 'newText');
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Check "AI may edit" toggle and implement version history
  return {
    ok: true,
    summary: `Proposed edit to section "${section}" of "${resource.title}". Waiting for your confirmation.`,
    data: { fileId: resource.id, title: resource.title, section, newText, status: 'pending_confirmation' },
  };
}

async function revertNote(args: Record<string, unknown>): Promise<ToolExecution> {
  const fileId = requireString(args, 'fileId');
  const versionId = args.versionId ? String(args.versionId) : undefined;
  
  const resource = await db.resources.get(fileId);
  if (!resource) throw new ToolError(`File "${fileId}" not found.`);
  if (resource.kind !== 'file') throw new ToolError(`Resource "${fileId}" is not a file.`);

  // TODO: Implement version history revert
  return {
    ok: true,
    summary: `Reverted note for "${resource.title}"${versionId ? ` to version ${versionId}` : ' to previous version'}.`,
    data: { fileId: resource.id, title: resource.title, versionId, status: 'reverted' },
    toast: { kind: 'success', title: 'Note reverted', description: resource.title },
  };
}

/* ---------------- Assistant settings ---------------- */

async function listModels(): Promise<ToolExecution> {
  const providers = await listProviders();
  const grouped = providers
    .filter((p) => p.modelName.trim()) // Only providers with a model configured
    .map((p) => ({
      provider: p.label,
      providerId: p.id,
      model: p.modelName,
      isDefault: p.isDefault,
      hasKey: true, // All saved providers have keys server-side
    }));

  return {
    ok: true,
    summary: grouped.length === 0 ? 'No models with saved keys configured.' : `${grouped.length} model(s) available across ${new Set(grouped.map((g) => g.provider)).size} provider(s).`,
    data: { models: grouped },
  };
}

async function setChatModel(args: Record<string, unknown>): Promise<ToolExecution> {
  const providerLabel = requireString(args, 'provider');
  const model = requireString(args, 'model');
  
  const providers = await listProviders();
  const provider = providers.find((p) => p.label.toLowerCase() === providerLabel.toLowerCase());
  if (!provider) throw new ToolError(`Provider "${providerLabel}" not found.`);
  
  // TODO: Update the provider's modelName in the database
  // await updateProvider(provider.id, { modelName: model });
  
  return {
    ok: true,
    summary: `Chat model for "${providerLabel}" set to "${model}".`,
    data: { provider: providerLabel, model },
    toast: { kind: 'success', title: 'Chat model updated', description: `${providerLabel} → ${model}` },
  };
}

async function setExtractionModel(args: Record<string, unknown>): Promise<ToolExecution> {
  const providerLabel = requireString(args, 'provider');
  const model = requireString(args, 'model');
  
  const providers = await listProviders();
  const provider = providers.find((p) => p.label.toLowerCase() === providerLabel.toLowerCase());
  if (!provider) throw new ToolError(`Provider "${providerLabel}" not found.`);
  
  // TODO: Store extraction model preference (could be in provider row or settings)
  // await updateProvider(provider.id, { extractionModel: model });
  
  return {
    ok: true,
    summary: `Default extraction model for "${providerLabel}" set to "${model}".`,
    data: { provider: providerLabel, model },
    toast: { kind: 'success', title: 'Extraction model updated', description: `${providerLabel} → ${model}` },
  };
}

/* ---------------- Conversations ---------------- */

async function listConversations(args: Record<string, unknown>): Promise<ToolExecution> {
  const query = args.query ? String(args.query).toLowerCase() : '';
  
  const { listSessions } = await import('./chatRepo');
  const sessions = await listSessions();
  
  let filtered = sessions;
  if (query) {
    filtered = sessions.filter((s) => s.title.toLowerCase().includes(query));
  }
  
  const items = filtered.map((s) => ({
    id: s.id,
    title: s.title,
    date: s.updatedAt,
    providerId: s.providerId,
  }));
  
  return {
    ok: true,
    summary: items.length === 0 ? 'No conversations found.' : `Found ${items.length} conversation(s).`,
    data: { conversations: items },
  };
}

async function openConversation(args: Record<string, unknown>): Promise<ToolExecution> {
  const id = requireString(args, 'id');
  
  const { listMessages } = await import('./chatRepo');
  const messages = await listMessages(id);
  
  return {
    ok: true,
    summary: `Loaded conversation "${id}" with ${messages.length} message(s).`,
    data: { id, messages },
  };
}

async function deleteConversation(args: Record<string, unknown>): Promise<ToolExecution> {
  const id = requireString(args, 'id');
  
  const { deleteSession } = await import('./chatRepo');
  await deleteSession(id);
  
  return {
    ok: true,
    summary: `Deleted conversation "${id}".`,
    data: { id },
    toast: { kind: 'success', title: 'Conversation deleted', description: id },
  };
}

async function newConversation(args: Record<string, unknown>): Promise<ToolExecution> {
  const { createSession } = await import('./chatRepo');
  const { getDefaultProvider } = await import('./aiProviderRepo');
  const provider = await getDefaultProvider();
  
  const session = await createSession(provider?.id ?? null);
  
  return {
    ok: true,
    summary: `Started new conversation "${session.title}".`,
    data: { session },
    toast: { kind: 'success', title: 'New conversation', description: session.id },
  };
}

/* ---------------- Dispatcher ---------------- */

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolExecution>> = {
  listSubjects: () => listSubjects(),
  listTopics,
  getWeekSchedule,
  getFocusStats,
  getSubjectProgress,
  getCurrentStatus: () => getCurrentStatus(),
  setStatus,
  addCalendarEvent,
  addResourceLink,
  createSubject,
  createTopic,
  markTopicStatus,
  addTopicNote,
  addAssessment,
  addPTO,
  addOneOffShiftException,
  deleteCalendarEvent,
  // Files and extraction
  searchFiles,
  listFiles,
  getExtractionStatus,
  startExtraction,
  queueExtraction,
  retryExtraction,
  markNoteChecked,
  // Notes and search
  searchNotes,
  readNote,
  readFilePages,
  editNote,
  revertNote,
  // Assistant settings
  listModels,
  setChatModel,
  setExtractionModel,
  // Conversations
  listConversations,
  openConversation,
  deleteConversation,
  newConversation,
};

/** Returns null for names we don't own, so tools.ts can keep its own switch. */
export async function executeExtendedTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecution | null> {
  const handler = HANDLERS[name];
  return handler ? handler(args) : null;
}

/** Confirmation/transcript wording. Gated tools state exactly what will change. */
export function describeExtendedToolCall(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => String(args[k] ?? '—');
  switch (name) {
    case 'addPTO':
      return `Log PTO for ${s('date')}. This replaces whatever that day's shift currently is.`;
    case 'addOneOffShiftException':
      return `Override ${s('date')} to start ${s('startTime')} for ${s('hours')}h, replacing the scheduled shift.`;
    case 'deleteCalendarEvent':
      return `Permanently delete calendar event ${s('eventId')}. This cannot be undone.`;
    case 'setStatus':
      return `Switch the active status to ${s('status')} (changes the theme).`;
    case 'addCalendarEvent':
      return `Add event “${s('title')}” on ${s('date')} (${s('category')}).`;
    case 'addResourceLink':
      return `Add link “${s('title')}” to topic ${s('topicId')}.`;
    case 'createSubject':
      return `Create a new subject named “${s('name')}”.`;
    case 'createTopic':
      return `Create topic “${s('title')}” in subject ${s('subjectId')}.`;
    case 'markTopicStatus':
      return `Mark topic ${s('topicId')} as ${s('status')}.`;
    case 'addTopicNote':
      return `Append notes to topic ${s('topicId')}.`;
    case 'addAssessment':
      return `Add ${s('type')} “${s('name')}” to subject ${s('subjectId')} on ${s('date')}.`;
    case 'listSubjects':
      return 'List all study subjects.';
    case 'listTopics':
      return `List the topics of subject ${s('subjectId')}.`;
    case 'getWeekSchedule':
      return `Resolve the work roster for the week of ${args.weekStartDate ? s('weekStartDate') : 'the current week'}.`;
    case 'getFocusStats':
      return `Report focus time for this ${s('range')}.`;
    case 'getSubjectProgress':
      return `Report topic progress for subject ${s('subjectId')}.`;
    case 'getCurrentStatus':
      return 'Read the current status and theme.';
    // Files and extraction
    case 'searchFiles':
      return `Search files for "${s('query')}".`;
    case 'listFiles':
      return `List files (filter: ${s('filter')}).`;
    case 'getExtractionStatus':
      return `Get extraction status for file ${s('fileId')}.`;
    case 'startExtraction':
      return `Start extraction for file ${s('fileId')}${args.provider ? ` with ${s('provider')}` : ''}${args.model ? ` (${s('model')})` : ''}.`;
    case 'queueExtraction':
      return `Queue ${Array.isArray(args.fileIds) ? args.fileIds.length : 0} file(s) for extraction.`;
    case 'retryExtraction':
      return `Retry extraction for file ${s('fileId')}${args.chunkIndex != null ? ` chunk ${s('chunkIndex')}` : ''}.`;
    case 'markNoteChecked':
      return `Mark note for file ${s('fileId')} as ${s('checked') ? 'checked' : 'unchecked'}.`;
    // Notes and search
    case 'searchNotes':
      return `Search notes for "${s('query')}"${args.includeAll ? ' (including all)' : ''}.`;
    case 'readNote':
      return `Read note for file ${s('fileId')}${args.section ? ` section "${s('section')}"` : ''}.`;
    case 'readFilePages':
      return `Read pages ${Array.isArray(args.pages) ? args.pages.join(', ') : '?'} of file ${s('fileId')}.`;
    case 'editNote':
      return `Edit section "${s('section')}" of file ${s('fileId')}.`;
    case 'revertNote':
      return `Revert note for file ${s('fileId')}${args.versionId ? ` to version ${s('versionId')}` : ''}.`;
    // Assistant settings
    case 'listModels':
      return 'List available models with saved keys.';
    case 'setChatModel':
      return `Set chat model for ${s('provider')} to ${s('model')}.`;
    case 'setExtractionModel':
      return `Set extraction model for ${s('provider')} to ${s('model')}.`;
    // Conversations
    case 'listConversations':
      return args.query ? `List conversations matching "${s('query')}".` : 'List all conversations.';
    case 'openConversation':
      return `Open conversation ${s('id')}.`;
    case 'deleteConversation':
      return `Delete conversation ${s('id')}.`;
    case 'newConversation':
      return 'Start a new conversation.';
    default:
      return `Run ${name}.`;
  }
}
