import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Maximize, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useZoomAnchor, advanceGestureScale } from '../useZoomAnchor';

/**
 * Shared image viewer with a full control row.
 *
 * ONE component, used by BOTH the Library modal and a split pane (through
 * `ResourceViewer`), so zoom/rotate/fit behave identically in each. The control
 * row follows the same contract as `PdfViewer`: it is rendered once and either
 * drawn in place (no parent header) or published up to the parent header, so a
 * pane never grows a second toolbar.
 *
 * The image is NEVER sized with `width: 100%` / `height: 100%`. Both CSS
 * dimensions are always computed together from the intrinsic aspect ratio, so
 * the picture cannot stretch on a resize, a pane drag, or a zoom change.
 */
interface ImageViewerProps {
  src: string;
  alt: string;
  /** Omitted when there is no blob to download. */
  onDownload?: () => void;
  /** Publish the control row to a parent header instead of drawing it here. */
  onRegisterControls?: (node: React.ReactNode) => void;
  onError?: () => void;
}

/**
 * Zoom bounds. 1 = fit to the container, matching the PDF viewer's scale model.
 * 0.5–5 covers "shrink to see the whole picture in a small pane" through to a
 * deep crop of a high-resolution image, without letting a stray pinch fling the
 * picture off screen.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;
/** Padding around the image inside the scroll surface (matches `p-2`). */
const IMAGE_PAD = 8;

/**
 * Clamp and round a zoom target to exactly what will be stored.
 *
 * The SINGLE definition of "the zoom a target resolves to", shared by the live
 * gesture preview and the commit. Two definitions is how the preview and the
 * commit came to disagree — the preview clamped to [0.05, 20] at full precision
 * while the commit clamped to [MIN_ZOOM, MAX_ZOOM] and rounded, so what the user
 * saw mid-pinch was never what got stored.
 */
const quantizeZoom = (z: number): number | null => {
  if (!Number.isFinite(z) || z <= 0) return null;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +z.toFixed(4)));
};

/** Token-driven so the controls follow the active theme in both hosts. */
const ctrl =
  'inline-flex items-center justify-center gap-1 px-2 min-h-[30px] rounded-lg border border-border-strong bg-bg-elevated text-content-primary text-[11px] font-semibold hover:bg-bg-surface transition-colors shrink-0 whitespace-nowrap';

export const ImageViewer: React.FC<ImageViewerProps> = ({
  src, alt, onDownload, onRegisterControls, onError,
}) => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 720, h: 480 });
  // Intrinsic pixel size, captured on load. "1:1" is meaningless without it.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  // Mirrors `zoom` so the native (non-React) gesture listeners can read the
  // current scale without being re-bound on every wheel/touch event.
  const zoomRef = useRef(zoom);
  /**
   * The point to hold fixed across a zoom, in image-local CSS pixels, plus the
   * viewport position it should stay under. Captured when the gesture starts
   * and applied once the new size has been laid out.
   */
  /**
   * True only while a zoom-driven scroll write is in flight, so the scroll
   * listener can tell our own assignment apart from a user drag. The shared
   * hook owns the write itself.
   */
  const isZoomingRef = useRef(false);
  /**
   * The wrapper the GPU transform is applied to during a gesture.
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /**
   * LIVE gesture scale, applied as a CSS transform and never as React state.
   *
   * Writing `transform` touches only the compositor, so a pinch stays at 60fps
   * with no layout, no reflow and no re-render. Re-rendering per `wheel` event
   * would re-run `shown` -> new image box -> new scroll geometry on the main
   * thread, which is exactly the hitch this avoids. The value is folded into
   * real `zoom` state only once the gesture settles.
   */
  const liveScaleRef = useRef(1);
  const commitTimerRef = useRef<number | null>(null);
  /**
   * Focal point of the gesture, captured ONCE at the first tick.
   *
   * Overwriting it every tick made the commit re-anchor wherever the cursor
   * happened to be at release rather than where the gesture began, so the
   * preview and the commit disagreed about which point was pinned.
   */
  const focalRef = useRef<{ x: number; y: number } | null>(null);
  /** True between the first tick of a gesture and its commit. */
  const gestureRef = useRef(false);
  /**
   * The committed zoom captured when this gesture began, held fixed for its
   * duration. Stored rather than re-derived — re-deriving it is what let every
   * tick compound the previous one.
   */
  const gestureStartZoomRef = useRef(1);

  // Track the available box so "Fit" has something to fit INTO.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A different image starts from a clean fit.
  useEffect(() => {
    setNatural(null);
    setZoom(1);
    setRotation(0);
  }, [src]);
  zoomRef.current = zoom;

  /** The size that fills the container while keeping the intrinsic ratio. */
  const fit = useMemo(() => {
    if (!natural) return { w: box.w, h: box.h };
    const scale = Math.min(box.w / natural.w, box.h / natural.h, 1);
    return { w: Math.max(1, Math.floor(natural.w * scale)), h: Math.max(1, Math.floor(natural.h * scale)) };
  }, [natural, box]);

  /**
   * Final CSS box. Width and height are derived together from ONE scale, so the
   * ratio is preserved by construction. Rotation swaps the axes before the scale
   * is applied, so a 90-degree turn cannot shear the picture.
   */
  const shown = useMemo(() => {
    const rotated = rotation % 180 !== 0;
    const base = zoom === 1 ? fit : {
      w: Math.max(1, Math.floor((natural?.w ?? fit.w) * zoom)),
      h: Math.max(1, Math.floor((natural?.h ?? fit.h) * zoom)),
    };
    return rotated ? { w: base.h, h: base.w } : base;
  }, [fit, natural, zoom, rotation]);

  // The image surface carries only its own padding; there are no inter-item gaps,
  // so the fixed part is small and symmetric.
  const getFixed = useCallback(
    () => ({ leadX: IMAGE_PAD, leadY: IMAGE_PAD, totalX: IMAGE_PAD * 2, totalY: IMAGE_PAD * 2 }),
    [],
  );

  // The focal-point restore is the SAME shared hook the PDF viewer uses, so the
  // two cannot drift apart in how they behave after a zoom.
  const zoomAnchor = useZoomAnchor(shellRef, shown, zoom, getFixed, () => {
    // Drop the gesture preview in the same commit as the scroll write, so no
    // frame is ever painted at the unzoomed scale.
    const el = contentRef.current;
    if (el) el.style.transform = '';
  });

  // Where the image sits inside the scrollable content. The content box is at
  // least the viewport (so a small image is centred) and grows to the image
  // (so a zoomed one can be scrolled over), with the same padding the wrapper
  // applies. Both are needed to turn a cursor position into an image-local one.
  const contentBox = useMemo(() => ({
    w: Math.max(box.w, shown.w + IMAGE_PAD * 2),
    h: Math.max(box.h, shown.h + IMAGE_PAD * 2),
  }), [box, shown]);
  const imageOffset = useMemo(() => ({
    x: (contentBox.w - shown.w) / 2,
    y: (contentBox.h - shown.h) / 2,
  }), [contentBox, shown]);

  /**
   * Zoom to `next`, keeping the point under (`clientX`,`clientY`) — or the
   * viewport centre when no point is given — pinned in place.
   *
   * The anchor is stored in IMAGE-LOCAL pixels so it stays meaningful when the
   * image is re-centred by a resize, and the ratio comes from the CLAMPED
   * target so a gesture that runs into a zoom limit does not try to restore an
   * offset for a scale that never happened.
   */
  const applyZoom = useCallback((next: number, clientX?: number, clientY?: number) => {
    // The SAME quantizer the gesture preview uses.
    const clamped = quantizeZoom(next);
    if (clamped === null) return;
    const prev = zoomRef.current;
    const el = shellRef.current;
    if (el && clamped !== prev && prev > 0) {
      const rect = el.getBoundingClientRect();
      // Fall back to the viewport centre for button/keyboard zooms.
      const cx = clientX === undefined ? el.clientWidth / 2 : clientX - rect.left;
      const cy = clientY === undefined ? el.clientHeight / 2 : clientY - rect.top;
      zoomAnchor.capture(el, clientX, clientY);
      isZoomingRef.current = true;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { isZoomingRef.current = false; });
      } else {
        setTimeout(() => { isZoomingRef.current = false; }, 0);
      }
    }
    setZoom(clamped);
  }, [zoomAnchor]);

  const changeZoom = useCallback((factor: number) => {
    applyZoom(zoomRef.current * factor);
  }, [applyZoom]);

  /**
   * Apply the captured anchor once the new size is laid out.
   *
   * A layout effect, so the correction lands in the same frame as the new image
   * box instead of after a visible jump. The anchor is only cleared once the
   * scroll write actually took: the surface can clamp an early write while the
   * image is still growing, and the next pass re-applies it. That terminates,
   * since the effect only runs when the geometry actually changes.
   */
  // The focal-point restore is performed by the shared `useZoomAnchor` hook
  // (declared above with `shown`), so this component no longer owns a second,
  // subtly different copy of the logic.

  /**
   * A zoom write echoes back as a real `scroll` event, and a user drag must
   * never be answered by the focal-point math. So: ignore our own echo, and if
   * the user has genuinely scrolled, drop any still-armed anchor instead of
   * re-applying it on the next layout pass — that fight is what reads as the
   * view snapping back under the user's finger.
   */
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isZoomingRef.current) return;
      const w = zoomAnchor.lastWrite();
      if (w && Math.abs(el.scrollLeft - w.l) <= 1 && Math.abs(el.scrollTop - w.t) <= 1) {
        zoomAnchor.clearWrite();
        return;
      }
      zoomAnchor.clearWrite();
      zoomAnchor.cancel();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ---- Live GPU-transform zoom during a gesture --------------------------
  // `applyLive` is the only thing a `wheel`/`touchmove` event calls. It mutates
  // one inline `transform` and returns: no setState, no layout read, no reflow.
  /**
   * Preview a gesture step. `nextRatio` is the new scale RELATIVE to the zoom
   * that was committed when this gesture started — the same contract the PDF
   * viewer uses, and the reason a pinch cannot run away here either.
   */
  const applyLive = useCallback((nextRatio: number, clientX: number, clientY: number) => {
    const el = contentRef.current;
    const shell = shellRef.current;
    if (!el || !shell) return;
    if (!Number.isFinite(nextRatio) || nextRatio <= 0) return;
    // Captured ONCE, at the first tick. Later ticks must not move it.
    if (!gestureRef.current) {
      gestureRef.current = true;
      // Pin the base for the whole gesture; the committed zoom cannot change
      // until the commit, so this is stable by construction.
      gestureStartZoomRef.current = zoomRef.current;
      focalRef.current = { x: clientX, y: clientY };
    }
    const focal = focalRef.current ?? { x: clientX, y: clientY };
    liveScaleRef.current = nextRatio;
    // The focal point expressed in the CONTENT element's own coordinates — the
    // same space the shared anchor reconstructs on commit, which is what makes
    // handing over to real layout seamless rather than a jump.
    //
    // `scrollTop` is measured from the shell's PADDING box, but the transform is
    // applied to the CONTENT element, whose origin sits `IMAGE_PAD` further in.
    // Skipping that correction offsets the live feedback from the cursor and
    // makes the correct anchor on commit look like a jump. This is the `lead`
    // half of `getFixed`.
    const rect = shell.getBoundingClientRect();
    const ox = shell.scrollLeft + (focal.x - rect.left) - IMAGE_PAD;
    const oy = shell.scrollTop + (focal.y - rect.top) - IMAGE_PAD;
    el.style.transformOrigin = `${ox}px ${oy}px`;
    el.style.transform = Math.abs(nextRatio - 1) < 0.0005 ? '' : `scale(${nextRatio})`;
  }, []);

  const clearLive = useCallback(() => {
    const el = contentRef.current;
    if (el) el.style.transform = '';
    liveScaleRef.current = 1;
  }, []);

  /** Fold the live scale into real state. Safe to call when nothing is live. */
  const commitLive = useCallback(() => {
    // The committed zoom is combined with the running ratio EXACTLY ONCE, here.
    const target = quantizeZoom(gestureStartZoomRef.current * liveScaleRef.current);
    const focal = focalRef.current;
    gestureRef.current = false;
    focalRef.current = null;
    // The next gesture starts from 1x RELATIVE to whatever is now committed, so
    // the running ratio never carries over.
    liveScaleRef.current = 1;
    gestureStartZoomRef.current = zoomRef.current;
    if (target === null || !focal || target === zoomRef.current) {
      // Nothing to commit — but the preview transform MUST still come off, or
      // the picture stays visually scaled with no state backing it.
      clearLive();
      return;
    }
    // The transform is NOT removed here. The shared hook's layout effect drops
    // the preview and writes the restored scroll position in the SAME commit,
    // before paint. Clearing it here would show a frame at the unzoomed scale.
    applyZoom(target, focal.x, focal.y);
  }, [applyZoom, clearLive]);

  /**
   * A trackpad pinch arrives as a `wheel` event with `ctrlKey` set; macOS
   * Cmd+wheel (and some trackpads) set `metaKey`. Both are claimed. Any other
   * wheel returns on the FIRST line, before any ref read, rect read or state
   * check, so native scrolling takes over with effectively zero overhead.
   */
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // `passive: false` is required — preventDefault on a wheel event is ignored
    // on a passive listener, and the browser page would still zoom behind the
    // viewer. It is attached to the ZOOM SURFACE and nowhere else.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Advance ONE running gesture scale by this event's delta alone, exactly
      // as the PDF viewer does. This used to ADD a linear delta to a value that
      // had the committed scale multiplied in, which both compounded per tick
      // and behaved differently from the PDF viewer's exponential response.
      applyLive(advanceGestureScale(liveScaleRef.current, e.deltaY, e.deltaMode), e.clientX, e.clientY);
      // Commit once the gesture pauses. A pinch on a trackpad is a burst of
      // events; committing on each one would re-render per event and reintroduce
      // the exact hitch the transform was meant to remove.
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

  // ---- Two-finger touch pinch -------------------------------------------
  // Tracked natively: React's synthetic touch events do not expose the distance
  // between two fingers, which is the whole measurement here. Also transform-
  // driven; the scale is committed on touchend.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    let startDist = 0;
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist <= 0) return;
      // Two fingers is a pinch, not a pan, so the browser's own page-zoom and
      // scrolling are suppressed for the duration of the gesture.
      e.preventDefault();
      const c = mid(e.touches);
      // Always measured against the ORIGINAL start distance. Re-deriving from
      // the live scale each move would compound frame over frame and run away.
      // This is already a RATIO to the committed zoom, which is what `applyLive`
      // expects — the committed zoom is not multiplied in here.
      applyLive(dist(e.touches) / startDist, c.x, c.y);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      startDist = 0;
      commitLive();
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
  }, [applyLive, commitLive]);

  // A new document must never inherit a transform or a pending commit.
  useEffect(() => {
    gestureRef.current = false;
    focalRef.current = null;
    liveScaleRef.current = 1;
    gestureStartZoomRef.current = 1;
    clearLive();
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, [src, clearLive]);

  const zoomPct = Math.round(zoom * 100);
  const ownsHeader = !onRegisterControls;

  // The control row is memoized so the parent can store it without re-publishing
  // a new element on every render, and the host callbacks are read through refs
  // so they never invalidate the memo.
  const publishRef = useRef(onRegisterControls);
  const downloadRef = useRef(onDownload);
  useEffect(() => {
    publishRef.current = onRegisterControls;
    downloadRef.current = onDownload;
  }, [onRegisterControls, onDownload]);

  const toolbar = useMemo(
    () => (
      <>
        <button onClick={() => changeZoom(1 / ZOOM_STEP)} className={ctrl} aria-label="Zoom out" title="Zoom out">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="px-1 min-w-[3rem] text-center text-[11px] font-semibold text-content-secondary tabular-nums">
          {zoomPct}%
        </span>
        <button onClick={() => changeZoom(ZOOM_STEP)} className={ctrl} aria-label="Zoom in" title="Zoom in">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        {/* Fit and 1:1 go through applyZoom like every other zoom, so they anchor
            on the viewport centre too — a bare setZoom would drop the view back
            to the top-left of the image. */}
        <button onClick={() => applyZoom(1)} className={ctrl} aria-label="Fit to container" title="Fit to container">
          <Maximize className="w-3.5 h-3.5" /> Fit
        </button>
        <button
          onClick={() => applyZoom(natural && fit.w ? fit.w / natural.w : 1)}
          className={ctrl}
          aria-label="Reset zoom to actual size"
          title="Actual size (1:1)"
        >
          1:1
        </button>
        <button
          onClick={() => setRotation((r) => (r + 90) % 360)}
          className={ctrl}
          aria-label="Rotate 90 degrees"
          title="Rotate"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        {onDownload && (
          <button
            onClick={() => downloadRef.current?.()}
            className={ctrl}
            aria-label="Download this image"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
      </>
    ),
    [changeZoom, applyZoom, zoomPct, fit.w, natural, Boolean(onDownload)],
  );

  useEffect(() => {
    if (!publishRef.current) return;
    publishRef.current(toolbar);
    return () => publishRef.current?.(null);
  }, [toolbar]);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 w-full gap-2">
      {ownsHeader && (
        <div
          className="flex-shrink-0 w-full bg-bg-surface text-content-primary border-b border-border overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          role="group"
          aria-label="Image controls"
        >
          <div className="h-11 px-3 flex items-center gap-1 min-w-max">{toolbar}</div>
        </div>
      )}

      {/* The scroll surface. `auto` on BOTH axes so a zoomed image overflows into
          native scrollbars instead of being clipped or squeezed to fit. */}
      <div
        ref={shellRef}
        // `[scroll-snap-type:none]` and `![overflow-anchor:none]` are both
        // load-bearing. The browser's scroll anchoring adjusts scrollTop on its
        // own whenever the content above the viewport changes size — precisely
        // what a zoom does — and it fights the focal-point correction, which
        // shows up as the image snapping back. The `!` PREFIX is Tailwind v3's
        // important modifier; the v4 suffix form emits no `!important` here.
        className="relative flex-1 min-h-[160px] min-w-0 w-full overflow-auto overscroll-contain bg-bg-elevated/40 outline-none rounded-xl border border-border [scroll-snap-type:none] ![overflow-anchor:none]"
      >
        {/* The GPU-transform target. `will-change: transform` promotes it to its
            own compositor layer for the duration of a gesture, so the scale is
            applied off the main thread. `transform-gpu` is a belt-and-braces
            hint; the inline transform written during the gesture is what
            actually does the work. */}
        <div
          ref={contentRef}
          className="min-h-full min-w-full flex items-center justify-center p-2 will-change-transform [transform:translateZ(0)]"
        >
          <img
            src={src}
            alt={alt}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setNatural({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }}
            onError={onError}
            // object-contain is the belt-and-braces guarantee that the picture is
            // never distorted; the explicit proportional box above is what makes
            // it exact at every zoom level.
            className="block object-contain shrink-0 select-none"
            style={{ width: `${shown.w}px`, height: `${shown.h}px` }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
};