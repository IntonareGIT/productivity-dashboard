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

/** Some providers return content as an array of parts instead of a string. */
function readContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

export async function chatCompletion(opts: {
  provider: AiProvider;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatCompletionResult> {
  const { provider, messages, tools, temperature = 0.2, maxTokens = 900 } = opts;

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

  return { content: readContent(message.content), toolCalls, raw: message };
}
