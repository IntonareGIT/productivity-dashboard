import type { AiProvider } from '../../types';
import { buildChatCompletionsUrl } from './aiProviderRepo';
import type { ChatMessage, ToolCall, ToolSpec } from './types';

/**
 * Minimal OpenAI-compatible chat client with function calling.
 *
 * Provider-agnostic by design: the endpoint, key and model all come from the
 * `AiProvider` row the user marked as default (see aiProviderRepo.ts).
 */

export class AiRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
  }
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: ToolCall[];
  /**
   * Provider-native reasoning, when present. Read from `reasoning_content`
   * (DeepSeek-style) or `reasoning`, whichever the provider used. `undefined`
   * for standard models that return neither.
   */
  reasoning?: string;
  /**
   * `choices[0].message` verbatim. When tool calls are present this MUST be
   * echoed back unchanged on the next request so provider-specific fields
   * (Gemini's `thought_signature`, etc.) survive. See ChatMessage.raw.
   */
  raw: Record<string, unknown>;
}

interface WireMessage {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Serialize stored messages for the wire.
 *
 * Assistant turns that requested tools are forwarded VERBATIM from `raw` when
 * we have it. Rebuilding them would strip unknown fields such as Gemini's
 * `extra_content.google.thought_signature`, which makes the follow-up request
 * fail with HTTP 400. Providers that send no signature simply have nothing
 * extra to carry, so passing the message through as-is is correct for them
 * too — we never synthesize placeholder values.
 */
function toWire(messages: ChatMessage[]): WireMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      if (m.raw) {
        // Unchanged pass-through of the provider's own message object.
        return { ...m.raw } as WireMessage;
      }
      // Fallback for histories that predate signature capture (e.g. restored
      // from an older backup) and never went through a provider response.
      return {
        role: 'assistant',
        content: m.content ? m.content : null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId,
        name: m.name,
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Read the provider-native reasoning field.
 *
 * Two names are in the wild — `reasoning_content` (DeepSeek and the gateways
 * that mirror it) and `reasoning` (several OpenAI-compatible servers). Both are
 * plain strings; anything else is ignored rather than coerced, so an object
 * shape we do not understand cannot end up rendered as "[object Object]".
 */
function readReasoning(message: Record<string, unknown>): string | undefined {
  for (const key of ['reasoning_content', 'reasoning']) {
    const value = message[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/**
 * Split a provider's `content` into the visible answer and its reasoning.
 *
 * Three shapes are in the wild:
 *  - a plain string;
 *  - an array of parts, where Gemini 3 marks each thinking part with
 *    `"thought": true` and sends the real answer in the unflagged parts. These
 *    MUST be split, not concatenated: joining them would splice the reasoning
 *    into the visible reply as untagged prose, so `extractThinking` would find
 *    no tags, `thought` would be null, and the thought block would never
 *    render — the reasoning would be silently shown as part of the answer
 *    instead;
 *  - a `thoughts` sibling array (some Gemini responses).
 *
 * Thought parts are dropped from the body so the answer stays clean, and the
 * caller falls back to the `reasoning_content`/`reasoning` field only when
 * nothing was found here.
 */
function readContent(value: unknown): { body: string; reasoning: string } {
  if (typeof value === 'string') return { body: value, reasoning: '' };

  if (Array.isArray(value)) {
    const body: string[] = [];
    const thought: string[] = [];
    for (const part of value) {
      if (typeof part === 'string') {
        body.push(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const p = part as {
        text?: unknown; thought?: unknown; type?: unknown; role?: unknown;
      };
      const text = typeof p.text === 'string' ? p.text : '';
      if (!text) continue;
      // Reasoning is flagged, not separated by position. Match loosely:
      // gateways have been seen sending `"thought": true`, `"thought": "true"`
      // and `type: "thinking"` / `type: "reasoning"`. A strict `=== true`
      // comparison silently misses the string and boolean variants, and the text
      // then lands in the body — which is exactly the "thinking shows in full
      // inside the message" symptom.
      const flagged =
        p.thought === true || p.thought === 'true' || p.thought === 1 ||
        p.type === 'thinking' || p.type === 'reasoning' ||
        p.role === 'reasoning';
      if (flagged) thought.push(text);
      else body.push(text);
    }
    return { body: body.join('').trim(), reasoning: thought.join('\n\n').trim() };
  }

  return { body: '', reasoning: '' };
}

/** Gemini may also return thinking in a `thoughts` array beside `content`. */
function readThoughtsArray(message: Record<string, unknown>): string {
  const thoughts = message.thoughts;
  if (!Array.isArray(thoughts)) return '';
  return thoughts
    .map((t) => {
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object') {
        const text = (t as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export async function chatCompletion(opts: {
  provider: AiProvider;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatCompletionResult> {
  // A thinking model draws its reasoning from the SAME `max_tokens` budget as
  // the answer, so a tight cap is spent on thinking and the reply comes back
  // empty or truncated. The budget has to cover both.
  const { provider, messages, tools, temperature = 0.2, maxTokens = 4096 } = opts;

  let res: Response;
  try {
    res = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.modelName,
        messages: toWire(messages),
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        temperature,
        max_tokens: maxTokens,
      }),
    });
  } catch (e) {
    throw new AiRequestError(
      e instanceof Error ? `Network error: ${e.message}` : 'Network error contacting the AI provider.'
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      // ignore
    }
    throw new AiRequestError(
      `Provider responded HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new AiRequestError('Provider returned a non-JSON response.');
  }

  const choice = (payload as { choices?: unknown[] })?.choices?.[0] as
    | { message?: Record<string, unknown> }
    | undefined;
  const message = choice?.message ?? {};

  const rawCalls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as Record<string, unknown>[])
    : [];
  const legacy = message.function_call as { name?: string; arguments?: string } | undefined;

  const toolCalls: ToolCall[] = rawCalls.map((call, index) => {
    const fn = (call.function ?? {}) as { name?: string; arguments?: string };
    return {
      id: typeof call.id === 'string' && call.id ? call.id : `call_${index}`,
      name: fn.name ?? '',
      arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
    };
  });

  if (toolCalls.length === 0 && legacy?.name) {
    toolCalls.push({
      id: 'call_legacy',
      name: legacy.name,
      arguments: typeof legacy.arguments === 'string' ? legacy.arguments : '{}',
    });
  }

  // Reasoning can arrive three ways, and they are combined rather than treated
  // as alternatives: Gemini's `thought: true` content parts, a `thoughts`
  // sibling array, and the `reasoning_content` / `reasoning` field. A provider
  // can legitimately send more than one, and losing any of it would hide part
  // of the model's thinking.
  const { body, reasoning: partReasoning } = readContent(message.content);
  const reasoning = [partReasoning, readThoughtsArray(message), readReasoning(message) ?? '']
    .filter((s) => s.trim())
    .join('\n\n');

  // Dev-only shape dump. The reasoning wire format is provider-specific and has
  // changed shape more than once, so guessing it is exactly how "thinking shows
  // in full inside the message" happens: an unrecognised shape is silently
  // concatenated into the answer. This logs the KEYS and part flags actually
  // received — never the text — so the real format can be confirmed in one run
  // instead of inferred. Enable with localStorage.setItem('ai:debug', '1').
  if (typeof localStorage !== 'undefined' && localStorage.getItem('ai:debug') === '1') {
    const parts = Array.isArray(message.content) ? message.content : null;
    const rawText = typeof message.content === 'string' ? message.content : '';
    // eslint-disable-next-line no-console
    console.debug('[ai] message shape', {
      contentType: parts ? 'array' : typeof message.content,
      partFlags: parts
        ? parts.map((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            return { type: o.type, thought: o.thought, role: o.role };
          })
        : undefined,
      messageKeys: Object.keys(message),
      hasThoughtsArray: Array.isArray(message.thoughts),
      reasoningFields: ['reasoning_content', 'reasoning', 'reasoning_details']
        .filter((k) => message[k] !== undefined),
      // True when the raw body still contains a think tag after parsing — i.e.
      // the tag shape is one we do NOT handle. This is the smoking gun.
      bodyStillHasThinkTag: /<\s*\/?\s*(think|thinking|reasoning)\b/i.test(rawText),
    });
  }

  return { content: body, toolCalls, raw: message, reasoning: reasoning || undefined };
}
