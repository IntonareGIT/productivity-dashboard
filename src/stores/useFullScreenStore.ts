import { create } from 'zustand';
import type { Resource } from '../types';

/**
 * Which resource is open in true fullscreen, if any.
 *
 * This used to be local `useState` inside `useResourceFullScreen`, which is
 * created once per `SplitView`. That made the fullscreen state invisible to
 * anything outside the split view, and the floating AI bubble needs it: the
 * brief requires the bubble to be hidden while a pane is in true fullscreen,
 * and a z-index competition with the fullscreen layer is exactly the failure
 * the bubble was removed for in the first place.
 *
 * Lifting the state into a store is behaviour-preserving for the split view
 * itself: the same value is read from the same place, and no zoom, pinch,
 * scroll or pane layout code is touched.
 */
interface FullScreenState {
  fullScreenResource: Resource | null;
  setFullScreenResource: (r: Resource | null) => void;
}

export const useFullScreenStore = create<FullScreenState>((set) => ({
  fullScreenResource: null,
  setFullScreenResource: (r) => set({ fullScreenResource: r }),
}));
