import { db } from '../../db/db';
import type { ChatMessageRow, ChatSession } from '../../types';
import { newId } from '../../utils/id';
import type { ChatMessage } from './types';
import { extractThinking } from './thinking';

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
 * Rebuild a request transcript from stored rows using the most recent `limit`
 * messages, without ever splitting a tool-call sequence.
 *
 * Two rules matter for the provider:
 *  1. An assistant message carrying `tool_calls` must stay together with the
 *     `tool` messages answering it.
 *  2. What we send is the stored `raw` object, never a reconstruction.
 *
 * Orphaned tool results (whose parent fell outside the window) are dropped
 * rather than sent, since an unpaired `tool_call_id` is rejected outright.
 */
export function buildTranscript(rows: ChatMessageRow[], limit = 20): ChatMessage[] {
  if (rows.length === 0) return [];

  // Index of the assistant turn that issued a given tool call.
  const parentOf = (callId: string) =>
    rows.findIndex((c) => c.role === 'assistant' && c.toolCallIds && c.toolCallIds.includes(callId));

  // Start as late as the limit allows, then move earlier if any tool result in
  // the tail needs its issuing turn. The window may end up slightly longer than
  // `limit` — that is deliberate: a tool_calls turn must never be separated
  // from the results answering it.
  let start = Math.max(0, rows.length - limit);
  for (const m of rows.slice(start)) {
    if (m.role === 'tool' && m.toolCallId) {
      const parent = parentOf(m.toolCallId);
      if (parent >= 0) start = Math.min(start, parent);
    }
  }

  return closeDanglingCalls(
    rows
      .slice(start)
      // Never send a tool result that no assistant turn asked for.
      .filter((r) => !(r.role === 'tool' && r.toolCallId && parentOf(r.toolCallId) < 0))
      .map(toChatMessage)
  );
}

/**
 * Guarantee every `tool_calls` turn is immediately followed by a tool turn
 * answering it.
 *
 * The provider requires the sequence `user -> model call -> tool response ->
 * model answer`. An assistant call with no response after it is rejected with
 * HTTP 400, so a single unanswered call poisons every later request in that
 * session. The store refuses to create that state, but rows written before that
 * guard — or by an older build, or restored from a backup — can still contain
 * it, and those rows are never rewritten.
 *
 * So this is the backstop: any call id left unanswered gets a synthetic
 * function response saying so. The model can then recover on its own ("that
 * action did not run") instead of the request failing outright. The synthetic
 * turn is added to the outgoing payload ONLY — nothing is persisted, so this can
 * never invent history in the database.
 */
function closeDanglingCalls(messages: ChatMessage[]): ChatMessage[] {
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
