import { db } from '../../db/db';
import type { ChatMessageRow, ChatSession } from '../../types';
import { newId } from '../../utils/id';
import type { ChatMessage } from './types';
import { extractThinking } from './thinking';
import { trimToWindow } from './historyNormalizer';

/**
 * Persistent assistant chat history (schema v7).
 *
 * Every message is written with the provider's own message object in `raw`.
 * Replaying a reconstructed message would drop Gemini's
 * `extra_content.google.thought_signature` and make the next turn fail with
 * HTTP 400, so `raw` is the source of truth. The normalized columns exist only
 * so the UI can render without parsing JSON.
 *
 * API keys are never stored here — messages are request/response payloads, and
 * the Authorization header is not part of a message.
 */

export const DEFAULT_TITLE = 'New chat';

export async function listSessions(): Promise<ChatSession[]> {
  const rows = await db.chatSessions.toArray();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createSession(providerId: string | null): Promise<ChatSession> {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newId(),
    title: DEFAULT_TITLE,
    providerId,
    createdAt: now,
    updatedAt: now,
  };
  await db.chatSessions.put(session);
  return session;
}

export async function renameSession(id: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return;
  await db.chatSessions.update(id, { title: clean });
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.chatSessions, db.chatMessages, async () => {
    await db.chatMessages.where('sessionId').equals(id).delete();
    await db.chatSessions.delete(id);
  });
}

export async function clearAllHistory(): Promise<void> {
  await db.transaction('rw', db.chatSessions, db.chatMessages, async () => {
    await db.chatMessages.clear();
    await db.chatSessions.clear();
  });
}

export async function listMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const rows = await db.chatMessages.where('sessionId').equals(sessionId).toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function appendMessage(sessionId: string, msg: ChatMessage): Promise<ChatMessageRow> {
  const row: ChatMessageRow = {
    id: newId(),
    sessionId,
    role: msg.role,
    content: msg.content ?? '',
    // Assistant turns with tool calls keep the response object untouched;
    // everything else stores the canonical outbound shape.
    raw:
      msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0
        ? msg.raw ?? {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : { role: msg.role, content: msg.content },
    toolCallIds: msg.toolCalls && msg.toolCalls.length ? msg.toolCalls.map((c) => c.id) : undefined,
    toolCallId: msg.toolCallId ?? null,
    toolName: msg.name ?? null,
    display: msg.display ?? null,
    reasoning: msg.reasoning ?? null,
    error: msg.error ?? false,
    createdAt: new Date().toISOString(),
  };
  await db.transaction('rw', db.chatSessions, db.chatMessages, async () => {
    await db.chatMessages.put(row);
    await db.chatSessions.update(sessionId, { updatedAt: row.createdAt });
  });
  return row;
}

/** Title a session from its first user message, without overwriting a rename. */
export async function autoTitle(sessionId: string, text: string): Promise<void> {
  const session = await db.chatSessions.get(sessionId);
  if (!session || (session.title && session.title !== DEFAULT_TITLE)) return;
  const title = text.trim().slice(0, 60);
  if (title) await db.chatSessions.update(sessionId, { title });
}

/**
 * Rebuild a request transcript from stored rows.
 *
 * Trimming now happens at TURN BOUNDARIES: the window is walked back to the
 * start of its exchange so it always opens on a user turn and never splits a
 * `tool_calls` turn from the results answering it. The previous version walked
 * back only when a result's parent was already visible, which left the window
 * free to START on a call.
 *
 * The turn-order guarantees themselves live in `normalizeHistoryForProvider`,
 * which every request goes through; this function only decides WHICH rows are
 * worth sending.
 */
export function buildTranscript(rows: ChatMessageRow[], limit = 20): ChatMessage[] {
  if (rows.length === 0) return [];
  // The rows keep their provider-native fields (`raw`, `reasoning`), so the cast
  // is safe: `trimToWindow` only re-slices, it never rebuilds a turn.
  return trimToWindow(rows.map(toChatMessage), limit).window as ChatMessage[];
}

/**
 * @deprecated Superseded by `normalizeHistoryForProvider`, which enforces the
 * full turn-order contract instead of only patching unanswered calls. It also
 * fixed a bug this could not: it appended a synthetic response straight after
 * the call, so a parallel call that already had a stored response came out in
 * the wrong order. Kept exported because the older suite asserts on it, and
 * because removing it would change behaviour the store has not been re-checked
 * against. Nothing in the request path calls it any more.
 */
export function closeDanglingCalls(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let idx = 0; idx < messages.length; idx += 1) {
    const m = messages[idx];
    out.push(m);
    if (m.role !== 'assistant' || !m.toolCalls || m.toolCalls.length === 0) continue;

    // Ids answered by the tool turns that directly follow this call.
    const answered = new Set<string>();
    for (let j = idx + 1; j < messages.length && messages[j].role === 'tool'; j += 1) {
      if (messages[j].toolCallId) answered.add(messages[j].toolCallId as string);
    }
    for (const call of m.toolCalls) {
      if (answered.has(call.id)) continue;
      out.push({
        role: 'tool',
        content: JSON.stringify({
          ok: false,
          error: 'This action did not run: its result was never recorded. Treat it as not performed.',
        }),
        toolCallId: call.id,
        name: call.name,
      });
    }
  }
  return out;
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  const raw = row.raw ?? { role: row.role, content: row.content };
  const msg: ChatMessage = {
    role: row.role,
    content: row.content,
    raw: raw as Record<string, unknown>,
  };
  if (row.toolCallIds && row.toolCallIds.length) {
    const calls = Array.isArray((raw as { tool_calls?: unknown }).tool_calls)
      ? (raw as { tool_calls: { id: string; function: { name: string; arguments: string } }[] }).tool_calls
      : [];
    msg.toolCalls = row.toolCallIds.map((id) => {
      const c = calls.find((x) => x.id === id);
      return {
        id,
        name: c && c.function ? c.function.name : row.toolName || '',
        arguments: c && c.function ? c.function.arguments : '{}',
      };
    });
  }
  if (row.toolCallId) msg.toolCallId = row.toolCallId;
  if (row.toolName) msg.name = row.toolName;
  if (row.display) msg.display = row.display;
  if (row.error) msg.error = true;
  return msg;
}

export interface AssistantViewMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  /**
   * Model reasoning for this turn, extracted from `<think>`-style tags or the
   * provider's native reasoning field. Absent for standard models, which is what
   * lets the UI skip the thought block entirely.
   */
  thought?: string;
  error?: boolean;
}

/**
 * Project stored rows into what the UI renders.
 *
 * Only user and assistant prose is shown as conversation. Tool calls and tool
 * results collapse into a small "action" confirmation — never raw JSON.
 *
 * Assistant prose is passed through `extractThinking`, so a rendered message is
 * always the ANSWER with any reasoning split out into `thought`. Doing this here
 * (rather than at write time) means rows stored before this change still display
 * correctly, and the stored `content` stays exactly what the provider sent.
 */
export function toViewMessages(rows: ChatMessageRow[]): AssistantViewMessage[] {
  const out: AssistantViewMessage[] = [];
  for (const row of rows) {
    if (row.role === 'user' && row.content) {
      out.push({ id: row.id, role: 'user', text: row.content });
    } else if (row.role === 'assistant' && row.content) {
      const { thought, body } = extractThinking(row.content, row.reasoning);
      out.push({
        id: row.id,
        role: 'assistant',
        text: body,
        thought: thought ?? undefined,
      });
    } else if (row.role === 'tool') {
      out.push({
        id: row.id,
        role: 'tool',
        text: row.display || row.content || 'Action completed',
        toolName: row.toolName ?? undefined,
        error: row.error,
      });
    }
  }
  return out;
}
