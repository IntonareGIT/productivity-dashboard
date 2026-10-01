/**
 * The ONE normalizer every provider request goes through.
 *
 * A Gemini-style provider rejects a transcript whose function-call turns are not
 * in the sequence `user -> model call -> function response -> model answer` with
 * HTTP 400 INVALID_ARGUMENT, and the failure is STICKY: the rows are in the
 * database, so every later message in that chat fails too. A single unfixed
 * stopped turn turns a chat into a dead end the user can only escape by deleting
 * their own history.
 *
 * This module exists because the repairs were previously scattered: the window
 * moved the start, `closeDanglingCalls` patched some unanswered calls, and the
 * store patched a Confirm card or two by hand. Each handled one shape, and a
 * parallel tool call whose second result was missing slipped between them and
 * came out as `call(c1,c2), response(c2), response(c1)`.
 *
 * Two hard rules:
 *  1. It operates on a COPY. Stored rows are never touched, so a repair can
 *     never invent history and can never lose it.
 *  2. It is the only thing allowed to shape the messages. Trimming, retries, the
 *     fallback model and every tool round all go through it.
 */

/**
 * The role a turn carries. `system` is included because the request builder
 * prepends one, and the normalizer has to pass it through untouched while
 * ignoring it for every ordering rule.
 */
export type TurnRole = 'system' | 'user' | 'assistant' | 'tool';

/** The minimum a turn needs for this module to reason about it. */
export interface NormalizableMessage {
  role: TurnRole;
  content?: string | null;
  toolCalls?: { id: string; name: string; arguments: string }[];
  toolCallId?: string;
  name?: string;
  /** Anything else the provider needs, passed through untouched. */
  raw?: Record<string, unknown>;
}

/** What the normalizer changed, so callers can log or surface it. */
export interface NormalizeReport {
  repaired: boolean;
  /** Short, human-readable list of what was fixed. */
  fixes: string[];
}

/** The exact wording used when a call never got an answer. */
export const NOT_EXECUTED = 'Not executed or interrupted';

const syntheticResult = (id: string, name: string): NormalizableMessage => ({
  role: 'tool',
  content: JSON.stringify({ ok: false, error: NOT_EXECUTED }),
  toolCallId: id,
  name,
});

const hasCalls = (m: NormalizableMessage): boolean =>
  m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0;

/**
 * Trim to a window that starts at a USER turn and never splits a call from its
 * responses.
/**
 * Trim to a window that starts at a USER turn and never splits a call from its
 * responses.
 *
 * The window may come out SHORTER than `limit` when a cut would land inside an
 * exchange. That is the correct trade: the alternative is a request the provider
 * refuses, so the user gets no answer at all.
 */
export function trimToWindow(
  messages: NormalizableMessage[],
  limit: number,
): { window: NormalizableMessage[]; dropped: number } {
  if (messages.length <= limit) return { window: messages.slice(), dropped: 0 };

  // Walk the candidate cut back to the start of its exchange. An exchange starts
  // at a user turn, so that is where the window must begin. This is what stops
  // a cut from landing between a function call and its responses.
  let start = messages.length - limit;
  while (start > 0 && messages[start].role !== 'user') start -= 1;
  return { window: messages.slice(start), dropped: start };
}
/**
 * Make a message list safe to send, without touching the original.
 *
 * Guarantees, in the order they are enforced:
 *  1. it starts with a user turn;
 *  2. a model turn carrying function calls follows a user turn or a function
 *     response, never another model turn;
 *  3. every call is answered by responses immediately after it, in the SAME
 *     ORDER the calls were made; missing ones get a synthetic response;
 *  4. a function response with no matching earlier call is dropped;
 *  5. no two consecutive turns share a role (consecutive user turns merge,
 *     consecutive model text turns merge), and no turn is empty;
 *  6. it ends on a user turn or a function response.
 *
 * `providerFormat` is accepted so another provider can relax a rule later
 * without changing every call site. Today the rules always apply: they are
 * correct for the OpenAI-compatible shape too, and a chat that works against one
 * provider should not break against the other.
 */
export function normalizeHistoryForProvider(
  messages: NormalizableMessage[],
  providerFormat: 'gemini' | 'openai' = 'gemini',
): { messages: NormalizableMessage[]; report: NormalizeReport } {
  const fixes: string[] = [];
  const note = (s: string) => { if (!fixes.includes(s)) fixes.push(s); };

  // A system turn is passed through untouched and never counts as the start.
  const system = messages.filter((m) => m.role === 'system');
  const body = messages.filter((m) => m.role !== 'system');
  const out: NormalizableMessage[] = [];

  for (let i = 0; i < body.length; i += 1) {
    let m = body[i];

    // ---- 4. a response nobody asked for. A tool row is only legal directly
    // after the model turn whose calls it answers, which is exactly what the
    // caller below emits, so anything landing here is an orphan.
    if (m.role === 'tool') {
      note(`dropped an orphan tool response (${m.toolCallId ?? 'unknown'})`);
      continue;
    }

    // ---- a model turn carrying calls
    if (hasCalls(m)) {
      const calls = m.toolCalls as { id: string; name: string }[];
      const prev = out[out.length - 1];

      // ---- 2. it must follow a user turn or a response, never another model
      // turn. When a model TEXT turn sits between the user and the call, its
      // content is folded INTO the call turn rather than dropped: an assistant
      // message may carry both text and tool calls, so the words the model
      // already said survive and the two-turns-in-a-row rule is satisfied.
      if (prev && prev.role === 'assistant' && !hasCalls(prev)) {
        const carry = prev.content ?? '';
        if (carry.trim()) {
          m = { ...m, content: [carry, m.content ?? ''].filter(Boolean).join('\n').trim() };
          out.pop();
          note('folded a model text turn into the function call that followed it');
        } else {
          out.pop();
          note('dropped an empty model turn before a function call');
        }
      }
      // A call with nothing before it cannot open the conversation; it is dropped
      // rather than left leading, because the provider rejects that.
      if (out.length === 0 || out[out.length - 1].role !== 'user') {
        note('dropped a function call that had no preceding user turn');
        continue;
      }

      // The responses that genuinely follow this call, in stored order.
      const real = new Map<string, NormalizableMessage>();
      for (let j = i + 1; j < body.length && body[j].role === 'tool'; j += 1) {
        const id = body[j].toolCallId as string | undefined;
        if (id && !real.has(id)) real.set(id, body[j]);
      }

      out.push(m);
      // Responses go here, in CALL ORDER. This ordering is the bug that shipped:
      // the synthetic was appended right after the call, so a sibling that
      // already had a stored response came out as [c2, c1].
      for (const c of calls) {
        const stored = real.get(c.id);
        out.push(stored ?? syntheticResult(c.id, c.name));
        if (!stored) note(`added a synthetic response for "${c.id}"`);
      }
      // Skip the tool rows just consumed.
      while (i + 1 < body.length && body[i + 1].role === 'tool') i += 1;
      continue;
    }

    // ---- 5. an empty model turn carries nothing and is rejected
    if (m.role === 'assistant' && !m.content) {
      note('dropped an empty model turn');
      continue;
    }

    // ---- 5. never two of the same role in a row. A tool row cannot reach here
    // (it is always handled above), so only user and model turns merge.
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      note(`merged two consecutive ${m.role} turns`);
      out[out.length - 1] = {
        ...prev,
        content: `${prev.content ?? ''}\n${m.content ?? ''}`.trim(),
      };
      continue;
    }
    out.push(m);
  }

  // ---- 6. a request must not end on a model turn
  while (out.length > 0 && out[out.length - 1].role === 'assistant') {
    out.pop();
    note('dropped a trailing model turn so the request ends on the user');
  }
  // ---- 1. and must start with one
  while (out.length > 0 && out[0].role !== 'user') {
    out.shift();
    note('dropped leading turns so the request starts with the user');
  }
  // Any tool row the leading trim orphaned goes too. The check has to look back
  // over the WHOLE run of tool rows, not just the previous message: after a call
  // with two responses the second one's immediate predecessor is the first
  // response, which carries no calls of its own. Testing only the previous
  // message silently deleted every response after the first.
  const cleaned = out.filter((m, idx) => {
    if (m.role !== 'tool') return true;
    for (let k = idx - 1; k >= 0; k -= 1) {
      if (out[k].role === 'tool') continue;
      return hasCalls(out[k]) && (out[k].toolCalls ?? []).some((c) => c.id === m.toolCallId);
    }
    return false;
  });

  void providerFormat;
  return {
    messages: [...system, ...cleaned],
    report: { repaired: fixes.length > 0, fixes },
  };
}

/** Log what the normalizer repaired. Content is never logged. */
export function logRepair(report: NormalizeReport, providerFormat = 'gemini'): void {
  if (!report.repaired) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[ai] repaired conversation history (${providerFormat}): ${report.fixes.join('; ')}`,
  );
}
