import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2,
  Minus, Plus, RotateCw, TriangleAlert,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useZoomAnchor, advanceGestureScale, normalizeWheelDelta, pinchSensitivityFor, useTouchZoomHandlers, VIEWER_TOUCH_ACTION } from '../useZoomAnchor';
import { PdfTextLayer } from './PdfTextLayer';
import { PdfSnippetLayer } from './PdfSnippetLayer';
import { Scissors } from 'lucide-react';

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
 * Clamp and round a zoom target to exactly what will be stored.
 *
 * This is the SINGLE definition of "the zoom a target resolves to", and both
 * the live gesture preview and the commit run it. That shared definition is the
 * fix for the hand-off jump: the preview used to clamp to [0.05, 20] and keep
 * full precision, while the commit clamped to [MIN_ZOOM, MAX_ZOOM] and rounded
 * to 2dp, so what the user saw while pinching was never quite what got
 * committed — and past the limit it was wildly different.
 */
const quantizeZoom = (z: number): number | null => {
  if (!Number.isFinite(z) || z <= 0) return null;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +z.toFixed(2)));
};

/**
 * Monotonic wall clock, in milliseconds. Used by real gesture logic (the
 * post-commit momentum guard below), not for logging.
 */
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

// ---- Canvas memory budgets ------------------------------------------------
//
// Canvas memory is the failure mode that blanks a PHONE and leaves a desktop
// alone. Each canvas is width x height x 4 bytes, and a high-zoom page is
// enormous: an A4 page at 4x on a 390px-wide iPhone is a 3443x4872 canvas, and
// three of those in the render window is ~192 MB, before the off-screen staging
// set doubles it. Browsers cap a single canvas near 16.7M px (iOS) and kill the
// whole tab well before the sum of them is affordable — which surfaces as a
// blank page with no error, because the process is gone rather than throwing.

/** Desktop: the platform ceiling, unchanged from before. */
const MAX_CANVAS_PIXELS = 16_777_216;
/** Mobile: deliberately well under the per-canvas ceiling so we never touch it. */
const MOBILE_MAX_CANVAS_PIXELS = 8_000_000;
/** Mobile: dpr 3/4 quadruples memory for no visible gain at page scale. */
const MOBILE_MAX_DPR = 2;
/**
 * Mobile: total across every rendered canvas. A page may be rendered at lower
 * internal resolution (CSS scales it up) to fit inside this.
 */
const MOBILE_MAX_TOTAL_CANVAS_PIXELS = 24_000_000;
/**
 * Mobile: how low the internal resolution may be reduced. Below ~0.5 the text
 * stops being readable, so a blurry page is preferable to a killed tab.
 */
const MOBILE_MIN_DPR = 0.5;

/**
 * Coarse mobile test. Deliberately not a UA sniff: the thing we care about is a
 * small viewport on a touch device with a tight canvas budget.
 */
const isMobileViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 820;
  return (coarse && touch) || narrow;
};

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
/**
 * Toolbar control styling, built from the app's theme tokens.
 *
 * These controls are rendered in TWO places: the viewer's own bar (Library
 * modal) and, via `onRegisterControls`, inline in the universal `PaneHeader`.
 * In the second case they sit directly on the themed header bar, so any fixed
 * `slate-*` colour here would be a light-on-light contrast break in the light
 * theme. Tokens keep both hosts identical and theme-correct.
 */
const ctrl = 'inline-flex items-center justify-center gap-1 px-1.5 min-h-[26px] rounded-md border border-transparent text-content-secondary hover:text-content-primary hover:bg-bg-elevated disabled:opacity-40 disabled:hover:bg-transparent transition-colors text-xs font-semibold shrink-0';

/** The hairline separators between control groups, token-driven for the same reason. */
const sep = 'mx-0.5 h-5 w-px bg-border';

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
  // The parent's publish callback and the host's download action, held in refs.
  // Both are re-created on every render by our hosts, so putting either in the
  // memo dependency list would rebuild the toolbar every render and make the
  // parent store a new element forever. Reading them through a ref keeps the
  // memoized toolbar stable while still calling the LATEST callback.
  const publishRef = useRef(onRegisterControls);
  const downloadRef = useRef(onDownload);
  useEffect(() => {
    publishRef.current = onRegisterControls;
    downloadRef.current = onDownload;
  }, [onRegisterControls, onDownload]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(720);
  const [containerHeight, setContainerHeight] = useState(640);
  // CSS size of each rendered page, keyed by page number. BOTH dimensions are
  // stored together, from the same measurement, because a canvas whose width and
  // height come from different sources is a stretched canvas. Pages not yet
  // rendered fall back to an estimate, so the scroll geometry is stable and the
  // last page is always reachable.
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
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
  /**
   * The scroll point to keep fixed across a zoom, captured BEFORE the scale
   * changes and applied once the new layout has settled. Null means "no zoom
   * in flight". See the anchoring effect below.
   */
  /**
   * True only while a zoom-driven scroll write is in flight. The shared hook
   * owns the actual write; these two refs let the scroll handler tell our own
   * echo apart from a user drag.
   */
  const isZoomingRef = useRef(false);
  /**
   * The page-stack element the GPU transform is applied to during a gesture.
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /**
   * LIVE gesture scale, applied as a CSS transform and never as React state.
   *
   * A `wheel`/`touchmove` handler that calls `setZoom` re-renders the whole
   * page stack and kicks off pdf.js render tasks for every visible page on
   * every event — the single biggest source of pinch hitch here. Writing
   * `transform` touches only the compositor, so the gesture runs at 60fps with
   * no layout and no re-render. The value is folded into real `zoom` state only
   * once the gesture settles.
   */
  /**
   * The running gesture scale, expressed as a RATIO to the committed zoom that
   * was in effect when this gesture began. 1 = unchanged.
   *
   * The wheel handler advances exactly this value, once per event:
   *   `gestureScale *= exp(-deltaY * k)`
   * and the CSS transform is `scale(gestureScale)`. The committed zoom is
   * multiplied in EXACTLY ONCE, at commit time, and at no other point.
   *
   * This invariant is the whole fix. The previous code re-derived the gesture's
   * starting zoom on every tick as `zoomRef.current / liveScaleRef.current` and
   * fed the product `zoomRef.current * liveScaleRef.current * exp(...)` back in,
   * so the running value was divided by the committed scale on one line and
   * multiplied by it on the next. Each tick therefore compounded the previous
   * tick's output on top of itself: a comfortable pinch of ~37 units of delta
   * drove the transform to 223x while the committed zoom pinned at the 4x limit.
   */
  const liveScaleRef = useRef(1);
  const commitTimerRef = useRef<number | null>(null);
  /**
   * The committed zoom captured when the current gesture began, and held fixed
   * for its duration. Stored rather than re-derived, because the committed zoom
   * does not change mid-gesture and re-deriving it is what caused the runaway.
   */
  const gestureStartZoomRef = useRef(1);
  /**
   * Focal point of the gesture, captured ONCE at the first tick.
   *
   * This used to be overwritten on every tick, so the commit re-anchored on
   * wherever the cursor happened to be at release rather than where the gesture
   * began. On a trackpad the cursor drifts during a pinch, and the preview and
   * the commit then disagreed about which point was pinned. Captured once, the
   * preview and the commit are guaranteed to reference the same point.
   */
  const focalRef = useRef<{ x: number; y: number } | null>(null);
  /** True between the first tick of a gesture and its commit. */
  const gestureRef = useRef(false);
  // One canvas ref per page in the render window, so React can keep each
  // mounted and we paint into the right element.
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  /**
   * Snippet tool state.
   *
   * `snippetOn` arms the crop tool; `snippetPage` is the single page it is armed
   * ON. The overlay is deliberately limited to one page at a time: a crop is a
   * deliberate act on a specific region, and an armed drag surface over every
   * visible page would swallow the normal scroll-and-select gesture across the
   * whole document.
   */
  const [snippetOn, setSnippetOn] = useState(false);
  const [snippetPage, setSnippetPage] = useState(1);
  /** Bumped when a page's bitmap is replaced, to force the text layer to redraw. */
  const [textLayerGen, setTextLayerGen] = useState(0);

  /**
   * Page proxies and the viewport each was last rendered at, so the text layer
   * can be built for exactly the geometry the canvas is showing. The map is in a
   * ref and mirrored into state, because the overlay needs to re-render when a
   * viewport changes but the render pipeline itself must not re-run because a
   * ref changed.
   */
  const pageProxies = useRef(new Map<number, pdfjsLib.PDFPageProxy>());
  const pageViewports = useRef(new Map<number, pdfjsLib.PageViewport>());

  /**
   * Builds a pdf.js text layer for one page.
   *
   * `PdfViewer` is the ONLY module in the project that imports `pdfjs-dist`, so
   * that the worker is registered once and the library has a single owner. The
   * text layer is therefore constructed here and handed to `PdfTextLayer`,
   * which owns only the lifecycle.
   */
  const createTextLayer = useCallback<import('./PdfTextLayer').TextLayerFactory>(
    (container, page, viewport) => new pdfjsLib.TextLayer({
      textContentSource: (page as pdfjsLib.PDFPageProxy).streamTextContent(),
      container,
      viewport: viewport as pdfjsLib.PageViewport,
    }),
    [],
  );

  /**
   * Copy a cropped snippet to the clipboard.
   *
   * `ClipboardItem` with an image/png entry is the only way to put a picture on
   * the clipboard in a modern browser. The write is wrapped because the
   * clipboard is permission-gated and a denied write must not surface as an
   * unhandled rejection; the user still has the drag rectangle as feedback.
   */
  const onSnippetCrop = useCallback((blob: Blob | null) => {
    // SINGLE-USE. Disarm FIRST and unconditionally, before any clipboard work.
    //
    // Doing it only on the success path left the tool armed after a cancelled
    // drag, a pointer-cancel, or a mis-tap under the minimum size — the cursor
    // stayed a crosshair and the drag surface kept swallowing scroll gestures.
    // `blob` may legitimately be null for all three of those cases, so the
    // disarming cannot be conditional on it.
    setSnippetOn(false);

    // No blob means the user cancelled or mis-tapped. Nothing is copied, and the
    // guard is silent rather than an error: a cancelled drag is not a failure.
    if (!blob) return;

    // `ClipboardItem` with an image/png entry is the only way to put a picture on
    // the clipboard in a modern browser. The write is wrapped because the
    // clipboard is permission-gated and a denied write must not surface as an
    // unhandled rejection.
    const item = new ClipboardItem({ 'image/png': blob });
    void navigator.clipboard.write([item]).catch(() => { /* permission denied */ });
  }, []);

  // ---- Commit hand-off: render off-screen, then swap ------------------
  //
  // Setting `canvas.width` clears the bitmap immediately and pdf.js needs
  // several ms to draw the replacement, so doing that during the commit paints
  // a frame of blank pages — the flash after a pinch. Instead the commit renders
  // the pages near the viewport into DETACHED canvases while the preview
  // transform is still on screen, then swaps the finished bitmaps in during a
  // single layout effect, before paint.
  //
  // `swapGenRef` is a monotonic generation id. Every commit bumps it, so a render
  // that finishes late from a superseded scale is discarded rather than swapped
  // in over newer content.
  const swapGenRef = useRef(0);
  /** Off-screen renders staged for the next swap, keyed by page. */
  const stagedSwapRef = useRef<{
    gen: number;
    target: number;
    ratio: number;
    focal: { x: number; y: number };
    canvases: Map<number, HTMLCanvasElement>;
    tasks: Map<number, pdfjsLib.RenderTask>;
    /**
     * The geometry key the staged bitmaps were produced at. The swap records it
     * against each canvas so the normal render pipeline recognises the page as
     * already correct and leaves its bitmap alone.
     */
    key: string;
  } | null>(null);
  /**
   * Bumped once staging completes, to drive the swap. A counter rather than the
   * staged object itself, so the effect depends on a primitive.
   */
  const [swapReady, setSwapReady] = useState(0);
  /** Pages already swapped at a given generation, so a late task is ignored. */
  const swappedGenRef = useRef<Map<number, number>>(new Map());
  /**
   * Pages whose on-screen canvas already holds the correct bitmap for the current
   * zoom. `renderInto` consults this so it does not blank a canvas the swap has
   * just filled — otherwise the flash would simply move rather than disappear.
   */
  const freshSwapRef = useRef<Map<number, { cssW: number; cssH: number }>>(new Map());
  /**
   * The geometry key each canvas's bitmap was produced at — `zoom|rotation|
   * containerW x containerH`. A page whose key already matches the current
   * geometry is skipped by the normal render pipeline, so a zoom just satisfied
   * by the swap is never redrawn — and so its bitmap is never cleared. The swap
   * writes into this map too, which is what makes the two paths agree.
   */
  const renderedKeyRef = useRef<Map<number, string>>(new Map());

  /**
   * Release a page's canvas memory.
   *
   * Setting width/height to 0 is the documented way to hand a canvas's backing
   * store back immediately rather than waiting for GC. A page that scrolls out of
   * the render window would otherwise hold a multi-megabyte bitmap that nothing
   * releases promptly on a phone, and several of those are what blank the tab.
   */
  const releaseCanvas = useCallback((n: number) => {
    const canvas = canvasRefs.current.get(n);
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    renderedKeyRef.current.delete(n);
  }, []);
  /**
   * Milliseconds since the last commit. A touchpad's momentum tail keeps firing
   * ctrl+wheel events after the fingers lift; without this they would start a
   * brand new gesture a frame later and undo the commit the user just made.
   */
  const lastCommitAtRef = useRef(0);

  /**
   * How long the off-screen render may take before the commit proceeds anyway.
   * Past this the old bitmap is stretched to the new size — blurry, but never
   * blank — and the sharp bitmap is blitted when it lands.
   */
  const SWAP_BUDGET_MS = 300;

  /** Discard any staged off-screen work. Safe to call when idle. */
  const abortSwap = useCallback(() => {
    swapGenRef.current += 1;
    const staged = stagedSwapRef.current;
    stagedSwapRef.current = null;
    if (staged) for (const [, t] of staged.tasks) { try { t.cancel(); } catch { /* settled */ } }
  }, []);

  /** Register a canvas for a page; returns a ref callback. */
  const setCanvas = useCallback((n: number) => (el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(n, el);
    else canvasRefs.current.delete(n);
  }, []);

  /**
   * The CSS box and backing-store size a page needs at a given zoom.
   *
   * Factored out so the on-screen and off-screen render paths cannot disagree
   * about the geometry: a mismatch here is exactly what makes a swapped page
   * land at a slightly different size than the wrapper that was measured for it.
   */
  const pageGeometry = useCallback((pageW: number, pageH: number, atZoom: number, livePages = 1) => {
    const rotated = rotation % 180 !== 0;
    const availW = Math.max(1, containerWidth - PAGE_PAD);
    const availH = Math.max(1, containerHeight - PAGE_PAD);
    const fitScale = Math.min(availW / pageW, availH / pageH, MAX_FIT);
    const cssScale = fitScale * atZoom;
    const nativeDpr = window.devicePixelRatio || 1;
    const cssPixels = Math.max(1, pageW * cssScale * pageH * cssScale);

    const mobile = isMobileViewport();
    // Mobile gets a much tighter per-canvas ceiling and a capped device ratio;
    // a page may then be rendered at LOWER internal resolution, which CSS scales
    // back up. Blurry beats a killed tab.
    //
    // The TOTAL budget is what actually matters on a phone: a per-canvas cap
    // alone still allows N of them alive at once. The ceiling is therefore
    // divided by how many pages can be resident, so the sum stays bounded.
    const perCanvasCap = mobile
      ? Math.min(MOBILE_MAX_CANVAS_PIXELS, MOBILE_MAX_TOTAL_CANVAS_PIXELS / Math.max(1, livePages))
      : MAX_CANVAS_PIXELS;
    const dprCap = mobile ? MOBILE_MAX_DPR : nativeDpr;
    const minDpr = mobile ? MOBILE_MIN_DPR : 1;
    const budgetDpr = Math.sqrt(perCanvasCap / cssPixels);
    // The floor matters: the old `Math.max(1, ...)` silently UNDID the budget
    // whenever budgetDpr fell below 1, so the biggest pages were the ones that
    // blew past the ceiling. It must be allowed below 1 on mobile.
    const dpr = Math.max(minDpr, Math.min(dprCap, budgetDpr));
    // The ZOOM-1 size, which does not depend on `atZoom`. Page sizes are stored
    // in these units so the LAYOUT is a pure function of (base size, zoom) and is
    // therefore final the instant the zoom changes — no waiting for a render.
    //
    // Storing the size at whatever zoom it was measured was the bug: `layout`
    // read the stale value, so at commit time the scroll surface was still at the
    // OLD size and the scroll write was clamped against it.
    const baseW = pageW * fitScale;
    const baseH = pageH * fitScale;
    return {
      cssScale,
      dpr,
      baseW,
      baseH,
      cssW: Math.floor(baseW * atZoom),
      cssH: Math.floor(baseH * atZoom),
      viewportScale: cssScale * dpr,
    };
  }, [rotation, containerWidth, containerHeight]);

  // Render only the pages near the current one, so a long document does not
  // allocate a canvas per page. Canvases that scroll out of range are simply
  // unmounted by React, releasing their memory.
  const renderWindow = useMemo(() => {
    // Buffering the neighbouring pages keeps scrolling smooth, but each one is a
    // full-size canvas. On mobile at high zoom that is what exhausts the canvas
    // budget and blanks the tab, so the buffer shrinks to nothing as the pages
    // grow: the visible page only.
    const mobile = isMobileViewport();
    const buffer = mobile ? (zoom >= 2 ? 0 : 1) : 1;
    const from = Math.max(1, page - buffer);
    const to = Math.min(pageCount, page + buffer);
    const out: number[] = [];
    for (let n = from; n <= to; n += 1) out.push(n);
    return out;
  }, [page, pageCount, zoom]);

  /**
   * Render the pages near the viewport at `target` into DETACHED canvases.
   *
   * The preview transform stays on the whole time, so the user keeps seeing the
   * smooth transformed preview while this runs. Nothing here touches a visible
   * canvas, so nothing can flash.
   *
   * `commit` is invoked exactly once — when every render lands, or when the
   * budget expires, whichever comes first. It performs the actual zoom.
   */
  const stageSwap = useCallback((
    target: number,
    ratio: number,
    focal: { x: number; y: number },
    commit: () => void,
  ) => {
    const doc = docRef.current;
    abortSwap();
    const gen = swapGenRef.current;
    // Only the pages near the viewport are pre-rendered. Everything else keeps
    // its correct wrapper size and is rendered lazily as it scrolls into range.
    // Commit exactly once, and only while this generation is still current.
    let fired = false;
    const fire = () => {
      if (fired) return;
      if (swapGenRef.current !== gen) return;
      fired = true;
      commit();
    };

    // MOBILE: staging is skipped entirely. Holding a second full-size set of
    // DETACHED canvases alongside the on-screen ones doubles peak memory
    // (~384 MB on an iPhone at 4x), which is the single largest contributor to
    // the tab being killed. The commit still happens in the same frame; the
    // bitmap simply arrives a few ms later via the normal path, leaving a brief
    // soft-scaled page instead of a dead tab.
    if (isMobileViewport()) {
      stagedSwapRef.current = null;
      fire();
      return;
    }

    const pages = renderWindow;
    const staged = {
      gen,
      target,
      ratio,
      focal,
      canvases: new Map<number, HTMLCanvasElement>(),
      tasks: new Map<number, pdfjsLib.RenderTask>(),
      key: `${target}|${rotation}|${containerWidth}x${containerHeight}`,
    };
    stagedSwapRef.current = staged;

    // The budget: proceed anyway once the delay is spent, so a slow page can
    // never leave the viewer stuck showing the preview. Missing bitmaps fall back
    // to stretching the old pixels, which is blurry but never blank.
    const timer = setTimeout(fire, SWAP_BUDGET_MS);

    if (!doc || pages.length === 0) {
      clearTimeout(timer);
      setSwapReady((v) => v + 1);
      fire();
      return;
    }

    void Promise.all(pages.map(async (n) => {
      try {
        const pdfPage = await doc.getPage(n);
        if (swapGenRef.current !== gen) return;
        const unit = pdfPage.getViewport({ scale: 1 });
        const rotated = rotation % 180 !== 0;
        const pageW = rotated ? unit.height : unit.width;
        const pageH = rotated ? unit.width : unit.height;
        const geo = pageGeometry(pageW, pageH, target);
        // DETACHED: a canvas attached to the document could itself paint.
        const off = document.createElement('canvas');
        off.width = Math.floor(pageW * geo.viewportScale);
        off.height = Math.floor(pageH * geo.viewportScale);
        const ctx = off.getContext('2d');
        if (!ctx) return;
        const viewport = pdfPage.getViewport({ scale: geo.viewportScale, rotation });
        const task = pdfPage.render({ canvas: off, canvasContext: ctx, viewport });
        staged.tasks.set(n, task);
        await task.promise;
        if (swapGenRef.current !== gen) return;
        staged.canvases.set(n, off);
      } catch {
        // A cancelled or failed page simply does not join the swap; the swap
        // effect falls back to the old bitmap for it.
      }
    })).then(() => {
      if (swapGenRef.current !== gen) return;

      clearTimeout(timer);
      setSwapReady((v) => v + 1);
      fire();
    });
  }, [abortSwap, renderWindow, rotation, pageGeometry, containerWidth, containerHeight]);



  // Pages are laid out end to end from their measured sizes. Unmeasured pages use
  // an estimate derived from the average of the measured ones (or a portrait A4
  // ratio as a last resort). The estimate carries BOTH dimensions from the same
  // ratio, so even an unmeasured page keeps a sane shape.
  //
  // THE GAP SCALES WITH THE ZOOM.
  //
  // It used to be a constant `PAGE_GAP`, which meant the scroll surface was only
  // PARTLY scalable: the page boxes grew with zoom but the gaps between them did
  // not. The shared anchor assumes a uniformly scaled surface, so it drifted by
  // about `pageIndex * PAGE_GAP * (ratio - 1)` — exact on page 1, growing with
  // the page index, which is exactly why the jump felt random. Scaling the gap
  // makes the whole surface one uniform scale, so the anchor is exact everywhere
  // and the preview transform agrees with the committed layout on every page.
  const measured = Object.values(pageSizes);
  const avgHeight = measured.length
    ? measured.reduce((a, b) => a + b.h, 0) / measured.length
    : 0;
  const avgWidth = measured.length
    ? measured.reduce((a, b) => a + b.w, 0) / measured.length
    : 0;
  // The fallback MUST be memoized on primitive values. It used to be built
  // inline, which handed `useMemo` below a fresh object identity on every render,
  // so `layout` was rebuilt every render — and both scroll effects depend on
  // `layout`, meaning the focal restore and the nav-sync ran constantly. That is
  // what made zooming feel like it was snapping and fighting the user.
  const fallbackW = Math.round(avgWidth || containerWidth);
  const fallbackH = Math.round(avgHeight || containerWidth * 1.414);
  const fallback = useMemo(
    () => ({ w: fallbackW, h: fallbackH }),
    [fallbackW, fallbackH],
  );

  /** Cumulative top offset plus the exact size of every page. */
  const layout = useMemo(() => {
    const out: { top: number; width: number; height: number }[] = [];
    // The gap is expressed at zoom 1 and scaled here, so the page boxes and the
    // space between them always share one scale factor.
    const gap = PAGE_GAP * zoom;
    let y = 0;
    for (let n = 1; n <= pageCount; n += 1) {
      const size = pageSizes[n] ?? fallback;
      // `size` is the ZOOM-1 size, so the box at the current zoom is derived
      // here rather than waited on. This is what makes the whole stack final in
      // the same render the zoom lands in.
      //
      // NOT rounded. Flooring each page individually breaks the uniform-scale
      // property the anchor depends on: the accumulated truncation over a long
      // document drifts the focal point by tens of pixels. A sub-pixel band is
      // invisible; a 26px jump is not. The gap absorbs any seam.
      const h = size.h * zoom;
      const w = size.w * zoom;
      out.push({ top: y, width: w, height: h });
      // A small gap so consecutive pages read as separate sheets. It is added
      // only BETWEEN pages, so the first page still starts flush at the top.
      y += h + (n < pageCount ? gap : 0);
    }
    return out;
  }, [pageSizes, pageCount, fallback, zoom]);

  const last = layout.length ? layout[layout.length - 1] : null;
  const totalHeight = last ? last.top + last.height : 0;
  /**
   * Width of the scrollable surface. A page zoomed past "Fit" is wider than the
   * container, so the surface has to grow to the WIDEST page. Without this the
   * page bands stay locked to the container width, and a wide page gets centred
   * in a too-narrow band: it overflows equally on both sides, and the left
   * overflow is unreachable because there is nothing to scroll left to.
   */
  const contentWidth = layout.reduce((w, e) => Math.max(w, e.width), 0);

  // Chrome resolved at a specific zoom.
  //
  // The GAP scales with the zoom; the PADDING does not. That asymmetry is
  // deliberate: the gap lives INSIDE the content element, so it has to share the
  // page scale or the surface is not uniformly scaled and the anchor drifts by
  // roughly `pageIndex * PAGE_GAP * (ratio - 1)` — which is what made the jump
  // depend on where the pinch happened. The padding lives OUTSIDE the content,
  // so the anchor subtracts it before scaling and adds the same value back
  // after; the two cancel and it must stay constant so the gutter does not grow.
  const getFixed = useCallback(
    (_el: HTMLElement, atZoom: number) => {
      const pad = PAGE_PAD * 2;
      const gaps = PAGE_GAP * atZoom * Math.max(0, pageCount - 1);
      return { leadX: PAGE_PAD, leadY: PAGE_PAD, totalX: pad, totalY: pad + gaps };
    },
    [pageCount],
  );

  // The focal-point restore lives in the SHARED `useZoomAnchor` hook: it runs
  // exactly once per zoom action, is not driven by scroll events, and cannot
  // re-apply on a later render. See useZoomAnchor.ts.
  //
  // `beforeWrite` runs inside that hook's layout effect, so the preview removal,
  // the wrapper resize, the canvas swap, the forced layout and the scroll write
  // all land in ONE synchronous block before paint. Doing the canvas swap from a
  // separate effect left the wrappers at the new size while the canvases still
  // held old or cleared bitmaps — a frame of blank pages.
  const zoomAnchor = useZoomAnchor(shellRef, layout, zoom, getFixed, (el) => {
    // `staged` is null whenever the commit did NOT go through the off-screen
    // staging path — a button/keyboard zoom, a document with no pages, or a
    // swap already consumed. Every read of it below is therefore inside an
    // `if (staged)` guard, and NOTHING in this block may dereference it
    // unguarded: a missing measurement must never be able to break zooming.
    const staged = stagedSwapRef.current;

    // (1) Remove the preview transform. A transform grows the scrollable
    // overflow area, so leaving it on would corrupt every measurement below.
    const content = contentRef.current;
    if (content) content.style.transform = '';

    // (2) Resize the wrappers. React has already applied the new `layout`
    // (the effect runs after DOM mutation), so this only re-asserts the canvas
    // CSS box to match the band it sits in.
    //
    // (3) Swap in the finished off-screen bitmaps. `width`/`height` clear the
    // bitmap, so the drawImage must follow immediately and synchronously — the
    // browser cannot paint in between, so no blank frame is ever observable.
    if (staged) {
      for (const n of renderWindow) {
        const live = canvasRefs.current.get(n);
        if (!live) continue;
        const bit = staged.canvases.get(n);
        const entry = layout[n - 1];
        if (bit) {

          live.width = bit.width;
          live.height = bit.height;
          const ctx = live.getContext('2d');
          if (ctx) ctx.drawImage(bit, 0, 0);
          if (entry) {
            live.style.width = `${entry.width}px`;
            live.style.height = `${entry.height}px`;
            freshSwapRef.current.set(n, { cssW: entry.width, cssH: entry.height });
            swappedGenRef.current.set(n, staged.gen);
            // Record the geometry the swapped bitmap now represents, so the normal
            // render pipeline skips this page instead of clearing the bitmap we
            // just drew. This is what stops the flash reappearing a frame later.
            renderedKeyRef.current.set(n, staged.key);
          }
        } else if (entry) {
          // Budget exceeded: new CSS box, OLD bitmap left in place. The browser
          // stretches the old pixels — blurry for a moment, never blank.
          live.style.width = `${entry.width}px`;
          live.style.height = `${entry.height}px`;
        }
      }
    }



    // The staged work is consumed by this block.
    stagedSwapRef.current = null;
  });

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

  /**
   * Move to a new zoom, remembering where the viewport was centred.
   *
   * `knownRatio` is supplied by the gesture path, which knows the committed
   * scale exactly. It is the ratio of the scale actually stored to the scale that
   * was committed before — not the preview factor, which may have been clamped
   * or rounded on the way in.
   */
  const applyZoom = useCallback((next: number, clientX?: number, clientY?: number, knownRatio?: number) => {
    // The SAME quantizer the gesture preview uses. Two different definitions of
    // "the zoom this resolves to" is precisely how the preview and the commit
    // came to disagree.
    const clamped = quantizeZoom(next);
    if (clamped === null) return;
    const prev = zoomRef.current;
    const el = shellRef.current;
    if (el && clamped !== prev && prev > 0) {
      // Arm the shared hook with the focal point in CONTENT coordinates, plus
      // the analytic ratio when we have one. The button path deliberately passes
      // NO ratio, so the hook keeps measuring the extents exactly as before —
      // that measurement is valid there because no transform is applied. Only
      // the gesture path supplies a ratio, because its extents are inflated by
      // the live preview. See useZoomAnchor.

      zoomAnchor.capture(el, clientX, clientY, knownRatio);
      isZoomingRef.current = true;
      // The hook performs the write in a layout effect after this render; release
      // the flag on the next frame, once the resulting scroll event has fired.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { isZoomingRef.current = false; });
      } else {
        setTimeout(() => { isZoomingRef.current = false; }, 0);
      }
    }
    setZoom(clamped);
  }, [zoomAnchor]);

  const changeZoom = useCallback((delta: number) => {
    applyZoom(zoomRef.current + delta);
  }, [applyZoom]);

  // ---- Live GPU-transform zoom during a gesture --------------------------
  // `applyLive` is the only thing a `wheel`/`touchmove` event calls. It mutates
  // one inline `transform` and returns: no setZoom, no page re-render, no pdf.js
  // render task, no layout read.
  /**
   * Preview a gesture step. `nextRatio` is the new scale RELATIVE to the zoom
   * that was committed when this gesture started.
   *
   * The absolute target is derived here, once, and is the only place the
   * committed zoom is combined with the running ratio. The transform shows
   * `nextRatio` directly, because that is the factor applied on top of the
   * already-committed layout.
   */
  const applyLive = useCallback((nextRatio: number, clientX: number, clientY: number) => {
    const el = contentRef.current;
    const shell = shellRef.current;
    if (!el || !shell) return;
    if (!Number.isFinite(nextRatio) || nextRatio <= 0) return;

    // The focal point is captured ONCE, at the first tick of the gesture. Later
    // ticks must not move it: the preview origin and the commit anchor have to
    // reference the same point, and a trackpad cursor drifts mid-pinch.
    if (!gestureRef.current) {
      gestureRef.current = true;
      // A pinch starting while off-screen renders are still running supersedes
      // them: their bitmaps are for the old scale and must never be swapped in.
      // `abortSwap` bumps the generation and cancels the pdf.js tasks.
      if (stagedSwapRef.current) abortSwap();
      // Pin the base for the whole gesture. The committed zoom cannot change
      // until the commit, so this is stable by construction.
      gestureStartZoomRef.current = zoomRef.current;
      focalRef.current = { x: clientX, y: clientY };
      const r0 = shell.getBoundingClientRect();

    }
    const focal = focalRef.current ?? { x: clientX, y: clientY };

    // The preview must show EXACTLY the scale that will be committed.
    //
    // The transform is applied on top of a layout already rendered at the
    // gesture's base zoom, so the visual scale the user sees is
    // `base * nextRatio`, while the commit will store `quantize(base * ratio)`.
    // Showing the raw running ratio therefore left a small but real step at the
    // hand-off — a comfortable pinch previewed 1.5683x and committed 1.5700x.
    // Resolving the absolute target through the SAME quantizer the commit uses,
    // then expressing the preview as `target / base`, makes the two identical by
    // construction.
    const base = gestureStartZoomRef.current;
    const absolute = quantizeZoom(base * nextRatio);
    if (absolute === null) return;
    liveScaleRef.current = base > 0 ? absolute / base : 1;
    const nextRatioQ = liveScaleRef.current;

    // transformOrigin in the CONTENT element's own coordinates, which is the
    // same space the shared anchor reconstructs on commit — that is what makes
    // the hand-off seamless.
    //
    // `scrollTop` is measured from the shell's PADDING box, but the transform is
    // applied to the CONTENT element, whose own origin sits `PAGE_PAD` further
    // in. The padding does not scale, so this is a constant.
    const rect = shell.getBoundingClientRect();
    const ox = shell.scrollLeft + (focal.x - rect.left) - PAGE_PAD;
    const oy = shell.scrollTop + (focal.y - rect.top) - PAGE_PAD;

    el.style.transformOrigin = `${ox}px ${oy}px`;
    el.style.transform = Math.abs(nextRatioQ - 1) < 0.0005 ? '' : `scale(${nextRatioQ})`;
  }, []);

  const clearLive = useCallback(() => {
    const el = contentRef.current;
    if (el) el.style.transform = '';
    liveScaleRef.current = 1;
  }, []);

  /** Fold the live scale into real state. Safe to call when nothing is live. */
  const commitLive = useCallback(() => {
    // The committed zoom is combined with the running ratio EXACTLY ONCE, here.
    // `gestureStartZoomRef.current` is the value committed when the gesture began
    // and is unchanged since.
    const target = quantizeZoom(gestureStartZoomRef.current * liveScaleRef.current);
    const focal = focalRef.current;
    const shell = shellRef.current;
    const prev = gestureStartZoomRef.current;
    const ratio = prev > 0 && target !== null ? target / prev : 1;

    gestureRef.current = false;
    focalRef.current = null;
    if (target === null || !focal || target === zoomRef.current) {
      // Nothing to commit — but the preview transform MUST still come off, or
      // the content stays visually scaled with no state backing it.
      clearLive();
      liveScaleRef.current = 1;
      gestureStartZoomRef.current = zoomRef.current;
      return;
    }
    // The transform is deliberately NOT removed here. `applyZoom` sets state, and
    // the shared hook's layout effect then drops the preview, swaps the bitmaps
    // and writes the restored scroll position in ONE synchronous block, before
    // paint. Clearing it here would show one frame at the unzoomed scale.
    //
    // Before committing, the pages near the viewport are re-rendered at the
    // TARGET scale into detached canvases. The preview transform stays up while
    // that happens, so the user keeps seeing a smooth preview; the swap then
    // moves the finished bitmaps in atomically. Without this the commit resizes
    // the visible canvases first, which clears their bitmaps and shows a flash of
    // blank pages while pdf.js redraws.

    stageSwap(target, ratio, focal, () => {
      // The real zoom lands only now: the off-screen bitmaps are ready (or the
      // budget has expired), so the visible canvases can be filled in the same
      // commit instead of being cleared and left blank.
      applyZoom(target, focal.x, focal.y, ratio);
    });
    // The running ratio resets only AFTER the swap has been handed off, so
    // nothing the swap still needs can be cleared out from under it. The next
    // gesture starts from 1x relative to whatever is now committed.
    liveScaleRef.current = 1;
    gestureStartZoomRef.current = target;
    // Mark the moment so the touchpad's momentum tail — which keeps firing
    // ctrl+wheel events for a few frames — is discarded instead of opening a new
    // gesture on a stale base.
    lastCommitAtRef.current = nowMs();
  }, [applyZoom, clearLive, stageSwap, layout]);

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
    // otherwise, and the page would still zoom/scroll behind the viewer. It is
    // attached to the ZOOM SURFACE and nowhere else in the app.
    const onWheel = (e: WheelEvent) => {
      // Only a modifier-wheel is a zoom gesture. A pinch sets ctrlKey; macOS
      // Cmd+wheel (and some trackpads) set metaKey. BOTH must be claimed.
      //
      // Everything else returns immediately WITHOUT preventDefault, so ordinary
      // vertical/horizontal wheel scrolling stays 100% native and fluid. Calling
      // preventDefault on a plain wheel is what makes a scroll container feel
      // locked: the browser stops applying native scrolling and nothing else
      // takes over, so the page simply stops responding to the wheel.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = normalizeWheelDelta(e.deltaY, e.deltaMode);
      // A touchpad keeps firing ctrl+wheel events for a few frames after the
      // fingers lift (the momentum tail). Each one used to start a brand new
      // gesture at a base of 1, silently undoing the commit the user had just
      // made. A tiny delta this soon after a commit is that tail, not intent, so
      // it is dropped: still claimed, so the browser does not page-zoom, but it
      // must not open a gesture or touch the transform.
      const sinceCommit = nowMs() - lastCommitAtRef.current;
      if (Math.abs(delta) < 0.5 && lastCommitAtRef.current > 0 && sinceCommit < 150) {

        return;
      }

      // Advance ONE running gesture scale, multiplicatively, by this event's
      // delta alone. `liveScaleRef` is a ratio to the zoom committed when this
      // gesture began; the committed zoom is NOT multiplied in here. Feeding
      // `zoomRef.current * liveScaleRef.current * exp(...)` into a function that
      // then divided by the same factor compounded every tick, which is what
      // made a single pinch explode past 200x.
      const k = pinchSensitivityFor(e.deltaY, e.deltaMode);
      const before = liveScaleRef.current;
      const after = advanceGestureScale(before, e.deltaY, e.deltaMode);

      applyLive(after, e.clientX, e.clientY);
      // Commit once the gesture pauses, so a burst of events costs one re-render
      // instead of one per event.
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        commitLive();
      }, 150);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, [applyLive, commitLive]);

  // ---- Mobile / tablet two-finger pinch --------------------------------
  // The gesture maths lives in the shared hook; the zoom itself is delegated to
  // the SAME `applyLive` / `commitLive` the trackpad pinch uses, so there is one
  // implementation, not two.
  const touchZoom = useTouchZoomHandlers({
    el: shellRef.current,
    applyLive,
    commitLive,
  });

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // touchmove MUST be non-passive: preventDefault is ignored on a passive
    // listener, and without it the browser page-zooms alongside our pinch. It is
    // claimed only while two touches are down, so one-finger panning stays
    // native. The gesture events are iOS-only and are simply inert elsewhere.
    el.addEventListener('touchstart', touchZoom.onTouchStart, { passive: true });
    el.addEventListener('touchmove', touchZoom.onTouchMove, { passive: false });
    el.addEventListener('touchend', touchZoom.onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', touchZoom.onTouchCancel, { passive: true });
    el.addEventListener('gesturestart', touchZoom.onGestureStart, { passive: false });
    el.addEventListener('gesturechange', touchZoom.onGestureChange, { passive: false });
    el.addEventListener('gestureend', touchZoom.onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', touchZoom.onTouchStart);
      el.removeEventListener('touchmove', touchZoom.onTouchMove);
      el.removeEventListener('touchend', touchZoom.onTouchEnd);
      el.removeEventListener('touchcancel', touchZoom.onTouchCancel);
      el.removeEventListener('gesturestart', touchZoom.onGestureStart);
      el.removeEventListener('gesturechange', touchZoom.onGestureChange);
      el.removeEventListener('gestureend', touchZoom.onGestureEnd);
    };
  }, [touchZoom]);

  // A new document must never inherit a transform or a pending commit.
  useEffect(() => {
    gestureRef.current = false;
    focalRef.current = null;
    liveScaleRef.current = 1;
    gestureStartZoomRef.current = 1;
    abortSwap();
    clearLive();
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, [blob, clearLive]);

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

      const unit = pdfPage.getViewport({ scale: 1 });
      const rotated = rotation % 180 !== 0;
      // Rotation swaps the page's effective width and height, so the fit has to
      // be computed against the ROTATED dimensions.
      const pageW = rotated ? unit.height : unit.width;
      const pageH = rotated ? unit.width : unit.height;
      const geo = pageGeometry(pageW, pageH, zoom, renderWindow.length);
      const cssW = geo.cssW;
      const cssH = geo.cssH;

      // (4) The swap may already have put a finished bitmap on this canvas at
      // exactly this scale. Re-rendering would CLEAR it and cause the very flash
      // the swap exists to prevent, so the normal pipeline skips it.
      //
      // The key covers everything that determines the geometry, so a container
      // resize or a rotation still forces a re-render; only a pure zoom that has
      // already been satisfied is skipped.
      const key = `${zoom}|${rotation}|${containerWidth}x${containerHeight}`;
      const done = renderedKeyRef.current.get(n);
      if (done === key) {
        renderTasksRef.current.delete(n);

        return;
      }

      const context = canvas.getContext('2d');
      if (!context) return;

      // Backing store: physical pixels, so text stays crisp instead of being
      // upscaled by the browser. `viewportScale` already carries the device pixel
      // ratio, so the store is simply the page size at that scale.
      //
      // Every write to canvas.width/height is logged. Setting either one CLEARS
      // the bitmap, so this is the single most important line to be able to
      // account for when a blank frame appears.

      canvas.width = Math.floor(pageW * geo.viewportScale);
      canvas.height = Math.floor(pageH * geo.viewportScale);

      // CSS size: set imperatively so the page is correct on the very first
      // paint, before React re-renders with the same numbers. There is
      // deliberately NO `max-width: 100%` here — it was the aspect-ratio bug.
      // max-width squeezes the width while the height stays fixed, which
      // stretches the page; and it fights the explicit width so a zoomed page
      // silently shrinks back instead of being scrollable. Overflow is the
      // scroll container's job, and the surface is grown to the widest page.
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      // Record the ZOOM-1 size, which is what the layout multiplies by the
      // current zoom. Recording the size at the measuring zoom is what left the
      // stack stale at commit time.
      setPageSizes((prev) =>
        prev[n] && Math.abs(prev[n].w - geo.baseW) < 0.5 && Math.abs(prev[n].h - geo.baseH) < 0.5
          ? prev
          : { ...prev, [n]: { w: geo.baseW, h: geo.baseH } }
      );

      const viewport = pdfPage.getViewport({ scale: geo.viewportScale, rotation });

      // Record the geometry the text layer must align to. This happens BEFORE
      // the await: the text layer does not care whether the bitmap finished
      // painting, and building it here means the text is selectable a frame
      // earlier. The generation bump is what tells React to rebuild the overlay.
      pageProxies.current.set(n, pdfPage);
      pageViewports.current.set(n, viewport);
      setTextLayerGen((g) => g + 1);

      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTasksRef.current.set(n, task);
      try {
        await task.promise;
      } catch (err) {

        throw err;
      }
      // Only now is the canvas genuinely holding a bitmap at this geometry, so
      // only now is it safe to record the key and let future renders skip it.
      renderedKeyRef.current.set(n, key);

      if (isCurrent()) renderTasksRef.current.delete(n);
    } catch (e) {
      if (isCancel(e) || !isCurrent()) return;
      setError(e instanceof Error ? e.message : 'Could not render this page.');
      setStatus('error');
    } finally {
      // The spinner clears once no page is still rendering.
      if (renderTasksRef.current.size === 0) setRendering(false);
    }
  }, [zoom, rotation, pageGeometry]);

  const windowKey = renderWindow.join(',');

  // Escape disarms. Without this, a pointer-cancel that never delivered a
  // `pointerup` would leave the overlay armed with no way out of it except
  // finding the toolbar button again.
  useEffect(() => {
    if (!snippetOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSnippetOn(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [snippetOn]);

  // The snippet overlay follows the current page, so changing pages moves the
  // armed drag surface with it rather than leaving it stranded on the old page.
  useEffect(() => {
    if (snippetOn) setSnippetPage(page);
  }, [snippetOn, page]);

  // Render only the pages near the current one, so a long document does not
  // allocate a canvas per page. Canvases that scroll out of range are simply
  // unmounted by React, releasing their memory.
  useEffect(() => {
    if (status !== 'ready') return;
    for (const n of renderWindow) void renderInto(n);
    // Release anything that just left the window. React unmounting the <canvas>
    // does not promptly release its backing store on a phone, so a long scroll
    // accumulates one full-size bitmap per page visited and takes the tab down.
    const inWindow = new Set(renderWindow);
    for (const n of Array.from(renderedKeyRef.current.keys())) {
      if (!inWindow.has(n)) releaseCanvas(n);
    }
    // Cancel everything still in flight when the window, zoom, rotation or
    // width changes, so nothing paints over a newer render.
    return () => {
      for (const [, t] of renderTasksRef.current) t.cancel();
      renderTasksRef.current.clear();
    };
    // `windowKey` stands in for the array identity of renderWindow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, windowKey, zoom, rotation, containerWidth, containerHeight, renderInto, releaseCanvas]);

  // A different document starts a fresh set of measured sizes.
  useEffect(() => {
    abortSwap();
    setPageSizes({});
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
    // A zoom-driven write is in flight. This event is the echo of our own
    // assignment, not a user action, so it must not drive page state.
    if (isZoomingRef.current) return;
    // A late echo of a previous write, recognised by the position it produced.
    const w = zoomAnchor.lastWrite();
    if (w && Math.abs(el.scrollLeft - w.l) <= 1 && Math.abs(el.scrollTop - w.t) <= 1) {
      zoomAnchor.clearWrite();
      return;
    }
    // Anything else is the user. If a zoom anchor is still armed, the user has
    // taken over — drop it, or the next layout pass would yank them back to a
    // position they never asked for. That fight is what reads as "snapping".
    zoomAnchor.clearWrite();
    zoomAnchor.cancel();
    const mid = el.scrollTop + el.clientHeight / 2;
    const next = pageAtOffset(mid);
    if (next !== page) goToPage(next);
  };

  // There is deliberately NO layout-driven "scroll to the current page" effect.
  //
  // It used to run on every `[page, layout]` change and smooth-scroll to
  // `layout[page-1].top`. With a focal-point zoom the view deliberately lands
  // AWAY from the page top, so the moment the zoom anchor settled and cleared
  // itself this effect fired and threw the view to a nearby but wrong position.
  // It was also redundant: the nav buttons, arrows and page input all scroll via
  // `scrollIntoView()` on the real element, which is immune to the layout array
  // being rebuilt. The page indicator follows scrolling through `handleScroll`.

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
    ? 'fixed inset-0 z-[60] flex flex-col gap-0 p-0 h-full min-h-0 min-w-0 w-full bg-bg-primary overflow-hidden'
    : 'flex flex-col gap-0 h-full min-h-0 min-w-0 w-full overflow-hidden';
  // The control row, MEMOIZED. The identity must be stable across renders that
  // do not change the controls, because the parent stores this element and a
  // fresh element every render would make it re-render forever. `useMemo` also
  // means the registered node genuinely changes when page/zoom/rotation do, so
  // the header updates in step with the viewer.
  const toolbar = useMemo(
    () => (
    <>
      <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
      {/* CENTRE: page navigation. In the modal this bar is the only header; in a
          split pane the universal PaneHeader owns the row and the viewer
          contributes these controls into it. */}
      <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
      <button onClick={onPrevPage} disabled={page <= 1 || pageCount === 0} aria-label="Previous page" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <label className="flex items-center gap-1.5 text-xs text-content-secondary flex-shrink-0 whitespace-nowrap">
        <span className="sr-only">Page number</span>
        <input
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => { const n = Number(pageInput) || 1; scrollPageIntoView(n); goToPage(n); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const n = Number(pageInput) || 1; scrollPageIntoView(n); goToPage(n); } }}
          inputMode="numeric"
          aria-label="Page number"
          className="w-10 text-center bg-bg-elevated border border-border-strong rounded-md px-1 py-1 text-xs text-content-primary tabular-nums outline-none focus:border-accent"
        />
        <span className="tabular-nums whitespace-nowrap text-content-secondary">of {pageCount || '—'}</span>
      </label>
      <button onClick={onNextPage} disabled={page >= pageCount || pageCount === 0} aria-label="Next page" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <ChevronRight className="w-4 h-4" />
      </button>
      </div>

      {/* RIGHT: zoom, fit, rotate, download, fullscreen, then the host's pane
          buttons. The row is already justify-between, so no ml-auto is needed. */}
      <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">

      <span className={sep} aria-hidden="true" />

      <button onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <Minus className="w-4 h-4" />
      </button>
      <span className="min-w-[2.75rem] text-center text-xs text-content-secondary tabular-nums">{zoomPct}%</span>
      <button onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <Plus className="w-4 h-4" />
      </button>
      <button onClick={() => setZoom(1)} aria-label="Fit page to the window" className={`${ctrl} px-2`}>Fit</button>

      <span className={sep} aria-hidden="true" />

      {/* Snippet tool. Arms a drag-to-crop on the CURRENT page; the crop is
          copied to the clipboard as a PNG. It is a toggle rather than a momentary
          button because the user has to scroll and aim before dragging, and
          arming it for the whole document would block text selection. */}
      <button
        onClick={() => setSnippetOn((v) => !v)}
        aria-pressed={snippetOn}
        aria-label="Crop a snippet from this page"
        className={`${ctrl} px-2 ${snippetOn ? 'text-content-primary bg-bg-elevated' : ''}`}
      ><Scissors className="w-4 h-4" /></button>

      <button onClick={() => setRotation((r) => (r + 90) % 360)} aria-label={`Rotate, currently ${rotation} degrees`} className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
        <RotateCw className="w-4 h-4" />
      </button>

      {onDownload && (
        <>
          <span className={sep} aria-hidden="true" />
          <button onClick={() => downloadRef.current?.()} aria-label="Download this file" title="Download" className={`${ctrl} flex-shrink-0 whitespace-nowrap`}>
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
    ),
    // Only things the ROW actually renders. The handlers are stable
    // `useCallback`s and the two host callbacks are read through refs, so this
    // list is exactly "what makes the controls look different".
    [page, pageInput, pageCount, zoom, rotation, fullScreen, status, Boolean(onDownload)],
  );

  // Publish the controls to a parent header when asked. Registering on every
  // render (and clearing to null on unmount) is what lets the parent show them
  // only while this viewer is mounted, i.e. only for a PDF view.
  //
  // Keyed on the MEMOIZED toolbar, so this fires on mount, on real control
  // changes, and on unmount — never in a loop.
  useEffect(() => {
    if (!publishRef.current) return;
    publishRef.current(toolbar);
    return () => publishRef.current?.(null);
  }, [toolbar]);

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
          className="flex-shrink-0 w-full bg-bg-surface text-content-primary border-b border-border overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
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
        //
        // The padding stays CONSTANT at every zoom, and that is correct rather
        // than an oversight: it sits OUTSIDE the content element, so the anchor
        // subtracts it before scaling the content and adds the same value back
        // afterwards. The two cancel exactly, and scaling it would only make the
        // gutter grow for no reason. The GAP is the opposite case — it lives
        // INSIDE the content, so it has to scale with the pages or the surface
        // is not uniformly scaled and the anchor drifts by page index.
        // `overflow-x-auto` (not `hidden`): a page zoomed past Fit is wider
        // than the pane, and the native scrollbars are what make that overflow
        // reachable. Clipping it hid the outer columns of the page entirely.
        // `[scroll-snap-type:none]` and `![overflow-anchor:none]` are both
        // load-bearing here. The browser's scroll anchoring adjusts scrollTop on
        // its own when content above the viewport changes size — which is
        // exactly what a zoom does — and it can fight the focal-point
        // correction, producing a visible snap-back. The `!` PREFIX is Tailwind
        // v3's important modifier: the utility alone only wins on equal
        // specificity, so any other `overflow-anchor` rule would override it.
        // (The v4 suffix form `[…]!` silently emits no `!important` here.)
        className="relative flex-1 min-h-[320px] min-w-0 w-full overflow-y-auto overflow-x-auto overscroll-contain bg-bg-elevated/40 outline-none p-4 [scroll-snap-type:none] ![overflow-anchor:none]"
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
        style={{
          maxHeight: variant === 'standalone' || fullScreen ? undefined : 'min(72vh, 720px)',
          // `pan-x pan-y` keeps ONE-finger panning native and smooth while
          // denying the browser its own pinch-zoom over this surface, so it can
          // no longer fight our two-finger zoom. Scoped to the viewer only — the
          // rest of the app keeps pinch-to-zoom.
          touchAction: VIEWER_TOUCH_ACTION,
        }}
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
          <div
            ref={contentRef}
            className="relative w-full will-change-transform"
            // `minWidth` grows the surface to the widest page so a page zoomed
            // past Fit is fully reachable with the native scrollbars. The width
            // alone must come from the LAYOUT (the same measurement as the
            // height) — sizing the canvas in JSX with only a height, while the
            // width was set imperatively, is what let the two disagree and
            // stretch the page.
            //
            // `will-change: transform` promotes the stack to its own compositor
            // layer so the gesture-time `scale()` is applied off the main thread.
            style={{ height: `${totalHeight}px`, minWidth: `${contentWidth}px` }}
          >
            {renderWindow.map((n) => {
              const entry = layout[n - 1];
              if (!entry) return null;
              return (
                <div
                  key={n}
                  ref={setPageEl(n)}
                  // `relative` so the text layer and the snippet overlay can be
                  // positioned over this canvas rather than over the whole
                  // document stack.
                  className="absolute inset-x-0 flex justify-center px-0"
                  style={{ top: `${entry.top}px` }}
                >
                  {/* The page needs a positioned box for its overlays. It is
                      exactly the canvas's displayed size, which is what lets the
                      snippet layer's CSS-pixel coordinates match the canvas. */}
                  <div className="relative shrink-0" style={{ width: `${entry.width}px`, height: `${entry.height}px` }}>
                    <canvas
                      ref={setCanvas(n)}
                      className="block rounded-lg bg-white shadow-sm shrink-0"
                      // Width and height together, from one measurement. The
                      // canvas keeps its intrinsic aspect ratio at every zoom
                      // level; it is never squeezed by max-width and never
                      // stretched to fill its band.
                      style={{ width: `${entry.width}px`, height: `${entry.height}px` }}
                      // The canvas is the bitmap. The text layer beside it is the
                      // readable copy, so the canvas is hidden from assistive
                      // tech rather than both being announced.
                      aria-hidden="true"
                    />
                    {/* Read through `.current` on purpose: `textLayerGen` is bumped
                          every time a page records a new viewport, and that state
                          change is what re-renders this subtree. Reading the refs
                          directly keeps the render pipeline from depending on
                          them. */}
                    <PdfTextLayer
                      page={pageProxies.current.get(n) ?? null}
                      viewport={pageViewports.current.get(n) ?? null}
                      createLayer={createTextLayer}
                      rotation={rotation}
                      generation={textLayerGen}
                      snippetOn={snippetOn}
                    />
                    {n === snippetPage && (
                      <PdfSnippetLayer
                        canvas={canvasRefs.current.get(n) ?? null}
                        active
                        onCrop={onSnippetCrop}
                      />
                    )}
                  </div>
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