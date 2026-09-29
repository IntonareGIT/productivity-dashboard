import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, HardDriveDownload, Loader2, TriangleAlert } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
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
export const ResourceViewer: React.FC<ResourceViewerProps> = ({ resource, onClose }) => {
  const kind = previewKindFor(resource);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

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

  const download = () => {
    if (!resource.blob) return;
    const url = URL.createObjectURL(resource.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = resource.fileName || resource.title;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const openLink = () => {
    const url = (resource.urlOrPath ?? '').trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const size = resource.fileSize != null ? formatBytes(resource.fileSize) : null;
  const typeLabel = fileTypeLabel(resource);
  const driveEmbed = kind === 'drive' ? googleDriveEmbedUrl(resource.urlOrPath ?? '') : null;
  return (
    <Modal open onClose={onClose} title={resource.title} subtitle={`${typeLabel}${size ? ` · ${size}` : ''}`}>
      <div className="space-y-4">
        {kind === 'image' && resource.blob && !imgFailed && (
          imgUrl ? (
            <img
              src={imgUrl}
              alt={resource.title}
              onError={() => setImgFailed(true)}
              className="max-h-[55vh] w-full object-contain rounded-xl border border-border bg-bg-elevated/40"
            />
          ) : (
            <div className="py-10 text-center text-xs text-content-tertiary">Preparing image…</div>
          )
        )}

        {kind === 'image' && imgFailed && (
          <Notice title="Could not display this image." body="The stored file may be corrupt. You can still download it below." />
        )}

        {kind === 'pdf' && resource.blob && (
          <Suspense fallback={<PdfLoading />}>
            <PdfViewer blob={resource.blob} title={resource.title} />
          </Suspense>
        )}

        {kind === 'drive' && driveEmbed && (
          <>
            <iframe
              src={driveEmbed}
              title={resource.title}
              className="w-full h-[55vh] rounded-xl border border-border bg-white"
            />
            <p className="text-[11px] text-content-tertiary">
              Drive may show a "you don't have access" notice for private or unshared files. Use
              Open link below if the preview is blank.
            </p>
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
                  ? 'Uploaded file contents are stored on the device that added them and are not synced. Add the file again on this device to preview it.'
                  : 'This resource has no URL or file attached.'}
              </p>
            </div>
          </div>
        )}

        {/* Actions stay available regardless of whether the preview works. */}
        {kind !== 'opaque' && kind !== 'none' && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-4">
            {resource.blob && (
              <button onClick={download} className={`${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}>
                <Download className="w-4 h-4" /> Download
              </button>
            )}
            {(kind === 'drive' || (kind === 'image' && resource.urlOrPath)) && (
              <button onClick={openLink} className={`${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`}>
                <ExternalLink className="w-4 h-4" /> Open link
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
