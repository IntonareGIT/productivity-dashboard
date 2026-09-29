import React, { Suspense, lazy, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Resource } from '../../types';
import { previewKindFor } from '../library/previewKind';

// A FRESH PdfViewer instance, so full-screen preview starts with its own
// zoom/rotation/page and does not share state with the pane behind it.
const PdfViewer = lazy(() =>
  import('../library/components/PdfViewer').then((m) => ({ default: m.PdfViewer })),
);

interface FullScreenPreviewProps {
  resource: Resource;
  onClose: () => void;
}

/**
 * True full-screen preview of a single resource.
 *
 * Separate from the split view and from pane maximize: it covers the entire
 * screen, including the split and all other chrome. The layout underneath is
 * NOT unmounted, so exiting returns to exactly whatever was showing before.
 * Escape closes it.
 */
export const FullScreenPreview: React.FC<FullScreenPreviewProps> = ({ resource, onClose }) => {
  const kind = previewKindFor(resource);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${resource.title} full screen preview`}
      className="fixed inset-0 z-[70] flex flex-col bg-bg-primary p-3 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <p className="flex-1 min-w-0 truncate text-sm font-semibold text-content-primary">
          {resource.title}
        </p>
        <button
          onClick={onClose}
          aria-label="Close full screen preview"
          className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors"
        >
          <X className="w-4 h-4" /> Close <kbd className="text-[10px] opacity-60">Esc</kbd>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-stretch justify-center">
        {kind === 'pdf' && resource.blob ? (
          // `standalone` offers the viewer's own full-screen toggle, which is
          // already on here; it is harmless and keeps one code path.
          <Suspense fallback={<Centered label="Loading PDF viewer…" />}>
            <PdfViewer blob={resource.blob} title={resource.title} variant="standalone" />
          </Suspense>
        ) : kind === 'image' && resource.blob ? (
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
