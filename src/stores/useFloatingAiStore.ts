import { create } from 'zustand';

/** Storage key. Namespaced so it cannot collide with another feature's keys. */
export const FLOATING_AI_KEY = 'floating-ai:v1';

/**
 * Per-device remembered state for the floating AI button.
 *
 * localStorage, deliberately, and not the synced `uiState` row:
 *
 *  - Where someone parks a bubble is a property of THAT device. A phone and a
 *    laptop have different screen sizes, different safe-area insets and
 *    different pane layouts, so syncing a pixel position would move the button
 *    somewhere meaningless on the other device. The brief asks for per-device
 *    memory for the same reason.
 *  - It avoids a Dexie schema version bump, and therefore avoids a migration for
 *    what is a display preference rather than user data.
 *
 * The two position slots are stored SEPARATELY on purpose. The split-mode and
 * standalone-mode bubbles live in different places, and the user usually drags
 * each somewhere different; one shared slot would make them fight each other on
 * every switch between modes.
 */
export type BubbleEdge = 'left' | 'right';
export type BubbleMode = 'split' | 'standalone';

export interface FloatingAiMemory {
  /** Vertical position as a fraction of the usable height, 0 to 1. */
  yFraction: number;
  edge: BubbleEdge;
}

/** Defaults: split sits at roughly mid-height on the right; standalone keeps today's bottom-right. */
const DEFAULT_MEMORY: Record<BubbleMode, FloatingAiMemory> = {
  split: { yFraction: 0.5, edge: 'right' },
  standalone: { yFraction: 0.82, edge: 'right' },
};

interface FloatingAiState {
  /** The "Show floating AI button" setting. Defaults to on. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  memory: Record<BubbleMode, FloatingAiMemory>;
  remember: (mode: BubbleMode, next: FloatingAiMemory) => void;
}

interface PersistedShape {
  enabled: boolean;
  memory: Record<BubbleMode, FloatingAiMemory>;
}

/**
 * Read persisted state, defensively.
 *
 * Everything is validated rather than trusted: this is user-editable
 * localStorage, and a hand-edited or half-written value must not be able to put
 * the bubble at NaN or off-screen. Anything unrecognised falls back to the
 * default for that field only, so one bad key does not discard the rest.
 */
function load(): PersistedShape {
  const fallback: PersistedShape = { enabled: true, memory: { ...DEFAULT_MEMORY } };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(FLOATING_AI_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    const out: PersistedShape = { enabled: true, memory: { ...DEFAULT_MEMORY } };
    if (typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
    for (const mode of ['split', 'standalone'] as BubbleMode[]) {
      const m = parsed.memory?.[mode];
      if (!m) continue;
      const y = typeof m.yFraction === 'number' && Number.isFinite(m.yFraction) ? m.yFraction : NaN;
      out.memory[mode] = {
        // Clamped, so a stored value can never place the bubble off-screen.
        yFraction: Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : DEFAULT_MEMORY[mode].yFraction,
        edge: m.edge === 'left' ? 'left' : 'right',
      };
    }
    return out;
  } catch {
    // Corrupt JSON must not break the app's boot.
    return fallback;
  }
}

function save(state: PersistedShape): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FLOATING_AI_KEY, JSON.stringify(state));
  } catch {
    // Private browsing, or a full quota. The setting still applies for this
    // session; it just will not survive a reload.
  }
}

export const useFloatingAiStore = create<FloatingAiState>((set, get) => ({
  ...load(),

  setEnabled: (on) => {
    set({ enabled: on });
    save({ enabled: on, memory: get().memory });
  },

  remember: (mode, next) => {
    const memory = { ...get().memory, [mode]: next };
    set({ memory });
    save({ enabled: get().enabled, memory });
  },
}));

/** Exported for the verify script, which builds fixtures without React. */
export const __floatingAiInternals = { DEFAULT_MEMORY, load, save };
