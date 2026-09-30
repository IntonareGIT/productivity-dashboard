/** Chat + function-calling types shared by the client, tools and store. */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;        // provider-assigned call id
  name: string;      // function name
  arguments: string; // raw JSON string as sent by the model
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Provider-native reasoning, when the model returned one (`reasoning_content`
   * on DeepSeek-style payloads, `reasoning` on others). Kept SEPARATE from
   * `content` so the answer replays verbatim on the wire while the UI can still
   * show the reasoning in a collapsible block.
   */
  reasoning?: string;
  /** Present on assistant turns that request one or more functions. */
  toolCalls?: ToolCall[];
  /**
   * The assistant message EXACTLY as the provider returned it
   * (`choices[0].message`), kept verbatim.
   *
   * This is load-bearing: Gemini 3 returns a `thought_signature` on every
   * tool call (under `extra_content.google` in the OpenAI-compatible shape)
   * and rejects the follow-up request with HTTP 400 "Function call is
   * missing a thought_signature" if it is stripped. Reconstructing the
   * message from id/name/arguments — as we used to — silently drops it.
   * Anything unknown to us must therefore be round-tripped untouched.
   */
  raw?: Record<string, unknown>;
  /** Present on 'tool' turns: which call this result answers. */
  toolCallId?: string;
  /** Present on 'tool' turns: the function name (some providers require it). */
  name?: string;
  /** UI-only friendly summary of a tool result (never sent to the model). */
  display?: string;
  /** UI-only marker for a step that failed (e.g. tool execution error). */
  error?: boolean;
}

/** OpenAI-compatible function/tool declaration sent to the provider. */
export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
