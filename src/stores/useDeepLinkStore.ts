/**
 * One-shot "take me to that exact item" requests from the dashboard cards.
 *
 * A card cannot reach into another page's state, and threading callbacks from
 * App through every page would couple screens for one click. So a card POSTS a
 * target here, switches tab, and the destination page applies and clears it.
 *
 * Every target carries a nonce so asking for the same item twice in a row still
 * works, and a request never goes stale: the destination clears it once applied.
 * No schema, no persistence: this lives in memory only.
 */
import { create } from 'zustand';

export interface LibraryTarget {
  subjectId: string;
  /** Resource to reveal and highlight (its topic is selected for you). */
  resourceId?: string;
  /** Assessment to scroll to and highlight. */
  assessmentId?: string;
  nonce: number;
}

export interface DateTarget {
  /** YYYY-MM-DD */
  date: string;
  nonce: number;
}

interface DeepLinkState {
  library: LibraryTarget | null;
  calendar: DateTarget | null;
  shifts: DateTarget | null;
  openLibrary: (t: Omit<LibraryTarget, 'nonce'>) => void;
  openCalendar: (date: string) => void;
  openShifts: (date: string) => void;
  clearLibrary: () => void;
  clearCalendar: () => void;
  clearShifts: () => void;
}

export const useDeepLinkStore = create<DeepLinkState>((set) => ({
  library: null,
  calendar: null,
  shifts: null,
  openLibrary: (t) => set((s) => ({ library: { ...t, nonce: (s.library?.nonce ?? 0) + 1 } })),
  openCalendar: (date) => set((s) => ({ calendar: { date, nonce: (s.calendar?.nonce ?? 0) + 1 } })),
  openShifts: (date) => set((s) => ({ shifts: { date, nonce: (s.shifts?.nonce ?? 0) + 1 } })),
  clearLibrary: () => set({ library: null }),
  clearCalendar: () => set({ calendar: null }),
  clearShifts: () => set({ shifts: null }),
}));
