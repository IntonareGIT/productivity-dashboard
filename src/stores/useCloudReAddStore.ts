/**
 * Pending "re-add a cloud copy" request.
 *
 * The Cloud Copies section in Settings lists files that live in R2 but have no
 * row here. Clicking "Re-add" cannot place the row itself — that needs a
 * subject and topic the user chooses, which only the library knows how to
 * offer. So it stashes the r2Key here; SubjectDetail reads it and opens the
 * add-resource modal with that key pre-filled, reusing the bytes already
 * cached locally instead of re-uploading.
 *
 * A bare zustand store rather than context: one value, one consumer, and the
 * existing toast store already sets the pattern for this codebase.
 */
import { create } from 'zustand';

interface CloudReAddState {
  pendingKey: string | null;
  /** Stash a key for the next add-resource modal to consume. */
  requestReAdd: (key: string) => void;
  /** The library modal consumed it — clear it. */
  consume: () => void;
}

export const useCloudReAdd = create<CloudReAddState>((set) => ({
  pendingKey: null,
  requestReAdd: (key) => set({ pendingKey: key }),
  consume: () => set({ pendingKey: null }),
}));