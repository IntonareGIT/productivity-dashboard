import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, HardDriveDownload, Loader2, TriangleAlert } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { ImageViewer } from './ImageViewer';
import { ViewerErrorBoundary } from './ViewerErrorBoundary';
import type { Resource } from '../../../types';
import { fileTypeLabel, googleDriveEmbedUrl, previewKindFor } from '../previewKind';

/**
 * pdf.js is ~400 kB of JS plus a ~1.2 MB worker, so it is code-split and only
 * fetched when a PDF is actually previewed. Loading it eagerly would put it in
 * the initial bundle and slow down every page of the app, most of which have
 * nothing to do with PDFs.
 */
const PdfViewer = lazy(() =>
  import('./PdfViewer').then((m) => ({ default: m.PdfViewer })),
);

const PdfLoading = () => (
  <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-elevated/40 py-12 text-xs text-content-tertiary">
    <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF viewer…
  </div>
);

const btn = 'inline-flex items-center justify-center gap-2 px-3 min-h-[44px] rounded-xl text-xs font-semibold transition-colors';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const Notice: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
    <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
    <div className="text-xs text-content-primary">
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-content-secondary">{body}</p>
    </div>
  </div>
);

interface ResourceViewerProps {
  resource: Resource;
  onClose: () => void;
  /** Render without the modal wrapper, for use inside a split pane. */
  embedded?: boolean;
  /**
   * Forwarded to the PDF toolbar. The split pane passes its document selector
   * here so the selector and the viewer controls are a single row rather than
   * two headers stacked on the pane.
   */
  /** Publishes the viewer's controls up to the universal pane header. */
  onRegisterPdfControls?: (node: React.ReactNode) => void;
  /**
   * Same contract for an image pane. Separate from the PDF one so a pane can
   * never be handed controls belonging to a view it is not showing.
   */
  onRegisterImageControls?: (node: React.ReactNode) => void;
}

/**
 * Preview modal for a resource.
 *
 * Dispatches on `previewKindFor(resource)`:
 *   image  -> <img> from a blob object URL
 *   pdf    -> the shared <PdfViewer> (pdf.js page render + navigation)
 *   drive  -> Google's standard preview iframe
 *   opaque -> name/type/size plus Download (Word, PowerPoint, and anything else)
 *   link   -> "Open link" in a new tab
 *   none   -> "not available on this device"
 *
 * Download / Open link stay available whenever there is something to act on,
 * regardless of whether the inline preview works.
 */
export const ResourceViewer: React.FC<ResourceViewerProps> = ({
  resource, onClose, embedded = false, onRegisterPdfControls, onRegisterImageControls,
}) => {
  const kind = previewKindFor(resource);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  // Bumped by the boundary's "Reload viewer" button. A key change remounts the
  // viewer subtree, which is what actually recovers from a crashed canvas.
  const [imgFailKey, setImgFailKey] = useState(0);
  const [pdfFailKey, setPdfFailKey] = useState(0);
  // A file staged in R2 has no local blob; fetch it on demand and show a
  // loading state while the gateway hands back a presigned URL.
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);

  useEffect(() => {
    if (resource.blob instanceof Blob) {
      setRemoteUrl(null);
      setRemoteLoading(false);
      setRemoteError(false);
      return;
    }
    if (!resource.r2Key) {
      setRemoteUrl(null);
      setRemoteLoading(false);
      setRemoteError(false);
      return;
    }
    let cancelled = false;
    setRemoteLoading(true);
    setRemoteError(false);
    (async () => {
      try {
        const { getCachedCloudBlob, cacheCloudBlob } = await import('../../ai/cloudBlobCache');
        const { downloadFromR2 } = await import('../../ai/cloudClient');
        const cached = await getCachedCloudBlob(resource.r2Key!);
        if (cancelled) return;
        let blob = cached;
        if (!blob) {
          blob = await downloadFromR2(resource.r2Key!);
          if (cancelled) return;
          await cacheCloudBlob(resource.r2Key!, blob);
        }
        const url = URL.createObjectURL(blob);
        setRemoteUrl(url);
      } catch {
        if (!cancelled) setRemoteError(true);
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setRemoteUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [resource.r2Key, resource.blob]);

  // Object URL for the stored blob, revoked on unmount so the blob is not
  // pinned in memory for the life of the tab.
  useEffect(() => {
    if (kind !== 'image' || !resource.blob) return;
    const url = URL.createObjectURL(resource.blob);
    setImgUrl(url);
    return () => {
      setImgUrl(null);
      URL.revokeObjectURL(url);
    };
  }, [kind, resource.blob]);

  const download = async () => {
    // A local blob is the fast path; an R2-staged file needs the gateway first.
    if (resource.blob instanceof Blob) {
      const url = URL.createObjectURL(resource.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = resource.fileName || resource.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return;
    }
    if (resource.r2Key) {
      try {
        const { getCachedCloudBlob, cacheCloudBlob } = await import('../../ai/cloudBlobCache');
        const { downloadFromR2 } = await import('../../ai/cloudClient');
        let blob = await getCachedCloudBlob(resource.r2Key);
        if (!blob) {
          blob = await downloadFromR2(resource.r2Key);
          await cacheCloudBlob(resource.r2Key, blob);
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = resource.fileName || resource.title;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        // Fall through: the notice below explains why.
      }
    }
  };

  const openLink = () => {
    const url = (resource.urlOrPath ?? '').trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const size = resource.fileSize != null ? formatBytes(resource.fileSize) : null;
  const typeLabel = fileTypeLabel(resource);
  const driveEmbed = kind === 'drive' ? googleDriveEmbedUrl(resource.urlOrPath ?? '') : null;
  // A file staged in R2 has no local blob; the fetched object URL becomes the
  // source for both the image and the PDF viewer.
  const srcUrl = (resource.blob instanceof Blob ? undefined : remoteUrl) ?? undefined;

  const body = (
      <div className="space-y-4 flex-1 min-h-0 min-w-0 w-full flex flex-col overflow-hidden">
        {kind === 'image' && !imgFailed && (
          <ViewerErrorBoundary
            label="image viewer"
            reloadKey={imgFailKey}
            onReload={() => setImgFailKey((k) => k + 1)}
          >
            {imgUrl || srcUrl ? (
              <ImageViewer
                key={`img-${imgFailKey}`}
                src={imgUrl ?? srcUrl!}
                alt={resource.title}
                onDownload={download}
                onRegisterControls={embedded ? onRegisterImageControls : undefined}
                onError={() => setImgFailed(true)}
              />
            ) : remoteLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-elevated/40 py-12">
                <Loader2 className="w-4 h-4 animate-spin text-content-secondary" />
                <span className="text-xs text-content-secondary">Fetching image from cloud…</span>
              </div>
            ) : remoteError ? (
              <Notice title="Could not fetch this image." body="The cloud copy could not be loaded. Try again shortly." />
            ) : (
              <div className="py-10 text-center text-xs text-content-tertiary">Preparing image…</div>
            )}
          </ViewerErrorBoundary>
        )}

        {kind === 'image' && imgFailed && (
          <Notice title="Could not display this image." body="The stored file may be corrupt. You can still download it below." />
        )}

        {/* The image's own zoom/rotate/download controls now live in the shared
            ImageViewer, so only the "open the original" action is left here. */}
        {kind === 'image' && resource.urlOrPath && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={openLink} className={`${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}>
              <ExternalLink className="w-4 h-4" /> Open original
            </button>
          </div>
        )}

        {kind === 'pdf' && (
          <ViewerErrorBoundary
            label="PDF viewer"
            reloadKey={pdfFailKey}
            onReload={() => setPdfFailKey((k) => k + 1)}
          >
            <Suspense fallback={<PdfLoading />}>
              {srcUrl || resource.blob ? (
                <PdfViewer
                  key={`pdf-${pdfFailKey}`}
                  blob={srcUrl ? null : resource.blob}
                  url={srcUrl ?? undefined}
                  title={resource.title}
                  variant={embedded ? 'standalone' : 'inline'}
                  onDownload={download}
                  onRegisterControls={onRegisterPdfControls}
                />
              ) : remoteLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-elevated/40 py-12">
                  <Loader2 className="w-4 h-4 animate-spin text-content-secondary" />
                  <span className="text-xs text-content-secondary">Fetching PDF from cloud…</span>
                </div>
              ) : remoteError ? (
                <Notice title="Could not fetch this PDF." body="The cloud copy could not be loaded. Try again shortly." />
              ) : (
                <PdfLoading />
              )}
            </Suspense>
          </ViewerErrorBoundary>
        )}

        {kind === 'drive' && driveEmbed && (
          <>
            <iframe
              src={driveEmbed}
              title={resource.title}
              className={embedded ? "w-full h-full min-h-0 rounded-xl border border-border bg-white" : "w-full h-[55vh] rounded-xl border border-border bg-white"}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-content-tertiary">
                Drive may show a "you don't have access" notice for private or unshared files.
              </p>
              <button onClick={openLink} className={`${btn} shrink-0 border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}>
                <ExternalLink className="w-4 h-4" /> Open link
              </button>
            </div>
          </>
        )}

        {kind === 'opaque' && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-elevated/40 px-4 py-10 text-center">
            <FileText className="w-9 h-9 text-content-tertiary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-content-primary break-all">{resource.fileName || resource.title}</p>
              <p className="mt-0.5 text-xs text-content-secondary">{typeLabel}{size ? ` · ${size}` : ''}</p>
              <p className="mt-2 text-[11px] text-content-tertiary">
                This format is not previewed in the browser. Download it to open in Word, PowerPoint
                or another app.
              </p>
            </div>
            <button onClick={download} className={`${btn} bg-accent hover:bg-accent-hover text-white`}>
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        )}

        {kind === 'link' && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-elevated/40 px-4 py-10 text-center">
            <ExternalLink className="w-9 h-9 text-content-tertiary" aria-hidden="true" />
            <p className="text-xs text-content-secondary break-all">{resource.urlOrPath}</p>
            <button onClick={openLink} className={`${btn} bg-accent hover:bg-accent-hover text-white`}>
              <ExternalLink className="w-4 h-4" /> Open link
            </button>
          </div>
        )}

{kind === 'none' && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-10 text-center">
            <HardDriveDownload className="w-9 h-9 text-amber-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-content-primary">File not available on this device</p>
              <p className="mt-1 text-xs text-content-secondary">
                {resource.kind === 'file'
                  ? 'This file has no bytes on this device and no cloud copy to fetch. Re-upload it here to preview it.'
                  : 'This resource has no URL or file attached.'}
              </p>
            </div>
          </div>
        )}

        {/* The bottom action bar is gone. For a PDF its controls now live in
            the viewer's own toolbar; for the remaining kinds the single
            relevant action is already part of the branch above, so a second
            row only added dead space. */}

      </div>
  );

  // `embedded` drops the modal chrome so a split pane can host the same viewer.
  // The wrapper is a definite-height flex column so the viewer's own `h-full`
  // resolves against the PANE rather than collapsing to its content — this is
  // what lets a PDF fill a split pane and scroll internally.
  if (embedded) {
    return (
      <div className="flex flex-col h-full min-h-0 min-w-0 w-full overflow-hidden rounded-xl border border-border bg-bg-surface p-2">
        <div className="flex-1 min-h-0 min-w-0 w-full flex flex-col overflow-hidden">{body}</div>
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={resource.title}
      subtitle={`${typeLabel}${size ? ` · ${size}` : ''}`}
      // A fit-to-width PDF or an image needs room to be readable; the compact
      // dialog would squeeze it to ~28rem and look like a low-zoom thumbnail.
      size={kind === 'pdf' || kind === 'image' ? 'lg' : 'md'}
    >
      {body}
    </Modal>
  );
};
