import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, TriangleAlert } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Register the worker once, at module load. Vite rewrites the `?url` import to
// a hashed asset URL, so this works in both dev and the production build.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  /** The stored PDF bytes. */
  blob: Blob;
  /** Accessible label, e.g. the resource title. */
  title?: string;
}

/**
 * Shared PDF page renderer.
 *
 * This is the single place pdf.js page-render logic lives. The Library resource
 * viewer uses it, and any future "Ask about this PDF" flow must use this too
 * rather than re-implementing page rendering.
 *
 * Renders one page at a time to a canvas, scaled to fit the container width,
 * with page navigation. Deliberately not virtualised: a canvas per page would
 * cost far more memory for no benefit at this page count.
 */
export const PdfViewer: React.FC<PdfViewerProps> = ({ blob, title }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  // In pdf.js v6 destroy() lives on the loading task, so the task is what we
  // must abort on cleanup — holding only the document would leak the worker.
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  // Container width, so the canvas scales to fit and re-renders on resize.
  const [width, setWidth] = useState(720);

  const shellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load the document whenever the blob changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    setPage(1);
    setPageCount(0);
    taskRef.current?.destroy();
    taskRef.current = null;
    docRef.current = null;

    (async () => {
      try {
        // pdf.js takes ownership of the buffer, so hand it a private copy.
        const buf = await blob.arrayBuffer();
        const task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) { void task.destroy(); return; }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not read this PDF.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      const task = taskRef.current;
      taskRef.current = null;
      docRef.current = null;
      void task?.destroy();
    };
  }, [blob]);

  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !doc) return;
    try {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      // Cap DPR at 2: beyond that a canvas costs memory for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: (width / base.width) * dpr });
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(width)}px`;
      canvas.style.height = `${Math.floor((width / base.width) * base.height)}px`;
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    } catch (e) {
      if (e instanceof Error && e.name === 'RenderingCancelledException') return;
      setError(e instanceof Error ? e.message : 'Could not render this page.');
      setStatus('error');
    }
  }, [page, width]);

  useEffect(() => {
    if (status !== 'ready') return;
    void renderPage();
  }, [status, renderPage]);

  if (status === 'error') {
    return (
      <div className="flex items-start gap-2 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10">
        <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-content-primary">
          <p className="font-semibold">Could not display this PDF.</p>
          <p className="mt-0.5 text-content-secondary">{error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div ref={shellRef} className="rounded-xl border border-border bg-bg-elevated/40 p-3 overflow-x-auto">
        {status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-content-tertiary">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF…
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="mx-auto block rounded-lg bg-white shadow-sm"
            aria-label={title ? `${title} — PDF page ${page}` : `PDF page ${page}`}
          />
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-xl border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-xs text-content-secondary tabular-nums">Page {page} of {pageCount}</span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            aria-label="Next page"
            className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-xl border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated disabled:opacity-40 transition-colors"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
