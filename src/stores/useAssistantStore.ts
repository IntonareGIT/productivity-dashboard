import { create } from 'zustand';
import { format } from 'date-fns';
import { chatCompletion } from '../features/ai/aiClient';
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
import type { AssistantViewMessage } from '../features/ai/chatRepo';
import { describeDeleteCounts } from '../features/ai/toolsLibrary';
import type { ChatMessage } from '../features/ai/types';
import type { AiProvider, ChatSession } from '../types';
import { newId } from '../utils/id';
import { toast } from './useToastStore';

const MAX_TOOL_ROUNDS = 4;

/** How many stored messages are replayed to the model on a new turn. */
const CONTEXT_WINDOW = 20;

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
    '- createGroup(subjectId, name): create an empty resource group.',
    '- renameGroup(groupId, name): rename a group. Its resources are untouched.',
    '- moveResourceToGroup(resourceId, groupId): move a resource into a group, or pass null to remove it. The group must belong to the same subject as the resource.',
    '- renameSubject(subjectId, name) / renameTopic(topicId, title) / renameResource(resourceId, title).',
    '- moveResource(resourceId, topicId): move a resource to another topic in the same subject. This clears its group.',
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
      content: JSON.stringify({ ok: true, result: exec.data }),
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
  /** Sessions this provider can safely continue (v7). */
  sessions: ChatSession[];
  sessionId: string | null;
  view: AssistantViewMsg[];
  pending: PendingCall | null;
  setOpen: (open: boolean) => void;
  ask: (text: string) => void;
  send: (text: string) => Promise<void>;
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

  return {
    open: false,
    busy: false,
    providerLabel: null,
    providerReady: false,
    providerError: null,
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


    send: async (text) => {
      const prompt = text.trim();
      if (!prompt || get().busy) return;
      pushView({ role: 'user', text: prompt });
      set({ busy: true });
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

        await persist(sessionId, { role: 'user', content: prompt });

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
          const result = await chatCompletion({
            provider,
            messages: [{ role: 'system', content: systemPrompt(new Date()) }, ...transcript],
            tools: TOOL_SPECS,
          });

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
          const closing = await chatCompletion({
            provider,
            messages: [{ role: 'system', content: systemPrompt(new Date()) }, ...transcript],
          });
          const raw = closing.content.trim() ||
            'I reached the limit on how many actions I can take in one go. Here is where things stand — tell me what to do next.';
          transcript = [...transcript, { role: 'assistant', content: raw }];
          await persist(sessionId, { role: 'assistant', content: raw, reasoning: closing.reasoning });
        }

        set({ sessions: await listSessions() });
      } catch (err) {
        pushView({
          role: 'assistant',
          text: err instanceof Error ? err.message : 'The assistant request failed.',
          error: true,
        });
      } finally {
        set({ busy: false, activeTool: null });
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

        const exec = await executeTool(pending.name, pending.argsText);
        const toolMsg: ChatMessage = {
          role: 'tool',
          content: JSON.stringify({ ok: true, result: exec.data }),
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
