import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Minus, Plus,
  RotateCw, TriangleAlert, X,
} from 'lucide-react';
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
  /** `inline` sits inside the ResourceViewer modal; `standalone` is for a page
   *  of its own and offers full screen. */
  variant?: 'inline' | 'standalone';
  /**
   * Raised by this viewer's own full-screen control. The host renders the
   * full-screen preview with a FRESH PdfViewer, so it has its own
   * zoom/rotation/page and does not share this instance's state.
   */
  onRequestFullScreen?: () => void;
}

/** Zoom bounds. 1 = fit-to-width (the default), so zoom is a multiplier. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const ctrl = 'inline-flex items-center justify-center gap-1.5 px-2.5 min-h-[40px] rounded-lg border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated disabled:opacity-40 transition-colors text-xs font-semibold';

const isCancel = (e: unknown) =>
  e instanceof Error && e.name === 'RenderingCancelledException';

/**
 * Shared PDF document viewer.
 *
 * This is the SINGLE place pdf.js page rendering lives. The Library resource
 * preview mounts it, and any "Ask about this PDF" flow must mount this same
 * component rather than re-implementing page rendering.
 *
 * Render safety: pdf.js permits only one render per canvas and throws
 * "Cannot use the same canvas during multiple render() operations" otherwise.
 * Every render here first cancels the previous RenderTask and AWAITs that
 * cancellation, and a monotonic token discards any stale completion that still
 * lands after a newer render has started.
 */
export const PdfViewer: React.FC<PdfViewerProps> = ({
  blob, title, variant = 'inline', onRequestFullScreen,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  // In pdf.js v6 destroy() lives on the loading task, so the task is what we
  // must abort on cleanup — holding only the document would leak the worker.
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  // The in-flight render, so it can be cancelled before the next one starts.
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  // Monotonic token: only the newest render may touch the canvas.
  const renderTokenRef = useRef(0);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(720);
  // CSS height of the current page, used as a uniform band for scrolling.
  const [pageHeight, setPageHeight] = useState(0);
  // True when the page change came from scrolling, so the scroll position is
  // left alone instead of being snapped back to the page top.
  const scrollDrivenRef = useRef(false);

  const shellRef = useRef<HTMLDivElement | null>(null);

  // Track the available width so fit-to-width and full screen both use the
  // space properly instead of stretching a small canvas.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = (w: number) => { if (w > 0) setContainerWidth(Math.floor(w)); };
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    apply(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [fullScreen]);

  // Load the document whenever the blob changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    setPage(1);
    setPageInput('1');
    setPageCount(0);
    // Zoom and rotation are per open document, not global.
    setZoom(1);
    setRotation(0);
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

  const goToPage = useCallback((n: number) => {
    const total = pageCount || 1;
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    setPageInput(String(next));
  }, [pageCount]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(z + delta).toFixed(2))));
  }, []);

  // ---- The render itself. Cancellation + staleness handled here. ----
  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !doc) return;

    // (1) Cancel any in-flight render and AWAIT it. pdf.js throws if a new
    // render begins on a canvas whose previous render is still running.
    const previous = renderTaskRef.current;
    renderTaskRef.current = null;
    if (previous) {
      try {
        previous.cancel();
        await previous.promise;
      } catch {
        // A cancelled render rejects by design; nothing to do.
      }
    }

    // (2) Claim a token. If a newer render started while we awaited the
    // cancellation above, this one is stale and must not touch the canvas.
    const token = ++renderTokenRef.current;

    setRendering(true);
    try {
      const pdfPage = await doc.getPage(page);
      if (token !== renderTokenRef.current) return;

      // The unrotated page, used to derive the fit-to-width scale.
      const unit = pdfPage.getViewport({ scale: 1 });
      // Cap DPR at 2: beyond that a canvas costs memory for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssScale = (containerWidth / unit.width) * zoom;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

      const context = canvas.getContext('2d');
      if (!context) return;
      // Match the CSS box to the rotated page so layout reserves the right space.
      const rotated = rotation % 180 !== 0;
      const cssH = Math.floor(rotated ? unit.width * cssScale : unit.height * cssScale);
      const cssW = Math.floor(rotated ? unit.height * cssScale : unit.width * cssScale);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      // The band height drives continuous scrolling, so keep it in sync.
      setPageHeight(cssH);

      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTaskRef.current = task;
      await task.promise;
      // A newer render took over: leave the canvas to it.
    } catch (e) {
      if (isCancel(e)) return;
      if (token !== renderTokenRef.current) return;
      setError(e instanceof Error ? e.message : 'Could not render this page.');
      setStatus('error');
    } finally {
      if (token === renderTokenRef.current) setRendering(false);
    }
  }, [page, zoom, rotation, containerWidth]);

  useEffect(() => {
    if (status !== 'ready') return;
    void renderPage();
    // Cancel any render still in flight when these inputs change, so nothing
    // is left painting over a newer page.
    return () => {
      const t = renderTaskRef.current;
      renderTaskRef.current = null;
      t?.cancel();
    };
  }, [status, renderPage]);

  // ---- Continuous scrolling through pages ------------------------------
  // The page surface is a real scroll container, so the mouse wheel and touch
  // drags (with momentum) work natively. Scrolling updates `page`, which feeds
  // the existing render path — so the render-cancellation fix, zoom and
  // rotation all still apply, and the page indicator tracks what is in view.
  const band = pageHeight || 600;
  const totalHeight = Math.max(1, pageCount) * band;

  const handleScroll = () => {
    const el = shellRef.current;
    if (!el || pageHeight <= 0 || pageCount === 0) return;
    const next = Math.max(1, Math.min(pageCount, Math.round(el.scrollTop / pageHeight) + 1));
    if (next !== page) {
      // Let the effect below know this change came from scrolling.
      scrollDrivenRef.current = true;
      goToPage(next);
    }
  };

  // Nav buttons and the page input snap to the page top; scrolling does not.
  useEffect(() => {
    const el = shellRef.current;
    if (scrollDrivenRef.current) { scrollDrivenRef.current = false; return; }
    if (!el || pageHeight <= 0 || pageCount <= 1) return;
    const target = (page - 1) * pageHeight;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [page, pageHeight, pageCount]);

  // A new document or a zoom/rotation change invalidates the old offset.
  useEffect(() => { setPageHeight(0); }, [blob, zoom, rotation]);

  // ---- Keyboard shortcuts, active only while the viewer has focus ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); goToPage(page - 1); break;
      case 'ArrowRight': e.preventDefault(); goToPage(page + 1); break;
      case '+': case '=': e.preventDefault(); changeZoom(ZOOM_STEP); break;
      case '-': case '_': e.preventDefault(); changeZoom(-ZOOM_STEP); break;
      case 'Escape': if (fullScreen) { e.preventDefault(); setFullScreen(false); } break;
      default: return;
    }
  };

  const zoomPct = Math.round(zoom * 100);
  // Full screen is a real overlay using the viewport, not a scaled-up inline
  // canvas, so the page gets genuinely more room. `standalone` must FILL the
  // height its host gives it, otherwise it collapses to its content and the
  // host has to scroll to reach the viewer's own controls.
  const boxClass = fullScreen
    ? 'fixed inset-0 z-[60] flex flex-col bg-bg-primary p-3 sm:p-5 overflow-hidden'
    : variant === 'standalone'
      ? 'flex flex-col gap-3 h-full min-h-0'
      : 'flex flex-col gap-3';
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
    <div
      className={boxClass}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={title ? `${title} PDF viewer` : 'PDF viewer'}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => goToPage(page - 1)} disabled={page <= 1 || pageCount === 0} aria-label="Previous page" className={ctrl}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <label className="flex items-center gap-1.5 text-xs text-content-secondary">
          <span className="sr-only">Page number</span>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(Number(pageInput) || 1)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goToPage(Number(pageInput) || 1); } }}
            inputMode="numeric"
            aria-label="Page number"
            className="w-12 text-center bg-bg-elevated border border-border rounded-lg px-1.5 py-1.5 text-xs text-content-primary tabular-nums outline-none focus:border-accent"
          />
          <span className="tabular-nums whitespace-nowrap">of {pageCount || '—'}</span>
        </label>
        <button onClick={() => goToPage(page + 1)} disabled={page >= pageCount || pageCount === 0} aria-label="Next page" className={ctrl}>
          <ChevronRight className="w-4 h-4" />
        </button>

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <button onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" className={ctrl}>
          <Minus className="w-4 h-4" />
        </button>
        <span className="min-w-[3.25rem] text-center text-xs text-content-secondary tabular-nums">{zoomPct}%</span>
        <button onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" className={ctrl}>
          <Plus className="w-4 h-4" />
        </button>
        <button onClick={() => setZoom(1)} aria-label="Reset zoom to fit width" className={`${ctrl} px-2`}>Fit</button>

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <button onClick={() => setRotation((r) => (r + 90) % 360)} aria-label={`Rotate, currently ${rotation} degrees`} className={ctrl}>
          <RotateCw className="w-4 h-4" />
        </button>

        {variant === 'standalone' && (
          <button onClick={() => setFullScreen((f) => !f)} aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'} className={ctrl}>
            {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        {/* The host's full-screen preview: available from a single pane AND from
            inside the split, and independent of this viewer's own state. */}
        {onRequestFullScreen && !fullScreen && (
          <button
            onClick={onRequestFullScreen}
            aria-label="Open full screen preview"
            title="Full screen preview"
            className={ctrl}
          >
            <Maximize2 className="w-4 h-4" /> Full screen
          </button>
        )}
        {fullScreen && (
          <button onClick={() => setFullScreen(false)} aria-label="Close full screen" className={`${ctrl} ml-auto`}>
            <X className="w-4 h-4" /> Exit
          </button>
        )}
      </div>

      <div
        ref={shellRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-[320px] overflow-auto overscroll-contain rounded-xl border border-border bg-bg-elevated/40 outline-none"
        // CRITICAL: the page surface must be height-bounded or `overflow-auto`
        // never engages. Without a bound it grows to the full spacer height
        // (pageCount x pageHeight), so it cannot scroll, every scrollTop write
        // is a no-op, and pages 2..N are rendered far below the visible area —
        // which looks exactly like "only page 1 ever displays". `flex-1` only
        // resolves against a definite parent, and this viewer is also used
        // inline in a modal, so an explicit max-height is required. In full
        // screen the root is `fixed inset-0`, so flex-1 is definite there.
        style={fullScreen || variant === 'standalone' ? undefined : { maxHeight: 'min(72vh, 720px)' }}
      >
        {status === 'loading' ? (
          <div className="flex h-full min-h-[280px] items-center justify-center gap-2 text-xs text-content-tertiary">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF…
          </div>
        ) : (
          /* A spacer as tall as every page, with the current page's canvas
             positioned at its own offset. That makes the wheel and touch drags
             scroll continuously between pages. */
          <div className="relative" style={{ height: `${totalHeight}px` }}>
            <canvas
              ref={canvasRef}
              className="absolute left-1/2 -translate-x-1/2 rounded-lg bg-white shadow-sm"
              style={{ top: `${(page - 1) * band}px` }}
              aria-label={title ? `${title} — PDF page ${page} of ${pageCount}` : `PDF page ${page} of ${pageCount}`}
            />
            {/* Rendering overlay, so zoom/rotate/page never look frozen. */}
            {rendering && (
              <div className="sticky top-0 pointer-events-none flex justify-center">
                <div className="mt-2 flex items-center gap-2 rounded-full bg-bg-surface/90 border border-border px-3 py-1.5 text-[11px] font-semibold text-content-secondary shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendering…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-content-tertiary">
        {zoomPct}% · {rotation}° · Page {page} of {pageCount || '—'}
        <span className="hidden sm:inline"> · Arrow keys change page, +/− zoom, Esc exits full screen.</span>
      </p>
    </div>
  );
};
