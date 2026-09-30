/**
 * Model-agnostic "thinking" extraction.
 *
 * Different providers expose a model's reasoning in different shapes, and the
 * UI must not care which:
 *
 *  - Inline tags  — `<think>…</think>`, `<thinking>…</thinking>`,
 *    `<reasoning>…</reasoning>`, as emitted by DeepSeek-R1-style models and by
 *    several open models behind OpenAI-compatible gateways.
 *  - A native field — `reasoning_content` (DeepSeek), `reasoning` (others),
 *    returned SIBLING to `content` and never part of the answer text.
 *
 * Both collapse into one plain string here. Standard models produce neither, and
 * then `thought` is `null` so the UI can bypass the thought block entirely
 * instead of rendering an empty shell.
 *
 * Deliberately pure — no React, no Dexie, no network — so it can be verified
 * directly (see scripts/verify-thinking.mjs).
 */

/** Tag names treated as "this is the model thinking out loud". */
const THINK_TAGS = 'think|thinking|reasoning';

export interface ParsedThinking {
  /** The reasoning, or null when the response carried none. */
  thought: string | null;
  /** The visible answer, with every thought block removed. */
  body: string;
}

/**
 * Tidy whitespace WITHOUT re-indenting lines: collapsing runs of blank lines is
 * safe, but trimming every line would destroy the indentation inside code
 * blocks a model often reasons in.
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split a reply into its reasoning and its answer.
 *
 * `reasoning` is the provider-native field, if the response had one. The two
 * sources are combined rather than treated as alternatives, because a provider
 * can legitimately return both (a native field plus a tagged block), and losing
 * either would silently hide part of the model's reasoning.
 */
export function extractThinking(content: string, reasoning?: string | null): ParsedThinking {
  const text = typeof content === 'string' ? content : '';
  const parts: string[] = [];
  let rest = text;

  // 1. Paired blocks. Non-greedy, so two blocks on one line stay separate, and
  //    back-referenced so `<think>` is only closed by `</think>`.
  const paired = new RegExp(`<(${THINK_TAGS})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'gi');
  rest = rest.replace(paired, (_whole, _tag: string, inner: string) => {
    parts.push(inner);
    return '\n';
  });

  // 2. An UNCLOSED opening tag. This is what a still-streaming reply looks like,
  //    and it is also what a model that forgot the closing tag produces — in
  //    both cases everything after the tag is reasoning, and the answer is
  //    whatever preceded it.
  const unclosed = new RegExp(`<(${THINK_TAGS})\\b[^>]*>([\\s\\S]*)$`, 'i');
  const dangling = rest.match(unclosed);
  if (dangling) {
    parts.push(dangling[2]);
    rest = rest.slice(0, dangling.index ?? 0);
  }

  // 3. The provider-native field.
  if (typeof reasoning === 'string' && reasoning.trim()) parts.push(reasoning);

  // Blank tags (`<think></think>`) and a whitespace-only field are NOT
  // reasoning: `thought` must be null so the UI bypasses the block entirely,
  // while the body still has the (empty) tag stripped out of it.
  const joined = tidy(parts.join('\n\n'));
  return { thought: joined ? joined : null, body: tidy(rest) };
}

/**
 * First non-empty line of reasoning, for a collapsed one-line hint.
 * Whitespace-only reasoning yields an empty string rather than `undefined`.
 */
export function thoughtPreview(thought: string, max = 80): string {
  const line = thought.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
