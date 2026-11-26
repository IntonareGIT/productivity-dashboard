import type { PaneKind, PaneSlot } from '../split/splitModel';

/**
 * The single visibility rule for the floating AI button.
 *
 * Every surface that decides whether the bubble is showing calls this one
 * function, rather than each place re-deriving the condition. That is the only
 * way the rule can be genuinely "used everywhere": four copies of
 * `hidden={splitOpen}` is exactly how the button ended up covering the assistant
 * pane's composer in the first place, because one of the copies was wrong.
 *
 * The rule, in order:
 *
 *  1. The setting is off, so it is hidden in BOTH modes. One switch covers both.
 *  2. A pane is in true fullscreen. The fullscreen layer sits above everything,
 *     and a bubble peeking out of it is worse than no bubble at all.
 *  3. The assistant is the current full view. The user is already talking to it,
 *     so a second entry point is just noise.
 *  4. Some pane is showing the assistant. This covers the standalone case too,
 *     because the "expanded" assistant is a single pane of kind 'assistant', so
 *     one check serves both layouts.
 *  5. Otherwise: show it. That is today's behaviour outside split view, and the
 *     behaviour we want inside it.
 */
export interface FloatingAiVisibilityInput {
  /** Split view is open, with two panes side by side. */
  splitOpen: boolean;
  /** The panes currently rendered. One entry in standalone mode. */
  panes: readonly PaneSlot[];
  /** The full-page assistant is showing. */
  assistantPage?: boolean;
  /** The "Show floating AI button" setting. Treated as ON when omitted. */
  settingEnabled?: boolean;
  /** A pane is in true fullscreen, PDF or image. */
  fullscreenActive?: boolean;
}

/** True when any pane is currently showing the assistant. */
export function anyPaneIsAssistant(panes: readonly PaneSlot[]): boolean {
  return panes.some((p) => p?.kind === 'assistant');
}

export function shouldShowFloatingAi(input: FloatingAiVisibilityInput): boolean {
  // Default ON when the caller has no settings value yet. Treating `undefined`
  // as OFF would make the button vanish on first run before settings load, which
  // reads as a bug rather than as a preference.
  if (input.settingEnabled === false) return false;
  if (input.fullscreenActive) return false;
  if (input.assistantPage) return false;
  if (anyPaneIsAssistant(input.panes)) return false;
  // `splitOpen` deliberately does not change the answer. The rule is the same
  // whether or not split view is open, which is the whole point of it: if the
  // rule could disagree with itself between modes it would be two rules wearing
  // one name. It stays in the input because every call site already has it.
  void input.splitOpen;
  return true;
}

export type { PaneKind };
