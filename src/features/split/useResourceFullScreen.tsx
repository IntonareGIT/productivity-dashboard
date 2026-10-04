import { useCallback } from 'react';
import { db } from '../../db/db';
import type { Resource } from '../../types';
import { FullScreenPreview } from './FullScreenPreview';
import { useFullScreenStore } from '../../stores/useFullScreenStore';

/**
 * Wires the shared full-screen preview for one host surface.
 *
 * The Library preview and each split pane both render the SAME `PdfViewer`, and
 * both must offer the same real-browser full-screen control. Routing them
 * through one hook is what stops them drifting apart again: `PdfViewer` only
 * shows its "Full screen" button when `onRequestFullScreen` is supplied, so
 * forgetting to wire this is exactly how the Library preview ended up without
 * one.
 */
export function useResourceFullScreen() {
  // The state now lives in a shared store rather than in this hook, so the
  // floating AI bubble can observe it from outside the split view. See
  // `useFullScreenStore` for why. Nothing else about the hook changes.
  const fullScreenResource = useFullScreenStore((s) => s.fullScreenResource);
  const setFullScreenResource = useFullScreenStore((s) => s.setFullScreenResource);

  /** Open a resource full screen. Safe to pass straight to the viewer. */
  const openFullScreen = useCallback(async (resourceId?: string) => {
    if (!resourceId) return;
    const r = await db.resources.get(resourceId);
    if (r) setFullScreenResource(r);
  }, [setFullScreenResource]);

  const closeFullScreen = useCallback(() => setFullScreenResource(null), [setFullScreenResource]);

  return { fullScreenResource, openFullScreen, closeFullScreen };
}

/** Renders the shared FullScreenPreview when a host has an open one. */
export const ResourceFullScreen: React.FC<{
  resource: Resource | null;
  onClose: () => void;
}> = ({ resource, onClose }) =>
  resource ? <FullScreenPreview resource={resource} onClose={onClose} /> : null;
