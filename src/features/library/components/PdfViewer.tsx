import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  // In pdf.js v6 destroy() lives on the loading task, so the task is what we
  // must abort on cleanup — holding only the document would leak the worker.
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);

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
  // CSS height of each rendered page, keyed by page number. Pages that have not
  // been rendered yet fall back to an estimate, so the scroll height is stable
  // and the last page is always reachable.
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  // True when the page change came from scrolling, so the scroll position is
  // left alone instead of being snapped back to the page top.
  const scrollDrivenRef = useRef(false);
  // The document is a STACK of pages, so more than one render can be in flight
  // at once. Cancellation and staleness are tracked per page.
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const renderTokensRef = useRef<Map<number, number>>(new Map());

  const shellRef = useRef<HTMLDivElement | null>(null);
  // One canvas ref per page in the render window, so React can keep each
  // mounted and we paint into the right element.
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  /** Register a canvas for a page; returns a ref callback. */
  const setCanvas = useCallback((n: number) => (el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(n, el);
    else canvasRefs.current.delete(n);
  }, []);

  // Pages are laid out end to end from their measured heights. Unmeasured pages
  // use an estimate derived from the average of the measured ones (or a
  // portrait A4 ratio as a last resort).
  const measured = Object.values(pageHeights);
  const avgHeight = measured.length
    ? measured.reduce((a, b) => a + b, 0) / measured.length
    : 0;
  const fallbackHeight = avgHeight || Math.round(containerWidth * 1.414);

  /** Cumulative top offset and height of every page. */
  const layout = useMemo(() => {
    const out: { top: number; height: number }[] = [];
    let y = 0;
    for (let n = 1; n <= pageCount; n += 1) {
      const height = pageHeights[n] ?? fallbackHeight;
      out.push({ top: y, height });
      y += height;
    }
    return out;
  }, [pageHeights, pageCount, fallbackHeight]);

  const last = layout.length ? layout[layout.length - 1] : null;
  const totalHeight = last ? last.top + last.height : 0;

  /** The page occupying a viewport-relative y offset. */
  const pageAtOffset = useCallback((y: number) => {
    if (!layout.length) return 1;
    // Linear scan is fine: page counts here are small, and a binary search
    // would add complexity for no measurable gain.
    for (let i = 0; i < layout.length; i += 1) {
      if (y < layout[i].top + layout[i].height) return i + 1;
    }
    return layout.length;
  }, [layout]);


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

  // ---- Rendering a single page into its own canvas -------------------
  // The document is a vertical STACK of pages, so several pages can be in
  // flight at once. Each page therefore gets its OWN cancellation slot and its
  // own monotonic token: cancelling page 4 must never disturb page 5.
  const renderInto = useCallback(async (n: number) => {
    const canvas = canvasRefs.current.get(n);
    const doc = docRef.current;
    if (!canvas || !doc) return;

    // (1) Cancel this page's in-flight render and AWAIT it. pdf.js throws if a
    // new render begins on a canvas whose previous render is still running.
    const previous = renderTasksRef.current.get(n);
    renderTasksRef.current.delete(n);
    if (previous) {
      try {
        previous.cancel();
        await previous.promise;
      } catch {
        // A cancelled render rejects by design; nothing to do.
      }
    }

    // (2) Claim a token for THIS page. A newer render of the same page that
    // started while we awaited the cancellation makes us stale.
    const token = (renderTokensRef.current.get(n) ?? 0) + 1;
    renderTokensRef.current.set(n, token);
    const isCurrent = () => renderTokensRef.current.get(n) === token;

    try {
      setRendering(true);
      const pdfPage = await doc.getPage(n);
      if (!isCurrent()) return;

      // The unrotated page, used to derive the fit-to-width scale.
      const unit = pdfPage.getViewport({ scale: 1 });
      // Cap DPR at 2: beyond that a canvas costs memory for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Zoom and rotation apply identically to every page in the stack.
      const cssScale = (containerWidth / unit.width) * zoom;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

      const context = canvas.getContext('2d');
      if (!context) return;
      const rotated = rotation % 180 !== 0;
      const cssH = Math.floor(rotated ? unit.width * cssScale : unit.height * cssScale);
      const cssW = Math.floor(rotated ? unit.height * cssScale : unit.width * cssScale);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      // Record the real height so the stack layout stays accurate.
      setPageHeights((prev) => (prev[n] === cssH ? prev : { ...prev, [n]: cssH }));

      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTasksRef.current.set(n, task);
      await task.promise;
      if (isCurrent()) renderTasksRef.current.delete(n);
    } catch (e) {
      if (isCancel(e) || !isCurrent()) return;
      setError(e instanceof Error ? e.message : 'Could not render this page.');
      setStatus('error');
    } finally {
      // The spinner clears once no page is still rendering.
      if (renderTasksRef.current.size === 0) setRendering(false);
    }
  }, [zoom, rotation, containerWidth]);

  // Render only the pages near the current one, so a long document does not
  // allocate a canvas per page. Canvases that scroll out of range are simply
  // unmounted by React, releasing their memory.
  const renderWindow = useMemo(() => {
    const from = Math.max(1, page - 1);
    const to = Math.min(pageCount, page + 1);
    const out: number[] = [];
    for (let n = from; n <= to; n += 1) out.push(n);
    return out;
  }, [page, pageCount]);

  const windowKey = renderWindow.join(',');

  useEffect(() => {
    if (status !== 'ready') return;
    for (const n of renderWindow) void renderInto(n);
    // Cancel everything still in flight when the window, zoom, rotation or
    // width changes, so nothing paints over a newer render.
    return () => {
      for (const [, t] of renderTasksRef.current) t.cancel();
      renderTasksRef.current.clear();
    };
    // `windowKey` stands in for the array identity of renderWindow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, windowKey, zoom, rotation, containerWidth, renderInto]);

  // A different document starts a fresh set of measured heights.
  useEffect(() => {
    setPageHeights({});
    renderTasksRef.current.clear();
    renderTokensRef.current.clear();
  }, [blob]);

  // ---- Continuous scrolling through the page stack -------------------
  // The surface is a real scroll container, so the wheel and touch drags work
  // natively. Scrolling updates `page` from the page occupying the middle of
  // the viewport, which feeds the render window and the page indicator.
  const handleScroll = () => {
    const el = shellRef.current;
    if (!el || !layout.length) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    const next = pageAtOffset(mid);
    if (next !== page) {
      // Let the effect below know this change came from scrolling.
      scrollDrivenRef.current = true;
      goToPage(next);
    }
  };

  // Nav buttons and the page input scroll smoothly to that page; scrolling
  // itself is left alone so a flick is never yanked back.
  useEffect(() => {
    const el = shellRef.current;
    if (scrollDrivenRef.current) { scrollDrivenRef.current = false; return; }
    const entry = layout[page - 1];
    if (!el || !entry) return;
    if (Math.abs(el.scrollTop - entry.top) > 1) {
      el.scrollTo({ top: entry.top, behavior: 'smooth' });
    }
  }, [page, layout]);

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
          /* A real vertical stack: every page occupies its own band in document
             order, so scrolling reveals the bottom of one page and the top of
             the next at the same time, as a normal PDF reader does. Only the
             pages in `renderWindow` have a canvas; the rest are just space. */
          <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
            {renderWindow.map((n) => {
              const entry = layout[n - 1];
              if (!entry) return null;
              return (
                <div
                  key={n}
                  className="absolute inset-x-0 flex justify-center"
                  style={{ top: `${entry.top}px` }}
                >
                  <canvas
                    ref={setCanvas(n)}
                    className="block rounded-lg bg-white shadow-sm"
                    style={{ height: `${entry.height}px` }}
                    aria-label={title ? `${title} — PDF page ${n} of ${pageCount}` : `PDF page ${n} of ${pageCount}`}
                  />
                </div>
              );
            })}

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
