/**
 * Pure state model for the two-pane split view.
 *
 * Deliberately free of React, Dexie and the DOM so it can be verified directly.
 *
 * NOTHING here is persisted. The split, the ratio, which pane holds what and
 * any maximized pane are React state that lives only as long as the page does,
 * so a refresh always returns to the default single full-width dashboard.
 */

export type PaneKind = 'dashboard' | 'pdf' | 'notes' | 'assistant';

/** What one pane is showing. `resourceId`/`topicId` are per-kind. */
export interface PaneSlot {
  kind: PaneKind;
  /** For kind 'pdf': the resource being previewed. */
  resourceId?: string;
  /** For kind 'notes': the topic whose notes are being edited. */
  topicId?: string;
}

export interface SplitState {
  /** One entry in single-pane mode, two in split mode. */
  panes: PaneSlot[];
  /** Fraction of the split width given to the FIRST pane, 0.2 - 0.8. */
  ratio: number;
  /** Index of the temporarily maximized pane, or null when both are shown. */
  maximized: number | null;
}

/** The state on every load: one full-width dashboard, no split. */
export const initialSplitState: SplitState = {
  panes: [{ kind: 'dashboard' }],
  ratio: 0.5,
  maximized: null,
};

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

export const isSplit = (s: SplitState) => s.panes.length > 1;

/** Clamp a divider position to a usable range. */
export const clampRatio = (r: number) =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

/**
 * Open the split. Used both by the "split" button in single-pane mode and by
 * the PDF "split with notes" entry point, which supplies both pane slots.
 */
export function openSplit(state: SplitState, a: PaneSlot, b: PaneSlot): SplitState {
  return { panes: [a, b], ratio: 0.5, maximized: null };
}

/** Add a second pane beside the current one, cloning nothing. */
export function addSecondPane(state: SplitState, slot: PaneSlot): SplitState {
  if (isSplit(state)) return state;
  return openSplit(state, state.panes[0], slot);
}

/** Exchange the two panes' content. A no-op unless actually split. */
export function swapPanes(state: SplitState): SplitState {
  if (!isSplit(state)) return state;
  const [a, b] = state.panes;
  return { ...state, panes: [b, a], maximized: null };
}

/**
 * Collapse to a single full-width pane holding `keep`'s content. Closing the
 * last remaining pane is a no-op, since there must always be something shown.
 */
export function closePane(state: SplitState, index: number): SplitState {
  if (!isSplit(state)) return state;
  const keep = index === 0 ? 1 : 0;
  return { panes: [state.panes[keep]], ratio: 0.5, maximized: null };
}

/** Replace one pane's content. */
export function setPane(state: SplitState, index: number, slot: PaneSlot): SplitState {
  const panes = state.panes.slice();
  if (index < 0 || index >= panes.length) return state;
  panes[index] = slot;
  // A maximized pane whose content changed stays maximized; the new content is
  // simply what fills the maximized area.
  return { ...state, panes };
}

/**
 * Maximize one pane, or restore when it is already the maximized one.
 * Distinct from full-screen preview, which leaves the split entirely.
 */
export function toggleMaximize(state: SplitState, index: number): SplitState {
  if (!isSplit(state)) return state;
  return { ...state, maximized: state.maximized === index ? null : index };
}

/** The pane index that currently owns the visible area. */
export function activeIndex(state: SplitState): number {
  if (state.maximized !== null) return state.maximized;
  return 0;
}

/**
 * The starting state for a PDF's half-screen "notes" mode: the PDF on one side
 * and that PDF's own topic notes on the other. Both remain fully changeable
 * through each pane's own picker afterwards.
 */
export function splitWithNotes(resourceId: string, topicId: string | null): SplitState {
  return openSplit(
    initialSplitState,
    { kind: 'pdf', resourceId },
    { kind: 'notes', topicId: topicId ?? undefined },
  );
}
