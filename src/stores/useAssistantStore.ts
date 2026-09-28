import { create } from 'zustand';
import { format } from 'date-fns';
import { chatCompletion } from '../features/ai/aiClient';
import { getDefaultProvider, providerIsReady } from '../features/ai/aiProviderRepo';
import {
  CONFIRMATION_TOOL_NAMES,
  TOOL_SPECS,
  ToolError,
  describeToolCall,
  executeTool,
} from '../features/ai/tools';
import type { ChatMessage } from '../features/ai/types';
import type { AiProvider } from '../types';
import { newId } from '../utils/id';
import { toast } from './useToastStore';

const MAX_TOOL_ROUNDS = 4;

function systemPrompt(now: Date): string {
  return [
    'You are a helpful in-app assistant for a personal productivity dashboard.',
    `Today is ${format(now, 'EEEE, yyyy-MM-dd')}.`,
    'You can call these functions to answer questions or take actions:',
    '- getTodaysSchedule(): today\'s shifts, events and focus progress.',
    '- getUpcomingDeadlines(days): study deadlines and assessments due soon.',
    '- searchLibrary(query): find subjects, topics and study resources.',
    '- addOrUpdateWeeklySchedule(weekStartDate, offDays, shiftStartTime, shiftLengthHours): write a weekly work roster. The UI always asks the user to confirm before this runs — just call it when asked.',
    '- startPomodoroSession(durationMinutes, label?): start a focus timer (1-180 min).',
    '- stopPomodoroSession(): stop the running focus timer.',
    'offDays uses 0=Sunday..6=Saturday. Keep replies short and specific.',
  ].join('\n');
}

export interface AssistantViewMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  pending?: boolean;
  error?: boolean;
}

interface PendingCall {
  name: string;
  argsText: string;
  description: string;
}

interface AssistantState {
  open: boolean;
  busy: boolean;
  providerLabel: string | null;
  providerReady: boolean;
  providerError: string | null;
  history: ChatMessage[];
  view: AssistantViewMsg[];
  pending: PendingCall | null;
  setOpen: (open: boolean) => void;
  ask: (text: string) => void;
  send: (text: string) => Promise<void>;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;
  clearChat: () => void;
  refreshProvider: () => Promise<void>;
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

  return {
    open: false,
    busy: false,
    providerLabel: null,
    providerReady: false,
    providerError: null,
    history: [],
    view: WELCOME,
    pending: null,

    setOpen: (open) => {
      set({ open });
      if (open) void get().refreshProvider();
    },

    ask: (text) => {
      set({ open: true });
      void get().refreshProvider();
      const trimmed = text.trim();
      if (trimmed) void get().send(trimmed);
    },

    clearChat: () => set({ history: [], view: WELCOME, pending: null }),


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
        let transcript: ChatMessage[] = [
          ...get().history,
          { role: 'user', content: prompt },
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
            pushView({ role: 'assistant', text: reply });
            break;
          }

          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: result.content,
            toolCalls: result.toolCalls,
          };
          transcript = [...transcript, assistantMsg];

          // Confirmation-gated calls pause for explicit user approval.
          const gated = result.toolCalls.filter((c) => CONFIRMATION_TOOL_NAMES.has(c.name));
          if (gated.length > 0) {
            const first = gated[0];
            set({
              pending: {
                name: first.name,
                argsText: first.arguments,
                description: describeToolCall(first.name, first.arguments),
              },
            });
            pushView({ role: 'tool', toolName: first.name, text: describeToolCall(first.name, first.arguments), pending: true });
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
              pushView({ role: 'tool', toolName: call.name, text: exec.summary });
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
              pushView({ role: 'tool', toolName: call.name, text: message, error: true });
            }
            transcript = [...transcript, toolMsg];
          }
        }

        set({ history: transcript.slice(-40) });
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
        const exec = await executeTool(pending.name, pending.argsText);
        const toolMsg: ChatMessage = {
          role: 'tool',
          content: JSON.stringify({ ok: true, result: exec.data }),
          name: pending.name,
          display: exec.summary,
        };
        pushView({ role: 'tool', toolName: pending.name, text: `Confirmed — ${exec.summary}` });
        if (exec.toast) toast(exec.toast.kind, exec.toast.title, exec.toast.description);
        else toast('success', `${pending.name} confirmed`, exec.summary);

        const transcript: ChatMessage[] = [
          ...get().history,
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
        pushView({ role: 'assistant', text: reply });
        const replyMsg: ChatMessage = { role: 'assistant', content: reply };
        set({ history: [...transcript, replyMsg].slice(-40) });
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

    cancelPending: () => {
      const pending = get().pending;
      if (!pending) return;
      set({ pending: null });
      pushView({ role: 'tool', toolName: pending.name, text: 'Cancelled — nothing was changed.' });
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
