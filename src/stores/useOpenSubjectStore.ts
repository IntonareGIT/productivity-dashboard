/**
 * A one-shot request to open a subject in the Library.
 *
 * The calendar's day panel must be able to send the user to the subject that
 * owns a tapped assessment. Threading a callback down from App through the
 * calendar and back into the Library would couple three screens for one click.
 *
 * A tiny store keeps that direction local: the calendar POSTS a subject id, the
 * Library page reacts. It is one-shot on purpose — the nonce changes only when a
 * new request is made, so opening the same subject twice in a row still works,
 * and the request never goes stale.
 */
import { create } from 'zustand';

interface OpenSubjectState {
  subjectId: string | null;
  nonce: number;
  /** Ask the Library to show this subject. */
  request: (subjectId: string) => void;
  /** The Library calls this once it has applied a request. */
  clear: () => void;
}

export const useOpenSubjectStore = create<OpenSubjectState>((set) => ({
  subjectId: null,
  nonce: 0,
  request: (subjectId) =>
    set((s) => ({ subjectId, nonce: s.nonce + 1 })),
  clear: () => set({ subjectId: null }),
}));