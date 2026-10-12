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
 * The same store carries the migration's "re-upload" request: a file whose
 * bytes were offloaded by Dexie Cloud cannot be recovered by code, so the only
 * way to move it is to pick the original again. The migration card stashes the
 * resource id here; SubjectDetail opens the add-resource modal with that row
 * pre-filled and the file picker open.
 *
 * A bare zustand store rather than context: two values, one consumer, and the
 * existing toast store already sets the pattern for this codebase.
 */
import { create } from 'zustand';

interface CloudReAddState {
  pendingKey: string | null;
  /** Stash a key for the next add-resource modal to consume. */
  requestReAdd: (key: string) => void;
  /** The library modal consumed it — clear it. */
  consume: () => void;

  pendingReUpload: string | null;
  /** Stash a resource id for the next add-resource modal to consume. */
  requestReUpload: (id: string) => void;
  /** The library modal consumed it — clear it. */
  consumeReUpload: () => void;
}

export const useCloudReAdd = create<CloudReAddState>((set) => ({
  pendingKey: null,
  requestReAdd: (key) => set({ pendingKey: key }),
  consume: () => set({ pendingKey: null }),
  pendingReUpload: null,
  requestReUpload: (id) => set({ pendingReUpload: id }),
  consumeReUpload: () => set({ pendingReUpload: null }),
}));