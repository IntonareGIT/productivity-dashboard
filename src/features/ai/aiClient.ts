import type { AiProvider } from '../../types';
import { buildChatCompletionsUrl } from './aiProviderRepo';
import { normalizeHistoryForProvider, logRepair } from './historyNormalizer';
import type { ChatMessage, ToolCall, ToolSpec } from './types';

/**
 * Minimal OpenAI-compatible chat client with function calling.
 *
 * Provider-agnostic by design: the endpoint, key and model all come from the
 * `AiProvider` row the user marked as default (see aiProviderRepo.ts).
 */

export class AiRequestError extends Error {
  status?: number;
  /**
   * Whether retrying the SAME request could plausibly succeed.
   *
   * Split out from the status code because it is not the same question:
   * a 503 is transient, a 401 never is, and a 429 is transient *unless* the
   * text says the daily quota is spent, which no wait can fix.
   */
  retryable: boolean;
  /** Provider-suggested wait, parsed from `Retry-After`, in ms. */
  retryAfterMs?: number;
  /** True for a 429 that says the daily quota is exhausted. */
  quotaExhausted: boolean;
  constructor(
    message: string,
    status?: number,
    opts: { retryable?: boolean; retryAfterMs?: number; quotaExhausted?: boolean } = {},
  ) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    this.quotaExhausted = opts.quotaExhausted ?? false;
  }
}

/** Statuses worth retrying: server-side overload, rate limiting, gateway. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Statuses that will never succeed on a retry: shown to the user at once. */
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Backoff schedule for the retries, in ms, before jitter is added.
 *
 * 1s, 2s, 4s, 8s: four retries, then the request is declared failed. A provider
 * that has been overloaded for ~15s is not going to recover for a shorter
 * burst, and hammering it makes the overload worse for everyone.
 */
export const RETRY_BASE_DELAYS_MS = [1000, 2000, 4000, 8000];

/** Random extra wait, so N clients recovering at once do not stampede. */
export const MAX_JITTER_MS = 500;

/**
 * Test hook: shorten or disable the backoff.
 *
 * The retry policy is verified by driving real backoff waits, which would make
 * the suite take 15 seconds per failure case. Tests call
 * `__setRetryTiming([1, 1, 1, 1])` to keep the policy honest (the same code
 * path, the same counters) without the wall-clock cost. Production never calls
 * it, so the real delays above are what ship.
 */
let retryDelays = RETRY_BASE_DELAYS_MS;
export function __setRetryTiming(delays: number[] | null): void {
  retryDelays = delays ?? RETRY_BASE_DELAYS_MS;
}

export function isRetryableStatus(status: number): boolean {
  if (FATAL_STATUSES.has(status)) return false;
  return RETRYABLE_STATUSES.has(status);
}

/**
 * "The daily quota is exhausted" can never be fixed by waiting a few seconds,
 * so retrying only delays the honest message. Detect it from the body text.
 */
export function quotaExhausted(text: string): boolean {
  return /quota|per day|daily limit|billing|exceeded your current quota/i.test(text);
}

/**
 * Parse `Retry-After`, which is either a delay in seconds or an HTTP date.
 * A malformed or absent header yields null, and the exponential backoff is
 * used instead.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Full wait before retry `index` (0-based): backoff, jitter, or Retry-After. */
export function retryDelayMs(index: number, retryAfterMs?: number, rand = Math.random): number {
  if (retryAfterMs != null) return retryAfterMs;
  const base = retryDelays[index] ?? retryDelays[retryDelays.length - 1] ?? 1000;
  return base + Math.floor(rand() * MAX_JITTER_MS);
}

/** How many times ONE request is retried before it is declared failed. */
export const MAX_RETRIES = 4;

/** Never a useful outcome, so it replaces the raw provider error in the UI. */
export const OVERLOADED_MESSAGE =
  'The model is overloaded right now. Try again in a minute or switch model in Settings.';

/** Why a request failed, in the user's terms rather than the provider's JSON. */
export function friendlyError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof AiRequestError) {
    if (err.quotaExhausted) {
      return {
        message:
          'The daily quota for this model is used up, so no more requests will go through today. Switch model in Settings, or wait for the quota to reset.',
        retryable: false,
      };
    }
    if (err.status === 401 || err.status === 403) {
      return { message: 'The provider rejected the API key. Check it in Settings.', retryable: false };
    }
    if (err.status === 404) {
      return { message: 'The provider does not recognize that model name. Check it in Settings.', retryable: false };
    }
    if (err.retryable) return { message: OVERLOADED_MESSAGE, retryable: true };
    return { message: err.message, retryable: false };
  }
  return {
    message: 'The model could not be reached. Check your connection, or try again in a moment.',
    retryable: true,
  };
}

export interface ChatCompletionOptions {
  provider: AiProvider;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Cancels this one request. The store owns one controller per user turn, so
   * Stop aborts the in-flight fetch, the backoff wait, and the whole turn at
   * once (Phase 2).
   */
  signal?: AbortSignal;
  /** Called before each backoff wait, for the "retrying (2/4)" status line. */
  onRetry?: (info: { attempt: number; max: number; delayMs: number; error: AiRequestError }) => void;
  /** Model tried once if every retry of the primary model fails. Off by default. */
  fallbackModel?: string | null;
}

/** A sleep that rejects as soon as the turn is aborted. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiRequestError('Stopped', undefined, { retryable: false }));
      return;
    }
    const onAbort = () => {
      // Clearing the timer is what makes Stop during a backoff wait take
      // effect at once: no further request is issued after this point.
      clearTimeout(timer);
      reject(new AiRequestError('Stopped', undefined, { retryable: false }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  /**
   * The fallback model that produced this answer, when the primary model failed
   * every retry. Absent for a normal answer, which is what lets the UI show
   * "Answered by fallback model <name>" only when it is true.
   */
  answeredByFallback?: string;
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

/**
 * One HTTP attempt. Throws `AiRequestError`, classified as retryable or not.
 *
 * Deliberately does NOT retry anything: the loop lives in `chatCompletion`, so
 * every provider, every caller and every tool round shares one policy.
 */
async function attemptCompletion(
  provider: AiProvider,
  body: string,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body,
      signal,
    });
  } catch (e) {
    // An abort is the user pressing Stop, not a network fault, so it must not
    // be retried: retrying would fight the Stop they just asked for.
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new AiRequestError('Stopped', undefined, { retryable: false });
    }
    // A thrown fetch is a dropped connection or a DNS failure: transient, and
    // the one failure mode no server-side status code can tell us about.
    throw new AiRequestError(
      e instanceof Error ? `Network error: ${e.message}` : 'Network error contacting the AI provider.',
      undefined,
      { retryable: true },
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      // ignore
    }
    const isQuota = res.status === 429 && quotaExhausted(detail);
    throw new AiRequestError(
      `Provider responded HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      res.status,
      {
        // An exhausted daily quota is the one 429 that waiting cannot fix.
        retryable: !isQuota && isRetryableStatus(res.status),
        retryAfterMs: parseRetryAfter(res.headers?.get?.('Retry-After') ?? null),
        quotaExhausted: isQuota,
      },
    );
  }
  return res;
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { provider, tools, temperature = 0.2, maxTokens = 4096 } = opts;
  const { signal, onRetry, fallbackModel } = opts;

  // EVERY request goes through the one normalizer, here, so the main path, each
  // retry, the fallback model and every tool round are covered by construction
  // rather than by each call site remembering to. It works on a COPY: the
  // caller's array and the stored rows are untouched.
  const normalized = normalizeHistoryForProvider(opts.messages, 'gemini');
  logRepair(normalized.report);
  const messages = normalized.messages as ChatMessage[];

  // A thinking model draws its reasoning from the SAME `max_tokens` budget as
  // the answer, so a tight cap is spent on thinking and the reply comes back
  // empty or truncated. The budget has to cover both.
  const buildBody = (model: string) =>
    JSON.stringify({
      model,
      messages: toWire(messages),
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      temperature,
      max_tokens: maxTokens,
    });

  // Retry the REQUEST, never the turn. The transcript, the stored session rows
  // and any tool results already recorded are untouched by this loop, so a
  // retry can never re-run a create, rename or delete, and can never send the
  // user message twice.
  let lastError: AiRequestError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await attemptCompletion(provider, buildBody(provider.modelName), signal);
    } catch (e) {
      const err = e instanceof AiRequestError ? e : new AiRequestError(String(e));
      // Stopped, or a status that will never succeed: surface it now.
      if (!err.retryable) throw err;
      lastError = err;
      if (attempt >= MAX_RETRIES) break;
      const delayMs = retryDelayMs(attempt, err.retryAfterMs);
      onRetry?.({ attempt: attempt + 1, max: MAX_RETRIES, delayMs, error: err });
      await abortableDelay(delayMs, signal);
      continue;
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AiRequestError('Provider returned a non-JSON response.');
    }
    return readCompletion(payload);
  }

  // Every retry of the primary model failed. Try the optional fallback ONCE,
  // with no further retries: it is a different model, not a fresher attempt at
  // the same one, so backing off again would only multiply the wait.
  const fallback = (fallbackModel ?? '').trim();
  if (fallback && !signal?.aborted) {
    const res = await attemptCompletion(provider, buildBody(fallback), signal);
    const payload = await res.json();
    return { ...readCompletion(payload), answeredByFallback: fallback };
  }

  throw lastError ?? new AiRequestError('The provider could not be reached.');
}

/** Turn a parsed provider payload into the normalized result shape. */
function readCompletion(payload: unknown): ChatCompletionResult {
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
