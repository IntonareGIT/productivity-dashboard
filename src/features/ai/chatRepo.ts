import { db } from '../../db/db';
import type { ChatMessageRow, ChatSession } from '../../types';
import { newId } from '../../utils/id';
import type { ChatMessage } from './types';

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

  return rows
    .slice(start)
    // Never send a tool result that no assistant turn asked for.
    .filter((r) => !(r.role === 'tool' && r.toolCallId && parentOf(r.toolCallId) < 0))
    .map(toChatMessage);
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
  error?: boolean;
}

/**
 * Project stored rows into what the UI renders.
 *
 * Only user and assistant prose is shown as conversation. Tool calls and tool
 * results collapse into a small "action" confirmation — never raw JSON.
 */
export function toViewMessages(rows: ChatMessageRow[]): AssistantViewMessage[] {
  const out: AssistantViewMessage[] = [];
  for (const row of rows) {
    if (row.role === 'user' && row.content) {
      out.push({ id: row.id, role: 'user', text: row.content });
    } else if (row.role === 'assistant' && row.content) {
      out.push({ id: row.id, role: 'assistant', text: row.content });
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
