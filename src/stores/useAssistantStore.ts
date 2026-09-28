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
import type { ChatMessage } from '../features/ai/types';
import type { AiProvider, ChatSession } from '../types';
import { newId } from '../utils/id';
import { toast } from './useToastStore';

const MAX_TOOL_ROUNDS = 4;

/** How many stored messages are replayed to the model on a new turn. */
const CONTEXT_WINDOW = 20;

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
    '- searchLibrary(query): find subjects, topics and study resources.',
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
    '',
    'WRITE FUNCTIONS NEEDING USER CONFIRMATION (the UI always asks before these run — just call them when asked):',
    '- addOrUpdateWeeklySchedule(weekStartDate, offDays, shiftStartTime, shiftLengthHours).',
    '- addPTO(date).',
    '- addOneOffShiftException(date, startTime, hours).',
    '- deleteCalendarEvent(eventId).',
    '',
    'offDays uses 0=Sunday..6=Saturday. Topic status is one of not_started / studying / confident. Assessment type is one of exam / quiz / assignment / project. Event category is one of class / deadline / personal / work. Every function returns a short structured result; read it and report accurately what actually happened, including when it failed. Keep replies short and specific.',
  ].join('\n');
}

export type AssistantViewMsg = AssistantViewMessage;

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
        await persist(sessionId, { role: 'user', content: prompt });

        // Only the most recent messages are replayed, tool sequences intact.
        let transcript: ChatMessage[] = [
          ...buildTranscript(await listMessages(sessionId), CONTEXT_WINDOW),
        ];

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const result = await chatCompletion({
            provider,
            messages: [{ role: 'system', content: systemPrompt(new Date()) }, ...transcript],
            tools: TOOL_SPECS,
          });

          if (result.toolCalls.length === 0) {
            const reply = result.content.trim() || 'Done.';
            transcript = [...transcript, { role: 'assistant', content: reply }];
            await persist(sessionId, { role: 'assistant', content: reply });
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
            set({
              pending: {
                name: first.name,
                argsText: first.arguments,
                description: describeToolCall(first.name, first.arguments),
                callId: first.id,
              },
            });
            pushView({ role: 'tool', toolName: first.name, text: describeToolCall(first.name, first.arguments) });
            break;
          }

          for (const call of result.toolCalls) {
            let toolMsg: ChatMessage;
            try {
              const exec = await executeTool(call.name, call.arguments);
              toolMsg = {
                role: 'tool',
                content: JSON.stringify({ ok: true, result: exec.data }),
                toolCallId: call.id,
                name: call.name,
                display: exec.summary,
              };
              if (exec.toast) toast(exec.toast.kind, exec.toast.title, exec.toast.description);
              else toast('info', `${call.name} ran`, exec.summary);
            } catch (err) {
              const message = err instanceof ToolError ? err.message : 'Tool execution failed.';
              toolMsg = {
                role: 'tool',
                content: JSON.stringify({ ok: false, error: message }),
                toolCallId: call.id,
                name: call.name,
                display: message,
                error: true,
              };
            }
            transcript = [...transcript, toolMsg];
            await persist(sessionId, toolMsg);
          }
        }
        set({ sessions: await listSessions() });
      } catch (err) {
        pushView({
          role: 'assistant',
          text: err instanceof Error ? err.message : 'The assistant request failed.',
          error: true,
        });
      } finally {
        set({ busy: false });
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
        const replyMsg: ChatMessage = { role: 'assistant', content: reply };
        await persist(sessionId, toolMsg);
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
