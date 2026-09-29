import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2,
  Minus, Plus, RotateCw, TriangleAlert,
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
  /** `inline` sits in the Library modal; `standalone` fills its host height. */
  variant?: 'inline' | 'standalone';
  /**
   * Saves the underlying file. The host owns the blob and the filename, so it
   * supplies the action; the viewer only renders the control, which keeps every
   * control in the ONE toolbar instead of a separate bottom bar.
   */
  onDownload?: () => void;
  /**
   * Publishes this viewer's controls to a parent. In a split pane the
   * universal PaneHeader calls this so the page/zoom controls appear in the ONE
   * header instead of in a second toolbar inside the viewer. Omit it (the
   * Library modal) and the viewer renders its own header as before.
   */
  onRegisterControls?: (node: React.ReactNode) => void;
}

/** Zoom bounds. 1 = fit-to-width (the default), so zoom is a multiplier. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/**
 * The only breathing room around the page. Deliberately small: the whole point
 * is that the canvas reaches the edges of its parent, and 16px is just enough
 * to see the page edge against the surface behind it.
 */
const PAGE_PAD = 16;

/** The gap between two consecutive pages in the stack. */
const PAGE_GAP = 10;

/** An upper bound on auto-fit, so a tiny page can't be blown up to 8x. */
const MAX_FIT = 3;

const ctrl = 'inline-flex items-center justify-center gap-1 px-1.5 min-h-[26px] rounded-md border border-transparent text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors text-xs font-semibold shrink-0';

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
  blob, title, variant = 'inline', onDownload, onRegisterControls,
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
  // The viewer's own root element IS the fullscreen element. There is no second
  // viewer, overlay or modal for fullscreen: this wrapper is the one instance,
  // and the browser promotes it, so the same DOM (and the same page, zoom and
  // rotation) is what you see full screen.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // True when the browser has no Fullscreen API, so we fall back to a CSS fill
  // on this same element. Still one viewer — no duplicate is ever mounted.
  const noFullscreenApiRef = useRef(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(720);
  const [containerHeight, setContainerHeight] = useState(640);
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
  // Mirrors `zoom` so the touch handler can read it without re-binding.
  const zoomRef = useRef(zoom);
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
      // A small gap so consecutive pages read as separate sheets. It is added
      // only BETWEEN pages, so the first page still starts flush at the top.
      y += height + (n < pageCount ? PAGE_GAP : 0);
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


  // Track the AVAILABLE box for the page: the surface's content box minus the
  // padding, minus its own 1px borders. Measuring the raw element width (which
  // is what this used to do) included the borders, so every page was rendered
  // ~2px wider than the space it had to live in — which forced a horizontal
  // scrollbar and made the canvas look like it was overflowing its frame.
  // Reading contentBox/paddingBox keeps this honest when the border or padding
  // changes, and the ResizeObserver keeps it correct when the window resizes or
  // the split divider is dragged.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      const padY = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
      const w = el.clientWidth - padX;
      const h = el.clientHeight - padY;
      if (w > 0) setContainerWidth(Math.floor(w));
      if (h > 0) setContainerHeight(Math.floor(h));
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
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

  zoomRef.current = zoom;

  const changeZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(z + delta).toFixed(2))));
  }, []);

  /** Apply a multiplicative zoom, clamped. Used by the pinch handlers. */
  const scaleZoom = useCallback((factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(z * factor).toFixed(2))));
  }, []);

  // ---- Trackpad pinch-to-zoom -----------------------------------------
  // A trackpad pinch is delivered as a `wheel` event with ctrlKey set (that is
  // how browsers report the gesture), NOT as a touch gesture. Left alone it
  // zooms the whole browser page, which is jarring and scrolls the dashboard
  // behind the viewer. Intercepting it and mapping it onto the viewer's own
  // zoom keeps the gesture inside the document.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // `passive: false` is required: preventDefault on wheel is ignored
    // otherwise, and the page would still zoom/scroll behind the viewer.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // deltaY is negative for a fingers-apart (zoom in) gesture. Negating it
      // and using a small exponent makes the response feel linear rather than
      // jumping a whole zoom step per event; trackpads fire these at high
      // rates, so a naive `deltaY / 100` would slam to the clamp instantly.
      scaleZoom(Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scaleZoom]);

  // ---- Mobile / tablet two-finger pinch --------------------------------
  // Touch is tracked natively because React's synthetic touch events do not
  // expose the two-touch distance this needs.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // The distance between the two active touch points at gesture start.
    let startDist = 0;
    let startZoom = 1;

    const dist = (t: TouchList) => {
      const [a, b] = [t[0], t[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
      startZoom = zoomRef.current;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist <= 0) return;
      // Two fingers means a pinch/zoom gesture, not a pan, so the default
      // page-zoom and scroll are suppressed while it is in progress.
      e.preventDefault();
      const ratio = dist(e.touches) / startDist;
      // Re-anchor on every move against the ORIGINAL start, otherwise the
      // zoom would compound frame over frame and run away to the clamp.
      scaleZoom((ratio * startZoom) / zoomRef.current);
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scaleZoom]);

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

      // The unrotated page, used to derive the fit scale.
      const unit = pdfPage.getViewport({ scale: 1 });
      // Cap DPR at 2: beyond that a canvas costs memory for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rotated = rotation % 180 !== 0;

      // FIT, not a fixed "100%". `zoom` stays a multiplier on top of the
      // fitted scale, so zoom === 1 always means "as large as this container
      // allows" and the page is never stranded at the document's intrinsic
      // size with dead grey space around it.
      //
      // Rotation swaps the page's effective width and height, so the fit has to
      // be computed against the ROTATED dimensions — otherwise a landscape or
      // 90-degree page is fitted to the wrong edge and still overflows.
      const pageW = rotated ? unit.height : unit.width;
      const pageH = rotated ? unit.width : unit.height;
      const availW = Math.max(1, containerWidth - PAGE_PAD);
      const availH = Math.max(1, containerHeight - PAGE_PAD);
      // Fit both axes and take the smaller, so a short page is not blown up
      // past the bottom of the pane and a long one still fits the width.
      const fitScale = Math.min(availW / pageW, availH / pageH, MAX_FIT);
      // Zoom and rotation apply identically to every page in the stack.
      const cssScale = fitScale * zoom;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

      const context = canvas.getContext('2d');
      if (!context) return;
      const cssH = Math.floor(pageH * cssScale);
      const cssW = Math.floor(pageW * cssScale);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // `maxWidth: 100%` is a last-resort guard: if a stale measurement ever
      // produced a page wider than its box, it shrinks to fit instead of
      // forcing a horizontal scrollbar.
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.style.maxWidth = '100%';

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
  }, [zoom, rotation, containerWidth, containerHeight]);

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
  }, [status, windowKey, zoom, rotation, containerWidth, containerHeight, renderInto]);

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

  /**
   * Enter/leave the browser's real fullscreen on THIS element. Escape and the
   * browser's own fullscreen control both fire `fullscreenchange`, which keeps
   * the toolbar state honest.
   */
  const toggleFullScreen = useCallback(() => {
    const el = wrapperRef.current as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | null;
    if (!el) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
    if (active === el) {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (typeof exit === 'function') { try { void exit.call(doc); } catch { /* ignore */ } }
      return;
    }
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (typeof request !== 'function') {
      // No API (e.g. iOS Safari): fall back to filling the viewport with this
      // same element, so the control is never dead.
      noFullscreenApiRef.current = true;
      setFullScreen(true);
      return;
    }
    noFullscreenApiRef.current = false;
    try { void Promise.resolve(request.call(el)).catch(() => setFullScreen(false)); }
    catch { setFullScreen(false); }
  }, []);

  // Reflect the real fullscreen state, including an exit via the browser's own
  // Escape key rather than our button.
  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      setFullScreen(active === wrapperRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Leaving fullscreen on unmount, so we never strand the page in fullscreen.
  useEffect(() => {
    const el = wrapperRef.current;
    return () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      if (active && active === el) {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (typeof exit === 'function') { try { void exit.call(doc); } catch { /* ignore */ } }
      }
    };
  }, []);
  // One ref per page in the stack, so nav can scroll the target page into view
  // rather than guessing an offset.
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const setPageEl = useCallback((n: number) => (el: HTMLDivElement | null) => {
    if (el) pageElsRef.current.set(n, el);
    else pageElsRef.current.delete(n);
  }, []);

  /** Scroll a page into view inside the surface. Used by nav and the page input. */
  const scrollPageIntoView = useCallback((n: number) => {
    const el = pageElsRef.current.get(n);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const onNextPage = useCallback(() => {
    const next = Math.min(pageCount || 1, page + 1);
    if (next === page) return;
    scrollPageIntoView(next);
    goToPage(next);
  }, [page, pageCount, goToPage, scrollPageIntoView]);

  const onPrevPage = useCallback(() => {
    const prev = Math.max(1, page - 1);
    if (prev === page) return;
    scrollPageIntoView(prev);
    goToPage(prev);
  }, [page, goToPage, scrollPageIntoView]);


  /**
   * ArrowUp / ArrowDown: scroll the surface, and hand over to page navigation
   * at the ends. Scrolling is done by us (not by the browser) so that reaching
   * the bottom of the last line of page N continues into page N+1 rather than
   * stopping dead. A small epsilon absorbs sub-pixel scroll positions.
   */
  const onArrowScroll = useCallback((dir: 1 | -1) => {
    const el = shellRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    // Within 2px of an end counts as "at" that end.
    const atTop = el.scrollTop <= 2;
    const atBottom = el.scrollTop >= maxScroll - 2;

    if (dir === 1 && atBottom) { onNextPage(); return; }
    if (dir === -1 && atTop) { onPrevPage(); return; }

    // A smooth, substantial step — roughly a line or two — reads as continuous
    // scrolling, and matches what a PDF reader does with the down arrow.
    const step = Math.max(48, Math.round(el.clientHeight * 0.12));
    el.scrollBy({ top: dir * step, behavior: 'smooth' });
    // `handleScroll` will resync `page` from the new midpoint, so no state is
    // set here and the nav effect correctly stands down.
  }, [onNextPage, onPrevPage]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); onPrevPage(); break;
      case 'ArrowRight': e.preventDefault(); onNextPage(); break;
      // preventDefault stops the dashboard behind the viewer from scrolling,
      // and stops the browser from jumping the focused element.
      case 'ArrowDown': e.preventDefault(); onArrowScroll(1); break;
      case 'ArrowUp': e.preventDefault(); onArrowScroll(-1); break;
      case '+': case '=': e.preventDefault(); changeZoom(ZOOM_STEP); break;
      case '-': case '_': e.preventDefault(); changeZoom(-ZOOM_STEP); break;
      case 'Escape': if (fullScreen && noFullscreenApiRef.current) { e.preventDefault(); setFullScreen(false); } break;
      default: return;
    }
  };

  const zoomPct = Math.round(zoom * 100);

  // Publish the controls to a parent header when asked. Registering on every
  // render (and clearing to null on unmount) is what lets the parent show them
  // only while this viewer is mounted, i.e. only for a PDF view.
  useEffect(() => {
    if (!onRegisterControls) return;
    onRegisterControls(toolbar);
    return () => onRegisterControls(null);
  });

  // True when the viewer draws its own header (Library modal, or anywhere with
  // no parent header to host them). In a split pane the header belongs to the
  // universal PaneHeader, so the viewer contributes controls only.
  const ownsHeader = !onRegisterControls;
  // Full screen is a real overlay using the viewport, not a scaled-up inline
  // canvas, so the page gets genuinely more room. `standalone` must FILL the
  // height its host gives it, otherwise it collapses to its content and the
  // host has to scroll to reach the viewer's own controls.
  // The `fixed inset-0` fill applies only as a fallback for browsers with no
  // Fullscreen API. When the API is available the browser promotes this very
  // element, so this is a no-op there.
  // Fullscreen is ONE list of classes whether or not the browser had to
  // promote the element, so the two paths cannot drift apart visually.
  // `p-0` is deliberate: the old `p-3 sm:p-5` was dead space around the
  // document in fullscreen, and the max-height below used to clip it further.
  // `flex flex-col h-full overflow-hidden` is what makes the header + scroll
  // split work: the header is a shrink-0 child and the scroll area takes the
  // rest, so the scroll viewport begins exactly under the header.
  const boxClass = fullScreen
    ? 'fixed inset-0 z-[60] flex flex-col gap-0 p-0 h-full w-full bg-bg-primary overflow-hidden'
    : 'flex flex-col gap-0 h-full min-h-0 w-full overflow-hidden';
  // The control row. Published to a parent header when there is one, and
  // rendered in place otherwise, so the two paths can never drift.
  const toolbar = (
    <>
      <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
      {/* CENTRE: page navigation. In the modal this bar is the only header; in a
          split pane the universal PaneHeader owns the row and the viewer
          contributes these controls into it. */}
      <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
      <button onClick={onPrevPage} disabled={page <= 1 || pageCount === 0} aria-label="Previous page" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <label className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
        <span className="sr-only">Page number</span>
        <input
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => { const n = Number(pageInput) || 1; scrollPageIntoView(n); goToPage(n); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const n = Number(pageInput) || 1; scrollPageIntoView(n); goToPage(n); } }}
          inputMode="numeric"
          aria-label="Page number"
          className="w-10 text-center bg-slate-800 border border-slate-600 rounded-md px-1 py-1 text-xs text-slate-100 tabular-nums outline-none focus:border-accent"
        />
        <span className="tabular-nums whitespace-nowrap text-slate-400">of {pageCount || '—'}</span>
      </label>
      <button onClick={onNextPage} disabled={page >= pageCount || pageCount === 0} aria-label="Next page" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <ChevronRight className="w-4 h-4" />
      </button>
      </div>

      {/* RIGHT: zoom, fit, rotate, download, fullscreen, then the host's pane
          buttons. The row is already justify-between, so no ml-auto is needed. */}
      <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">

      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden="true" />

      <button onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <Minus className="w-4 h-4" />
      </button>
      <span className="min-w-[2.75rem] text-center text-xs text-slate-300 tabular-nums">{zoomPct}%</span>
      <button onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <Plus className="w-4 h-4" />
      </button>
      <button onClick={() => setZoom(1)} aria-label="Fit page to the window" className={`${ctrl} px-2`}>Fit</button>

      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden="true" />

      <button onClick={() => setRotation((r) => (r + 90) % 360)} aria-label={`Rotate, currently ${rotation} degrees`} className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <RotateCw className="w-4 h-4" />
      </button>

      {onDownload && (
        <>
          <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden="true" />
          <button onClick={onDownload} aria-label="Download this file" title="Download" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
            <Download className="w-4 h-4" />
          </button>
        </>
      )}

      {/* One control, always present, always operating on THIS viewer. */}
      <button
        onClick={toggleFullScreen}
        aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'}
        title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen'}
        className={ctrl}
      >
        {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        {!fullScreen && 'Full screen'}
      </button>

      </div>
    </div>
    </>
  );

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
      ref={wrapperRef}
      className={boxClass}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={title ? `${title} PDF viewer` : 'PDF viewer'}
    >

      {/* THE HEADER. It is a flex-shrink-0 child of the root flex column and is
          deliberately NOT inside the scroll area and NOT `sticky`. Two
          problems came from having it in the scroll flow: a `sticky` element
          inside an `overflow` container is positioned by that container, so a
          page scrolling upward slid under it and showed through the gap the
          border left; and as a scroll child it occupied layout height INSIDE
          the surface, so the page began partly above it. As a sibling BEFORE
          the scroll area the viewport starts strictly under the header, so
          content can only ever appear below it. */}

      {/* The bar exists in place only when no parent header is hosting it. When
          one is, this same `toolbar` is published upward instead, so there is
          exactly one row either way. */}
      {ownsHeader && (
        <div
          className="flex-shrink-0 w-full bg-slate-900 text-slate-100 border-b border-slate-800 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        >
          <div className="h-11 px-3 flex items-center gap-2 min-w-max justify-between">
            {toolbar}
          </div>
        </div>
      )}

      <div
        ref={shellRef}
        onScroll={handleScroll}
        // `p-4` is the ONLY padding around the document, and `PAGE_PAD` is the
        // same value subtracted from the measured width/height when fitting, so
        // the page lands exactly on the padding box: no dead grey margin, and
        // no horizontal scrollbar from a border/padding miscount.
        className="relative flex-1 min-h-[320px] w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-bg-elevated/40 outline-none p-4"
        // CRITICAL: the page surface must be height-bounded or `overflow-auto`
        // never engages. Without a bound it grows to the full spacer height
        // (pageCount x pageHeight), so it cannot scroll, every scrollTop write
        // is a no-op, and pages 2..N are rendered far below the visible area —
        // which looks exactly like "only page 1 ever displays". `flex-1` only
        // resolves against a definite parent, so an explicit max-height is
        // required for the INLINE (Library modal) case. `standalone` — the
        // split pane, and the same element in real fullscreen — inherits a
        // definite height from its host, so no cap is applied here and the
        // viewer genuinely fills the pane.
        style={variant === 'standalone' || fullScreen ? undefined : { maxHeight: 'min(72vh, 720px)' }}
      >
        {/* ONE toolbar for everything, floating over the top of the page. It
            is absolutely positioned, so it consumes no layout height and the
            document still occupies 100% of the pane below it. Download lives
          here too, which is why the separate bottom action bar is gone. */}
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
                  ref={setPageEl(n)}
                  className="absolute inset-x-0 flex justify-center px-0"
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

      {/* The hint used to sit here as a real paragraph, costing a line of canvas
          height and pushing the page down. It is now visually hidden and still
          announced to screen readers, so the page gets the space back. */}
      <p className="sr-only">
        {zoomPct}% · {rotation}° · Page {page} of {pageCount || '—'}.{' '}
        Arrow keys change page, Up and Down arrows scroll, +/− zoom, Esc exits full screen.
      </p>
    </div>
  );
};
