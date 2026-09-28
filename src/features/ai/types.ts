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
  /** Present on assistant turns that request one or more functions. */
  toolCalls?: ToolCall[];
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
