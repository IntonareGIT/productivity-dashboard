import { create } from 'zustand';
import type { PaneKind } from '../features/split/splitModel';

/**
 * Bridge between the AI assistant's tools and the split view.
 *
 * The split state itself deliberately lives as React state in `App.tsx` (React
 * state only — never persisted, so a refresh returns to the default single
 * dashboard). A tool cannot reach React state, so instead of moving the split
 * into a store — which would break that invariant — a tool QUEUES a command
 * here and `App` applies it to `splitState` through the same `splitModel`
 * functions the UI uses. One reducer, one owner.
 */

export type SplitAction = 'open' | 'close' | 'swap';
export type SplitPaneSide = 'left' | 'right';
/** The view types the model exposes to the assistant (never 'empty'). */
export type SplitViewType = 'pdf' | 'notes' | 'dashboard' | 'assistant';

export interface SplitCommand {
  /** Unique so `App` can tell two identical commands apart. */
  id: string;
  action: SplitAction;
  pane?: SplitPaneSide;
  viewType?: SplitViewType;
  resourceId?: string;
  /** For a notes pane: the topic whose notes to show. */
  topicId?: string;
}

/** What the split currently looks like, published by `App` for honest summaries. */
export interface SplitSnapshot {
  open: boolean;
  panes: PaneKind[];
  maximized: number | null;
}

interface SplitCommandState {
  /** The pending command, or null when there is nothing to do. */
  command: SplitCommand | null;
  snapshot: SplitSnapshot | null;
  /** Queue one command for `App` to apply. Returns its id. */
  request: (cmd: Omit<SplitCommand, 'id'>) => string;
  /** Called by `App` once the command has been applied. */
  settle: (id: string) => void;
  /** Called by `App` whenever the split changes shape. */
  publish: (snapshot: SplitSnapshot) => void;
  /** Test/reset helper. */
  reset: () => void;
}

let seq = 0;
const nextId = () => `split_${++seq}`;

export const useSplitCommandStore = create<SplitCommandState>((set) => ({
  command: null,
  snapshot: null,

  request: (cmd) => {
    const id = nextId();
    set({ command: { ...cmd, id } });
    return id;
  },

  // Only clear when it is still the command we ran, so a command queued while
  // this one was being applied is never swallowed.
  settle: (id) => set((s) => (s.command && s.command.id === id ? { command: null } : {})),

  publish: (snapshot) => set({ snapshot }),

  reset: () => set({ command: null, snapshot: null }),
}));

/** Convenience for tools: queue a command without importing zustand. */
export function requestSplitCommand(cmd: Omit<SplitCommand, 'id'>): string {
  return useSplitCommandStore.getState().request(cmd);
}

/** Human-readable label for an action pill, e.g. "Opening Split View…". */
export function describeSplitCommand(cmd: Omit<SplitCommand, 'id'>): string {
  const side = cmd.pane === 'right' ? 'right' : 'left';
  switch (cmd.action) {
    case 'close':
      return 'Closing Split View…';
    case 'swap':
      return 'Swapping Panes…';
    default: {
      const what = cmd.viewType ? SPLIT_VIEW_LABELS[cmd.viewType] : 'a pane';
      return `Opening ${what} in the ${side} pane…`;
    }
  }
}

export const SPLIT_VIEW_LABELS: Record<SplitViewType, string> = {
  pdf: 'the PDF',
  notes: 'Notes',
  dashboard: 'the Dashboard',
  assistant: 'the Assistant',
};
