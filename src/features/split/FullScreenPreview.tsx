import React, { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Resource } from '../../types';
import { previewKindFor } from '../library/previewKind';

interface FullScreenPreviewProps {
  resource: Resource;
  onClose: () => void;
}

/** Vendor-prefixed access, since Safari still needs webkit*. */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

/**
 * Full-screen preview for NON-PDF resources (images and similar).
 *
 * PDFs deliberately do NOT come through here. The shared `PdfViewer` owns its
 * own fullscreen: it calls requestFullscreen() on its own wrapper, so exactly
 * ONE viewer instance is ever in the DOM and there is no second canvas, no
 * duplicated page/zoom/rotation state, and nothing to unmount when leaving.
 * Mounting a second PdfViewer here was the source of the duplicate-viewer bug.
 *
 *
 * Enters the browser's REAL fullscreen via `requestFullscreen()`, so the
 * browser chrome (tabs, address bar) genuinely disappears — a CSS
 * `fixed inset-0` overlay only covers the page viewport and leaves the browser
 * UI in place. The `fixed inset-0` classes remain as a fallback for browsers
 * without the Fullscreen API (e.g. iOS Safari).
 *
 * `fullscreenchange` is handled so exiting with the browser's own Escape key or
 * a browser control closes the preview, not just the in-app close button.
 * Everything underneath is NOT unmounted, so closing returns to exactly the
 * layout that was active.
 */
export const FullScreenPreview: React.FC<FullScreenPreviewProps> = ({ resource, onClose }) => {
  const kind = previewKindFor(resource);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // True once we actually entered the browser's fullscreen.
  const enteredRef = useRef(false);
  // Set when WE are closing, so the fullscreenchange echo is not double-handled.
  const closingRef = useRef(false);

  // Enter real fullscreen on mount; exit it on unmount.
  useEffect(() => {
    const el = rootRef.current as FsElement | null;
    if (!el) return;
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (typeof request !== 'function') return;
    try {
      enteredRef.current = true;
      Promise.resolve(request.call(el)).catch(() => { enteredRef.current = false; });
    } catch {
      enteredRef.current = false;
    }
    return () => {
      const doc = document as FsDocument;
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      if (!enteredRef.current || active !== el) return;
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (typeof exit === 'function') {
        try { void exit.call(doc); } catch { /* already exiting */ }
      }
    };
  }, []);

  // The user may leave fullscreen with the browser's Escape or a browser
  // control, which fires fullscreenchange without going through our button.
  useEffect(() => {
    const onChange = () => {
      if (closingRef.current || !enteredRef.current) return;
      const doc = document as FsDocument;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        closingRef.current = true;
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onClose]);

  // Escape fallback for the CSS-only path (no Fullscreen API available).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (enteredRef.current) return; // the browser handles this for real fullscreen
      closingRef.current = true;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${resource.title} full screen preview`}
      // Fallback for browsers without the Fullscreen API. When the API exists
      // this element IS the fullscreen element and fills the screen anyway.
      className="fixed inset-0 z-[70] flex flex-col bg-bg-primary p-3 sm:p-5 overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <p className="flex-1 min-w-0 truncate text-sm font-semibold text-content-primary">
          {resource.title}
        </p>
        <button
          onClick={() => { closingRef.current = true; onClose(); }}
          aria-label="Close full screen preview"
          className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
        >
          <X className="w-4 h-4" /> Close <kbd className="text-[10px] opacity-60">Esc</kbd>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-stretch justify-center overflow-hidden">
        {kind === 'image' && resource.blob ? (
          <FullScreenImage blob={resource.blob} title={resource.title} />
        ) : (
          <Centered label="This format has no full-screen preview. Use Download or Open link from the pane." />
        )}
      </div>
    </div>
  );
};

const Centered: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 text-xs text-content-tertiary">
    <Loader2 className="w-4 h-4" /> {label}
  </div>
);

/** Object URL with a matching revoke, so the blob is not pinned in memory. */
const FullScreenImage: React.FC<{ blob: Blob; title: string }> = ({ blob, title }) => {
  const [url, setUrl] = React.useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return <Centered label="Preparing image…" />;
  return (
    <img
      src={url}
      alt={title}
      className="max-w-full max-h-full object-contain"
    />
  );
};
