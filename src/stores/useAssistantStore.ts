import { create } from 'zustand';
import { format } from 'date-fns';
import { chatCompletion, friendlyError } from '../features/ai/aiClient';
import { getDefaultProvider, providerIsReady } from '../features/ai/aiProviderRepo';
import {
  DEFAULT_TITLE,
  appendMessage,
  autoTitle,
  buildTranscript,
  createSession,
  deleteSession,
  listMessages,
  listSessions,
  renameSession as renameSessionRow,
  toViewMessages,
} from '../features/ai/chatRepo';
import {
  CONFIRMATION_TOOL_NAMES,
  TOOL_SPECS,
  ToolError,
  describeToolCall,
  executeTool,
} from '../features/ai/tools';
import {
  executeCalendarToolConfirmed,
  calendarPromptSection,
  CALENDAR_TOOL_NAMES,
} from '../features/ai/toolsCalendar';
import { dateContext } from '../features/calendar/dateRules';
import { WEEK_STARTS_ON } from '../features/calendar/categories';
import type { AssistantViewMessage } from '../features/ai/chatRepo';
import { describeDeleteCounts } from '../features/ai/toolsLibrary';
import type { ChatMessage, ToolSpec } from '../features/ai/types';
import type { AiProvider, ChatSession } from '../types';
import { newId } from '../utils/id';
import { toast } from './useToastStore';

const MAX_TOOL_ROUNDS = 4;

/** How many stored messages are replayed to the model on a new turn. */
const CONTEXT_WINDOW = 20;

/**
 * Ceiling on ONE tool result sent back to the model.
 *
 * A tool such as `searchLibrary` or `listEvents` can return hundreds of rows,
 * and every one of them is re-sent on each of the following tool rounds. That
 * is the single biggest source of avoidable request size, and request size is
 * what makes a provider slow to answer and quick to return 503. Truncating the
 * tool result keeps the transcript small without dropping any instruction or
 * answer, and the marker tells the model the list was cut so it does not report
 * a partial list as complete.
 */
export const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * Cap a tool result for the wire, marking it so the model knows it is partial.
 *
 * Applied ONLY to the copy sent to the provider. The stored row keeps the full
 * result, so the UI still shows everything that happened, and the next turn
 * built from storage is unaffected.
 */
export function capToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const kept = content.slice(0, MAX_TOOL_RESULT_CHARS);
  return `${kept}\n[truncated] (${content.length - MAX_TOOL_RESULT_CHARS} more characters. Ask a narrower question if you need the rest.)`;
}

/** Parse a tool's arguments without throwing; a preview must never be the failure. */
function safeParseArgs(argsJson: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(argsJson || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function systemPrompt(now: Date): string {
  return [
    'You are a helpful in-app assistant for a personal productivity dashboard.',
    `Today is ${format(now, 'EEEE, yyyy-MM-dd')}.`,
    '',
    'LOOKUP FUNCTIONS (call these before any write):',
    '- listSubjects(): every subject with its id, name and term.',
    '- listTopics(subjectId): the topics of one subject, with ids.',
    'You must call listSubjects or listTopics FIRST whenever a function needs an id. Never guess, invent or reuse an id. If a name matches more than one subject or topic, ask the user which one they mean instead of picking one. If a function reports that an id does not exist, look it up again rather than trying variations.',
    '',
    'IDENTIFIING THINGS:',
    'Every tool takes an id in a parameter whose name ends in "Id" (subjectId, topicId, resourceId, groupId, noteId, eventId, assessmentId). Always use the id from a previous tool result when one is available, never retype ids from memory, and never invent ids.',
    'Every search, list and create result includes an "id" field that is the exact database id, plus "kind" and the parent subject. Pass that id through unchanged.',
    'A name is accepted only as a fallback, and only when it matches exactly one item. If a tool replies with several candidates, show them to the user and ask which one, then call again with the id.',
    'An id from one kind of item will never match a tool that wants a different kind, so do not pass a topicId where a subjectId is expected.',
    '',
    'READ FUNCTIONS:',
    "- getTodaysSchedule(): today's shift, events and focus progress.",
    '- getUpcomingDeadlines(days): study deadlines and assessments due soon.',
    '- searchLibrary(query): find subjects, topics and study resources. Returns resources as { id, title, type, subject, topic } — any other tool needing a resource_id must use the "id" field from that list, never the file name.',
    '- getWeekSchedule(weekStartDate): resolve one week to per-day work/off/PTO, including one-off exceptions.',
    '- getFocusStats(range): total focus time for "today", "week" or "month", per subject.',
    '- getSubjectProgress(subjectId): topic counts by status plus the next upcoming assessment.',
    '- getCurrentStatus(): the active status and theme.',
    '',
    'WRITE FUNCTIONS (run immediately, each raises a visible toast):',
    '- setStatus(status): switch the active status/theme.',
    '- addCalendarEvent(title, date, time, category, recurrence).',
    '- addCalendarEvent also accepts subjectId, eventKind (studying/lecture/section/lab) and period (1-6). A period sets the time from the fixed timetable, so omit time unless the user wants a different one.',
    'Timetable periods: 1=08:30-10:10, 2=10:20-12:00, 3=12:10-13:50, 4=14:00-15:40, 5=15:50-17:30, 6=17:40-19:20. Pass `period` and the app applies these; you do not need to compute the times.',
    '- addResourceLink(topicId, title, url).',
    '- createSubject(name).',
    '- createTopic(subjectId, title).',
    '- markTopicStatus(topicId, status).',
    '- addTopicNote(topicId, title, content).',
    '- addAssessment(subjectId, type, date, weight).',
    '- startPomodoroSession(durationMinutes, label?): start a focus timer (1-180 min).',
    '- stopPomodoroSession(): stop the running focus timer.',
    '- manage_split_screen(action, pane?, viewType?, resourceId?): control the two-pane split view — action is open/close/swap, pane is left/right, viewType is pdf/notes/dashboard/assistant. Use it to put a PDF beside its notes when the user asks to study a document, or to clear the split when they are done. A PDF pane needs a resourceId, which must be the "id" field from searchLibrary results — never the file name.',
    '- listGroups(subjectId): the resource groups of a subject, with ids and counts.',
    '- createGroup(subjectId, name, parentGroupId?): create an empty resource group. Pass parentGroupId to nest it inside an existing group.',
    '- renameGroup(groupId, name): rename a group. Its resources are untouched.',
    '- moveGroup(groupId, newParentGroupId): move a group and everything inside it under a new parent. Pass null for the top level of the subject.',
    '- listGroups(subjectId, parentGroupId?): the group tree, with ids, names, depth, parentGroupId, counts and a full "path" such as "Lectures / Week 1". Omit parentGroupId for the top level, or pass one to list just that level.',
    'GROUPS CAN NEST, up to 5 levels deep. A group name only has to be unique among its SIBLINGS, so "Week 1" can exist in two different branches.',
    'When a group name matches more than one group, the tool returns the candidates WITH their full paths. Show those paths to the user and ask which one, then call again with that id. Never guess between them.',
    'Deleting a group does NOT delete its subgroups or resources: they move up one level to the deleted group parent. The confirmation card says how many of each will move.',
    'moveGroup refuses a move that would put a group inside itself or one of its own subgroups.',
    '- moveResourceToGroup(resourceId, groupId): move a resource into a group, or pass null to remove it. The group must belong to the same subject as the resource.',
    '- renameSubject(subjectId, name) / renameTopic(topicId, title) / renameResource(resourceId, title).',
    '- moveResource(resourceId, topicId): move a resource to another topic in the same subject. This clears its group.',
    '- createNote(subjectId, title, content?, topicId?): create a new note in a subject, optionally inside a named topic. Use this rather than createTopic when the user wants a NOTE.',
    '- renameNote(topicId, title) / setNoteTitle(topicId, title): give a note a better title. Both do the same thing.',
    '',
    '',
    'WRITE FUNCTIONS NEEDING USER CONFIRMATION (the UI always asks before these run — just call them when asked):',
    '- addOrUpdateWeeklySchedule(weekStartDate, offDays, shiftStartTime, shiftLengthHours).',
    '- addPTO(date).',
    '- addOneOffShiftException(date, startTime, hours).',
    '- deleteCalendarEvent(eventId).',
    '- deleteResource(resourceId).',
    '- deleteNote(topicId).',
    '- deleteTopic(topicId): removes the topic AND its resources and uploaded files.',
    '- deleteSubject(subjectId): removes the subject AND its topics, resources, uploaded files, notes and groups.',
    '- deleteGroup(groupId): removes ONLY the group. Its resources are kept and become ungrouped, so say so rather than implying files were lost.',
    '',
    'BEFORE CALLING ANY DELETE TOOL: state plainly what it will remove and ask the user to confirm. Calling it twice does NOT perform it; only the user pressing Confirm does. If the user declines or moves on, do not retry; tell them nothing was changed.',
    '',
    'offDays uses 0=Sunday..6=Saturday. Topic status is one of not_started / studying / confident. Assessment type is one of exam / quiz / assignment / project. Event category is one of class / deadline / personal / work. Every function returns a short structured result; read it and report accurately what actually happened, including when it failed. Keep replies short and specific.',
    // Today's date, the timezone and the week start, so the model can turn
    // "tomorrow" or "next Sunday" into the exact YYYY-MM-DD the tools require.
    dateContext(now, WEEK_STARTS_ON),
    calendarPromptSection(),
  ].join('\n');
}

export type AssistantViewMsg = AssistantViewMessage;

/** Set a transient action pill, run one tool, and always return a tool turn. */
type SetState = (partial: Partial<AssistantState>) => void;

/**
 * Execute one tool call and ALWAYS return the `role: 'tool'` turn answering it.
 *
 * Never throws and never returns null: a tool that fails still has to produce a
 * tool message, because an assistant `tool_calls` turn with no following tool
 * result is rejected by Gemini with HTTP 400. The error text is what the model
 * then sees, so it reports the failure honestly instead of stalling.
 */
async function runTool(
  call: { id: string; name: string; arguments: string },
  set: SetState,
): Promise<ChatMessage> {
  // The action pill: visible only while the tool actually runs, so the user sees
  // WHAT is happening ("⚡ Opening the PDF in the left pane…") instead of an
  // opaque "Working…".
  set({ activeTool: { name: call.name, label: describeToolCall(call.name, call.arguments) } });
  try {
    const exec = await executeTool(call.name, call.arguments);
    if (exec.toast) toast(exec.toast.kind, exec.toast.title, exec.toast.description);
    else toast('info', `${call.name} ran`, exec.summary);
    return {
      role: 'tool',
      // Capped for the wire only. `display` below keeps the full, friendly
      // summary for the UI, and the row stores the full result too.
      content: capToolResult(JSON.stringify({ ok: true, result: exec.data })),
      toolCallId: call.id,
      name: call.name,
      display: exec.summary,
    };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : 'Tool execution failed.';
    return {
      role: 'tool',
      content: JSON.stringify({ ok: false, error: message }),
      toolCallId: call.id,
      name: call.name,
      display: message,
      error: true,
    };
  } finally {
    // The pill is transient: it must disappear whether the tool succeeded or threw.
    set({ activeTool: null });
  }
}

interface PendingCall {
  name: string;
  argsText: string;
  description: string;
  /**
   * Id of the gated tool call this confirmation resolves. Required so the tool
   * result we append afterwards carries a matching `tool_call_id` — Gemini
   * rejects an unpaired tool message.
   */
  callId: string;
}

interface AssistantState {
  open: boolean;
  busy: boolean;
  /**
   * The tool currently executing, for the transient "action pill" in the chat.
   * Null when nothing is running. Cleared in a `finally`, so the pill can never
   * get stuck on screen if a tool throws.
   */
  activeTool: { name: string; label: string } | null;
  providerLabel: string | null;
  providerReady: boolean;
  providerError: string | null;
  /**
   * Transient, non-error line shown while a request is being retried, e.g.
   * "Model is busy, retrying (2/4)...". Null whenever nothing is retrying, and
   * the UI hides the row entirely on null, so it can never linger after success.
   */
  retryStatus: string | null;
  /**
   * The friendly failure to show with a Retry button, with the raw provider
   * error kept for the Details toggle. Null when there is no failure to offer.
   */
  failure: { message: string; details: string; retryable: boolean } | null;
  /** Set when the last answer came from the configured fallback model. */
  fallbackNotice: string | null;
  /** Sessions this provider can safely continue (v7). */
  sessions: ChatSession[];
  sessionId: string | null;
  view: AssistantViewMsg[];
  pending: PendingCall | null;
  setOpen: (open: boolean) => void;
  ask: (text: string) => void;
  send: (text: string, isRetry?: boolean) => Promise<void>;
  /** Re-send the last turn without adding a second copy of the user message. */
  retryLast: () => Promise<void>;
  /** Abort the turn in flight: fetch, stream, backoff wait and tool rounds. */
  stop: () => void;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;
  clearChat: () => Promise<void>;
  refreshProvider: () => Promise<void>;
  loadSessions: () => Promise<void>;
  newSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
}

const WELCOME: AssistantViewMsg[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Hi! Ask me about today, upcoming deadlines, your library — or tell me to set a schedule or start a focus timer.',
  },
];

/**
 * The turn in flight, if any.
 *
 * Module-level rather than in the store because it is NOT state the UI renders:
 * it exists so `stop` can reach an in-flight request from anywhere, including
 * from an Escape key handler, without the store having to re-render. Exactly one
 * turn runs at a time (`busy` guards it), so a single slot is sufficient and
 * two concurrent turns cannot abort each other by accident.
 */
let turnController: AbortController | null = null;
/** The prompt of the turn currently running, so Retry can resume it verbatim. */
let lastUserPrompt: string | null = null;

/** Was this turn ended by Stop rather than by finishing or failing? */
export class TurnStopped extends Error {
  constructor() {
    super('Stopped');
    this.name = 'TurnStopped';
  }
}

const isStopped = (err: unknown): boolean =>
  err instanceof TurnStopped ||
  (err instanceof Error && (err.name === 'AbortError' || err.message === 'Stopped'));

export const useAssistantStore = create<AssistantState>((set, get) => {
  async function resolveProvider(): Promise<{ provider: AiProvider | null; error: string | null }> {
    const provider = await getDefaultProvider();
    if (!provider || !providerIsReady(provider)) {
      const msg = 'No AI provider is configured yet. Open Settings → AI Providers, add a provider (or paste an API key).';
      return { provider: null, error: msg };
    }
    return { provider, error: null };
  }

  function pushView(msg: Omit<AssistantViewMsg, 'id'>): string {
    const id = newId();
    set((s) => ({ view: [...s.view, { ...msg, id }] }));
    return id;
  }

  /**
   * Resolve the session to write into.
   *
   * Sessions are pinned to a provider. If the user switched the default
   * provider, the old session's messages (with Gemini-specific
   * `extra_content`) must never be replayed against the new one, so we start a
   * fresh session instead.
   */
  async function ensureSession(provider: AiProvider): Promise<string> {
    const current = get().sessionId;
    if (current) {
      const session = (await listSessions()).find((s) => s.id === current);
      if (session && session.providerId === provider.id) return current;
    }
    // Reuse an existing session for this provider when one is idle.
    const mine = (await listSessions()).find((s) => s.providerId === provider.id);
    if (mine) {
      const rows = await listMessages(mine.id);
      set({ sessionId: mine.id, view: rows.length ? toViewMessages(rows) : WELCOME, pending: null });
      return mine.id;
    }
    const created = await createSession(provider.id);
    set({ sessionId: created.id, view: WELCOME, pending: null });
    return created.id;
  }

  /** Persist a turn, then refresh the view from what is actually stored. */
  async function persist(sessionId: string, msg: ChatMessage): Promise<void> {
    await appendMessage(sessionId, msg);
    const rows = await listMessages(sessionId);
    const projected = toViewMessages(rows);
    set({ view: projected.length ? projected : WELCOME });
  }

  /**
   * One provider request, with the retry status wired to the UI.
   *
   * Every request in a turn goes through here, which is what makes the retry
   * policy single-sourced: the status line, the abort signal, the fallback
   * model and the request accounting all live in one call site, so a new caller
   * cannot accidentally get a turn that neither retries nor can be stopped.
   *
   * The status is cleared as soon as the call settles, whether it succeeded or
   * failed, so it can never be left on screen after the turn is over.
   */
  async function request(
    provider: AiProvider,
    messages: ChatMessage[],
    opts: { tools?: ToolSpec[] } = {},
  ) {
    try {
      return await chatCompletion({
        provider,
        messages,
        tools: opts.tools,
        signal: turnController?.signal,
        fallbackModel: provider.fallbackModel ?? null,
        onRetry: ({ attempt, max }) => {
          set({ retryStatus: `Model is busy, retrying (${attempt}/${max})...` });
        },
      });
    } finally {
      set({ retryStatus: null });
    }
  }

  /**
   * Record a failure in the user's terms, with the raw error behind Details.
   *
   * Replaces pushing the provider's raw JSON into the transcript, which is what
   * produced the "Provider responded HTTP 503 - {"error":{...}}" wall of text.
   */
  function reportFailure(err: unknown): void {
    const { message, retryable } = friendlyError(err);
    set({
      failure: {
        message,
        details: err instanceof Error ? err.message : String(err),
        retryable,
      },
    });
  }

  return {
    open: false,
    busy: false,
    providerLabel: null,
    providerReady: false,
    providerError: null,
    retryStatus: null,
    failure: null,
    fallbackNotice: null,
    sessions: [],
    sessionId: null,
    view: WELCOME,
    pending: null,
    activeTool: null,

    setOpen: (open) => {
      set({ open });
      if (open) {
        void get().refreshProvider();
        void get().loadSessions();
      }
    },

    ask: (text) => {
      set({ open: true });
      void get().refreshProvider();
      const trimmed = text.trim();
      if (trimmed) void get().send(trimmed);
    },

    loadSessions: async () => {
      const provider = await getDefaultProvider();
      const all = await listSessions();
      // Only sessions belonging to the active provider are replayable.
      const mine = provider ? all.filter((s) => s.providerId === provider.id) : [];
      set({ sessions: mine });
      const current = get().sessionId;
      if (current && !mine.some((s) => s.id === current)) {
        // Provider changed (or session deleted) — start clean rather than
        // resend another provider's messages.
        set({ sessionId: null, view: WELCOME, pending: null });
      }
      if (!get().sessionId && mine.length > 0) {
        await get().selectSession(mine[0].id);
      }
    },

    newSession: async () => {
      const provider = await getDefaultProvider();
      const created = await createSession(provider ? provider.id : null);
      set({ sessionId: created.id, view: WELCOME, pending: null, sessions: await listSessions() });
    },

    selectSession: async (id) => {
      const rows = await listMessages(id);
      set({ sessionId: id, view: rows.length ? toViewMessages(rows) : WELCOME, pending: null });
    },

    removeSession: async (id) => {
      await deleteSession(id);
      const sessions = await listSessions();
      set({ sessions });
      if (get().sessionId === id) {
        const next = sessions[0];
        if (next) await get().selectSession(next.id);
        else set({ sessionId: null, view: WELCOME, pending: null });
      }
    },

    renameSession: async (id, title) => {
      await renameSessionRow(id, title);
      set({ sessions: await listSessions() });
    },

    clearChat: async () => {
      const current = get().sessionId;
      if (current) await deleteSession(current);
      set({ sessionId: null, view: WELCOME, pending: null, sessions: await listSessions() });
    },


    /**
     * Send one user turn.
     *
     * `isRetry` is what makes the Retry button honest: on a retry the user
     * message is NOT pushed to the view or written to the session again, so the
     * transcript never gains a duplicate of what the user already sees. Only the
     * model request is made again.
     */
    send: async (text, isRetry = false) => {
      const prompt = text.trim();
      if (!prompt || get().busy) return;
      if (!isRetry) pushView({ role: 'user', text: prompt });
      // A fresh turn replaces any previous failure notice and any retry line.
      set({ busy: true, failure: null, retryStatus: null, fallbackNotice: null });
      turnController = new AbortController();
      lastUserPrompt = prompt;
      try {
        const { provider, error } = await resolveProvider();
        if (!provider) {
          pushView({ role: 'assistant', text: error ?? 'No AI provider configured.', error: true });
          set({ providerReady: false, providerError: error });
          return;
        }
        set({ providerLabel: provider.label, providerReady: true, providerError: null });

        // A provider switch starts a fresh session, so nothing from the old
        // provider (Gemini extra_content) is ever replayed to the new one.
        const sessionId = await ensureSession(provider);
        await autoTitle(sessionId, prompt);

        // Typing a new message while a confirmation is still open would store
        // a user turn directly after that unanswered assistant tool_calls turn.
        // Gemini rejects the resulting sequence with HTTP 400, so the pending
        // call is resolved as declined first — the write never happened, so this
        // is also the honest record of what occurred.
        const stale = get().pending;
        if (stale) {
          set({ pending: null });
          await persist(sessionId, {
            role: 'tool',
            content: JSON.stringify({ ok: false, error: 'The user moved on without confirming this action.' }),
            toolCallId: stale.callId,
            name: stale.name,
            display: 'Not confirmed — nothing was changed.',
          });
        }

        if (!isRetry) {
          await persist(sessionId, { role: 'user', content: prompt });
        }

        // Only the most recent messages are replayed, tool sequences intact.
        let transcript: ChatMessage[] = [
          ...buildTranscript(await listMessages(sessionId), CONTEXT_WINDOW),
        ];

        // Whether the model ever produced a plain-language answer. The round
        // budget can run out mid-chain; without this flag the loop just falls
        // through with the transcript ending on a TOOL turn, and the user is
        // left staring at an action chip with no reply at all.
        let answered = false;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          // Stop is checked BEFORE each request, so no request is issued after
          // the user asked for it to stop.
          if (turnController?.signal.aborted) throw new TurnStopped();

          const result = await request(provider, [
            { role: 'system', content: systemPrompt(new Date()) },
            ...transcript,
          ], { tools: TOOL_SPECS });

          if (result.answeredByFallback) {
            set({ fallbackNotice: `Answered by fallback model ${result.answeredByFallback}` });
          }

          if (result.toolCalls.length === 0) {
            const raw = result.content.trim() || 'Done.';
            // The wire/history keeps what the provider actually said (tags and
            // all); the transcript split into answer + reasoning is produced by
            // `persist` -> `toViewMessages`, which applies `extractThinking` to
            // the stored content. Doing it there means live and reloaded
            // messages render identically, with no second projection path.
            transcript = [...transcript, { role: 'assistant', content: raw }];
            await persist(sessionId, { role: 'assistant', content: raw, reasoning: result.reasoning });
            answered = true;
            break;
          }

          // Keep the provider's message object verbatim. Gemini 3 rejects the
          // follow-up request with HTTP 400 "Function call is missing a
          // thought_signature" if we rebuild this and drop
          // extra_content.google.thought_signature.
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: result.content,
            toolCalls: result.toolCalls,
            raw: result.raw,
          };
          transcript = [...transcript, assistantMsg];
          await persist(sessionId, assistantMsg);

          // Confirmation-gated calls pause for explicit user approval.
          const gated = result.toolCalls.filter((c) => CONFIRMATION_TOOL_NAMES.has(c.name));
          if (gated.length > 0) {
            const first = gated[0];
            // The Confirm card says WHAT will be lost, not just that something
            // will be. `describeDeleteCounts` reads live counts off the database
            // and never throws: an unresolvable target simply yields no counts and
            // the card falls back to the plain description.
            const baseDescription = describeToolCall(first.name, first.arguments);
            const counts = await describeDeleteCounts(
              first.name,
              safeParseArgs(first.arguments),
            );
            const description = counts
              ? `${baseDescription} This will also remove: ${counts}.`
              : baseDescription;
            set({
              pending: {
                name: first.name,
                argsText: first.arguments,
                description,
                callId: first.id,
              },
            });
            pushView({ role: 'tool', toolName: first.name, text: description });
            // The UNGATED calls in the same turn still have to be answered. A
            // tool_calls turn followed immediately by a plain user message is
            // rejected by Gemini with HTTP 400, so they are executed now and the
            // loop then pauses for the gated one.
            const ungated = result.toolCalls.filter((c) => !CONFIRMATION_TOOL_NAMES.has(c.name));
            for (const call of ungated) {
              const toolMsg = await runTool(call, set);
              transcript = [...transcript, toolMsg];
              await persist(sessionId, toolMsg);
            }
            break;
          }

          for (const call of result.toolCalls) {
            const toolMsg = await runTool(call, set);
            transcript = [...transcript, toolMsg];
            await persist(sessionId, toolMsg);
          }
        }

        // The round budget ran out while the model was still calling tools. Give
        // it one last turn with NO tools available, so it must produce prose
        // rather than another call. Without this the loop just falls through
        // with the transcript ending on a TOOL turn and nothing said — the chat
        // appears to stop dead. The transcript already satisfies the strict order
        // (user -> model call -> tool response -> ...), so appending the missing
        // final answer here cannot introduce an HTTP 400.
        if (!answered) {
          if (turnController?.signal.aborted) throw new TurnStopped();
          const closing = await request(provider, [
            { role: 'system', content: systemPrompt(new Date()) },
            ...transcript,
          ]);
          const raw = closing.content.trim() ||
            'I reached the limit on how many actions I can take in one go. Here is where things stand — tell me what to do next.';
          transcript = [...transcript, { role: 'assistant', content: raw }];
          await persist(sessionId, { role: 'assistant', content: raw, reasoning: closing.reasoning });
        }

        set({ sessions: await listSessions() });
      } catch (err) {
        // Stop is a normal outcome, not a failure: no error row, no failure
        // notice, just the "Stopped" line. Distinguishing it here is what keeps
        // Stop from looking like the assistant broke.
        if (isStopped(err)) {
          set({ activeTool: null, retryStatus: null });
        } else {
          reportFailure(err);
        }
      } finally {
        // The controller is released here and ONLY here, so `stop` can never
        // abort a turn that has already finished and left a stale controller
        // behind that a later turn would trip over.
        turnController = null;
        // `busy` is cleared unconditionally, so the input is always re-enabled
        // and the chat can never be stuck in a loading state.
        set({ busy: false, activeTool: null, retryStatus: null });
      }
    },

    /**
     * Retry the last turn after a failure.
     *
     * Sends the SAME prompt again, but with `isRetry` set, so the user message
     * is neither re-rendered nor stored a second time. Everything the model
     * needs is already in the session: the tool results from the failed turn
     * are stored rows, and the next request is rebuilt from them.
     */
    retryLast: async () => {
      if (get().busy || !lastUserPrompt) return;
      await get().send(lastUserPrompt, true);
    },

    /**
     * Stop the turn in flight.
     *
     * Aborting the controller does three things at once: it aborts the in-flight
     * fetch, it rejects the backoff wait so no further retry is issued, and the
     * loop re-checks the signal before the next round, so no new tool call
     * starts. A tool that is already running is left to finish, because
     * interrupting a database write halfway is worse than finishing it.
     *
     * A pending Confirm card is CANCELLED here too, exactly as if the user had
     * pressed Cancel. Leaving it open would mean a stop leaves a live delete
     * waiting for a second press, which is not what "stop" means.
     */
    stop: () => {
      turnController?.abort();
      const pending = get().pending;
      if (pending) {
        set({ pending: null });
        const sessionId = get().sessionId;
        // Recorded so the transcript stays well-formed: an assistant tool_calls
        // turn must be answered by a tool turn, or the next request is a 400.
        if (sessionId) {
          void persist(sessionId, {
            role: 'tool',
            content: JSON.stringify({ ok: false, error: 'Stopped by the user before confirming. Not executed.' }),
            toolCallId: pending.callId,
            name: pending.name,
            display: 'Cancelled when you stopped, nothing was changed.',
          });
        }
      }
    },

    confirmPending: async () => {
      const pending = get().pending;
      if (!pending || get().busy) return;
      set({ pending: null, busy: true });
      try {
        const { provider, error } = await resolveProvider();
        if (!provider) {
          pushView({ role: 'assistant', text: error ?? 'No AI provider configured.', error: true });
          return;
        }
        const sessionId = get().sessionId;
        if (!sessionId) return;

        // Confirmed. `createRecurringEvents` is the one tool whose confirmed
        // run differs from its first run: the first previews and creates
        // nothing, so it must be re-invoked in its confirmed form. Every other
        // gated tool runs exactly as it did to produce the card.
        const exec = CALENDAR_TOOL_NAMES.includes(pending.name)
          ? await executeCalendarToolConfirmed(pending.name, safeParseArgs(pending.argsText))
          : await executeTool(pending.name, pending.argsText);
        const toolMsg: ChatMessage = {
          role: 'tool',
          content: capToolResult(JSON.stringify({ ok: true, result: exec.data })),
          toolCallId: pending.callId,
          name: pending.name,
          display: exec.summary,
        };
        if (exec.toast) toast(exec.toast.kind, exec.toast.title, exec.toast.description);
        else toast('success', `${pending.name} confirmed`, exec.summary);

        // Replay stored history (verbatim) plus the approved result, so the
        // original assistant tool_calls turn keeps its thought_signature.
        const transcript: ChatMessage[] = [
          ...buildTranscript(await listMessages(sessionId), CONTEXT_WINDOW),
          toolMsg,
        ];
        const followUp = await chatCompletion({
          provider,
          messages: [
            { role: 'system', content: systemPrompt(new Date()) },
            ...transcript,
            {
              role: 'user',
              content: `The user confirmed. ${pending.description} The action completed with: ${exec.summary}. Confirm the outcome in plain language.`,
            },
          ],
        });
        const reply = followUp.content.trim() || exec.summary;
        const replyMsg: ChatMessage = { role: 'assistant', content: reply, reasoning: followUp.reasoning };
        await persist(sessionId, toolMsg);
        // `persist` re-projects the transcript through `toViewMessages`, which
        // splits any reasoning out, so the reply needs no separate view push.
        await persist(sessionId, replyMsg);
        set({ sessions: await listSessions() });
      } catch (err) {
        pushView({
          role: 'assistant',
          text: err instanceof Error ? err.message : 'The confirmed action failed.',
          error: true,
        });
      } finally {
        set({ busy: false });
      }
    },

    cancelPending: async () => {
      const pending = get().pending;
      if (!pending) return;
      set({ pending: null });
      // Recorded so the transcript stays well-formed for the next turn: the
      // assistant's tool call must be answered by a tool message.
      const sessionId = get().sessionId;
      if (sessionId) {
        await persist(sessionId, {
          role: 'tool',
          content: JSON.stringify({ ok: false, error: 'The user declined this action.' }),
          toolCallId: pending.callId,
          name: pending.name,
          display: 'Cancelled — nothing was changed.',
        });
      } else {
        pushView({ role: 'tool', toolName: pending.name, text: 'Cancelled — nothing was changed.' });
      }
    },

    refreshProvider: async () => {
      const provider = await getDefaultProvider();
      if (provider && providerIsReady(provider)) {
        set({ providerLabel: provider.label, providerReady: true, providerError: null });
        return;
      }
      const reason =
        provider && !provider.apiKey.trim()
          ? 'The default provider is missing its API key. Open Settings → AI Providers to add one.'
          : 'No AI provider is configured yet. Open Settings → AI Providers to add one.';
      set({ providerLabel: provider?.label ?? null, providerReady: false, providerError: reason });
    },
  };
});
