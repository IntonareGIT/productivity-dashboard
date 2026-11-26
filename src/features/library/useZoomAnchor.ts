import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * One-shot focal-point scroll restoration, shared by PdfViewer and ImageViewer.
 *
 * The rule this exists to enforce: the restore runs EXACTLY ONCE per zoom
 * action. Earlier revisions re-applied it on every layout change, and because
 * both viewers rebuilt their page `layout` on every render, the effect fired
 * constantly — the view fought itself and read as snapping or a locked
 * scrollbar. It also depended on scroll state and on the scroll handler, so a
 * user scroll could re-trigger it.
 *
 * How it works:
 *  - `capture()` is called at the instant the zoom is requested, and only ONCE
 *    per gesture — later calls are ignored, so a debounced commit cannot
 *    re-capture against a scroll position that has since moved.
 *  - The scale is MEASURED from the new scroll extents rather than taken from
 *    the request, so clamping, rounding and the devicePixelRatio budget cannot
 *    desynchronise it.
 *  - The focal point is mapped into CONTENT space, scaled, and mapped back.
 *    This is what makes the fixed chrome cancel; anchoring on a fraction of the
 *    raw scroll size instead is what left the view near — but not on — the
 *    cursor.
 *  - The layout effect applies it once after the new geometry is committed and
 *    clears the ref BEFORE writing, so a re-render cannot apply it twice.
 *  - It does not read scroll position, does not listen for scroll events, and
 *    is not driven by them.
 */
export interface FocalAnchor {
  /** Where the focal point sat in the viewport, in CSS pixels. */
  cx: number;
  cy: number;
  /** The non-scaling chrome at capture time. */
  fixedOld: { leadX: number; leadY: number; totalX: number; totalY: number };
  /** Scroll position at capture time. Unaffected by any transform. */
  scrollLeft: number;
  scrollTop: number;
  /**
   * Scrollable extents at capture time. Only captured when no transform is
   * applied; see `ratio`.
   */
  scrollW?: number;
  scrollH?: number;
  /**
   * The scale ratio to apply, when the caller knows it ANALYTICALLY.
   *
   * The gesture path supplies this, because its extents cannot be measured at
   * capture time: the preview transform is still applied, and a CSS transform
   * grows the scrollable overflow area, so `scrollWidth`/`scrollHeight` read
   * there are inflated by the live preview rather than describing the committed
   * layout. Deriving the ratio from those readings made the committed zoom land
   * near — but not on — the focal point, which is the post-pinch jump.
   *
   * When absent (the button path), the ratio is measured after the preview is
   * dropped and layout is flushed.
   */
  ratio?: number;
}

export interface ZoomAnchor {
  /** Arm the anchor. Call this BEFORE changing the zoom state. */
  capture: (el: HTMLElement, clientX?: number, clientY?: number, ratio?: number) => void;
  /** Drop any armed anchor, e.g. when a user scroll takes over. */
  cancel: () => void;
  /** True while an anchor is armed. Read inside a ref, never in render. */
  isArmed: () => boolean;
  /**
   * The last position this hook asked for, or null.
   *
   * A scroll assignment fires a real `scroll` event that is indistinguishable
   * from a user drag. The consumer compares against this to recognise its own
   * echo. The hook owns it because the hook owns the write — a separate
   * bookkeeping ref in each viewer is exactly how the two drifted apart and how
   * the record ended up never being written at all.
   */
  lastWrite: () => { l: number; t: number } | null;
  /** Forget the last write, once its echo has arrived or been judged a user drag. */
  clearWrite: () => void;
}

/**
 * Shared zoom-gesture maths for the PDF and image viewers.
 *
 * Both viewers implement the same trackpad/wheel pinch. The rules encoded here
 * are the ones that are easy to get subtly wrong, and both viewers must obey
 * them identically or they drift apart:
 *
 *  - ONE running gesture scale, advanced multiplicatively per event. The
 *    committed zoom is folded in exactly once, at commit. Mixing a ratio and an
 *    absolute zoom on alternating lines makes every tick compound the previous
 *    one: a comfortable pinch ran away past 200x.
 *  - Deltas are normalised by deltaMode before use, so line- and page-mode
 *    wheels are not treated as pixels.
 *  - A per-event delta ceiling stops one spurious event slamming the limit.
 *  - The preview transform IS the ratio, because the committed layout is already
 *    on screen and the preview scales on top of it.
 */

/** Pixels per wheel "line" (deltaMode 1). */
const LINE_HEIGHT_PX = 16;
/** Pixels per wheel "page" (deltaMode 2). */
const PAGE_HEIGHT_PX = 100;

/**
 * Per-event delta ceiling, applied AFTER unit normalisation.
 *
 * A single spurious event — a fling, a trackpad hiccup, an OS momentum event —
 * can report deltaY in the hundreds. Unbounded, one such event slams the zoom to
 * a limit and the gesture cannot be recovered.
 */
export const MAX_EVENT_DELTA = 40;

/**
 * Normalised delta at or above this counts as a coarse, discrete step.
 *
 * A trackpad pinch emits deltas of a few units; a mouse reports 100, or 3 lines,
 * or 1 page. 20 separates them without hard-coding a device.
 */
export const COARSE_DELTA = 20;

/**
 * Wheel/pinch sensitivity: the `k` in `gestureScale *= exp(-deltaY * k)`.
 *
 * Tuned against a comfortable two-finger trackpad pinch, which emits a burst of
 * small deltas totalling roughly 120-150 units. Those never reach the per-event
 * clamp, so at this k the gesture spans roughly 1x -> 3.5x -> 4.5x.
 *
 * Exponentiating (rather than adding) makes a gesture multiplicative and
 * order-independent: N events totalling d give exp(-k*d) however they are
 * grouped, so a burst of tiny deltas and one large delta of the same total
 * produce the same result.
 */
export const PINCH_K = 0.01;

/**
 * Sensitivity for coarse, discrete events — a mouse wheel notch, or a
 * line/page-mode event.
 *
 * A coarse event is always clamped to MAX_EVENT_DELTA, so one notch is
 * `exp(-40 * PINCH_K_FINE)` = 0.909: a ~9% step, the small repeatable increment
 * a mouse ctrl+wheel zoom should have. A trackpad never reaches the clamp and so
 * keeps the full PINCH_K.
 */
export const PINCH_K_FINE = 0.0024;

/**
 * Convert a wheel event's deltaY into pixel-equivalent units and cap it.
 *
 * deltaMode is easy to miss: a line-mode event reports deltaY = 3 for a single
 * notch and a page-mode event reports 1. Treating those as pixels makes the
 * gesture drastically too slow on one browser and correct on another.
 */
export const normalizeWheelDelta = (deltaY: number, deltaMode: number): number => {
  const unit = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1;
  const px = deltaY * unit;
  return Math.max(-MAX_EVENT_DELTA, Math.min(MAX_EVENT_DELTA, px));
};

/**
 * Advance ONE running gesture scale by a single wheel event.
 *
 * `gestureScale` is a RATIO to the zoom committed when the gesture began. The
 * committed zoom is deliberately NOT an input: folding it in here and dividing
 * it out again at commit is what made the two compound.
 */
export const advanceGestureScale = (gestureScale: number, deltaY: number, deltaMode: number): number => {
  const delta = normalizeWheelDelta(deltaY, deltaMode);
  const k = Math.abs(delta) >= COARSE_DELTA ? PINCH_K_FINE : PINCH_K;
  return gestureScale * Math.exp(-delta * k);
};

/** The sensitivity actually chosen for an event, exposed for tuning/tests. */
export const pinchSensitivityFor = (deltaY: number, deltaMode: number): number => {
  const delta = normalizeWheelDelta(deltaY, deltaMode);
  return Math.abs(delta) >= COARSE_DELTA ? PINCH_K_FINE : PINCH_K;
};

/**
 * Two-finger touch pinch, shared by the PDF and image viewers.
 *
 * This is EVENT PLUMBING ONLY. The zoom itself is entirely delegated to
 * `applyLive` / `commitLive`, which are the same functions the trackpad pinch
 * uses — so there is exactly ONE zoom implementation, and a two-finger pinch gets
 * the identical live-transform preview, focal point, analytic-ratio commit and
 * render-then-swap hand-off. No second zoom maths exists anywhere.
 *
 * The scale is the distance between the two touches relative to the distance at
 * gesture start, and the focal point is their midpoint.
 */
export interface TouchZoomHandlers {
  /** Attach to the viewer's scroll container. */
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchCancel: (e: TouchEvent) => void;
  /** iOS-only; see below. */
  onGestureStart: (e: Event) => void;
  onGestureChange: (e: Event) => void;
  onGestureEnd: (e: Event) => void;
}

interface Options {
  /** The scroll container the listeners are attached to. */
  el: HTMLElement | null;
  /** Preview a step. Receives a RATIO to the committed zoom. */
  applyLive: (ratio: number, clientX: number, clientY: number) => void;
  /** Fold the live scale into real layout. */
  commitLive: () => void;
}

export const useTouchZoomHandlers = ({ el, applyLive, commitLive }: Options): TouchZoomHandlers => {
  // Baseline distance for the CURRENT gesture. Zero means "no pinch in
  // progress", which is what stops a later one-finger pan from being measured
  // against a stale baseline.
  const startDistRef = { current: 0 };
  // iOS fires BOTH the touch events and its own gesture events for a pinch.
  // Once the gesture events have taken over, the touch path must stand down or
  // the two zoom at once and visibly fight.
  const iOSGestureRef = { current: false };
  // Last two-finger midpoint, reused as the focal point by the iOS gesture path,
  // which carries no coordinates of its own.
  const lastMidRef = { current: { x: 0, y: 0 } };

  const dist = (t: TouchList) => {
    const [a, b] = [t[0], t[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const mid = (t: TouchList) => ({
    x: (t[0].clientX + t[1].clientX) / 2,
    y: (t[0].clientY + t[1].clientY) / 2,
  });

  /** End the gesture exactly once, whichever way it ended. */
  const end = (_why: string) => {
    if (startDistRef.current === 0) return;
    startDistRef.current = 0;
    commitLive();
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const d = dist(e.touches);
    if (d <= 0) return;
    startDistRef.current = d;
    lastMidRef.current = mid(e.touches);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (iOSGestureRef.current) return;              // the iOS path owns this gesture
    if (e.touches.length !== 2) return;
    // Claimed ONLY while two touches are down, so one-finger panning stays
    // native and smooth. The listener itself is non-passive (see below) because
    // preventDefault is ignored on a passive one.
    e.preventDefault();
    if (startDistRef.current <= 0) {
      // Two fingers arrived without a touchstart we saw (possible when the first
      // finger landed before the element existed). Re-baseline rather than
      // measuring against a stale zero.
      const d = dist(e.touches);
      if (d <= 0) return;
      startDistRef.current = d;
    }
    const c = mid(e.touches);
    lastMidRef.current = c;
    applyLive(dist(e.touches) / startDistRef.current, c.x, c.y);
  };

  const onTouchEnd = (e: TouchEvent) => {
    // A finger lifted: the pinch is over, whatever the remaining count is.
    // Committing here (rather than waiting for zero) is what stops the view
    // jumping when the user releases both fingers a frame apart.
    if (startDistRef.current > 0) end(`touches:${e.touches.length}`);
  };
  const onTouchCancel = (e: TouchEvent) => {
    if (startDistRef.current > 0) end(`cancel:${e.touches.length}`);
  };

  // ---- iOS Safari ------------------------------------------------------
  // iOS fires its own pinch events and can still zoom the PAGE with them, even
  // when touchmove is prevented. They carry a scale rather than coordinates, so
  // the focal point is the last two-finger midpoint we saw.
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    iOSGestureRef.current = true;
    if (!el) return;
    lastMidRef.current = {
      x: el.getBoundingClientRect().left + el.clientWidth / 2,
      y: el.getBoundingClientRect().top + el.clientHeight / 2,
    };
    startDistRef.current = 1;   // non-zero => the gesture is live
  };

  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (!iOSGestureRef.current) return;
    const scale = (e as unknown as { scale: number }).scale;
    if (!Number.isFinite(scale) || scale <= 0) return;
    applyLive(scale, lastMidRef.current.x, lastMidRef.current.y);
  };

  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    iOSGestureRef.current = false;
    end('ios-gesture');
  };

  return {
    onTouchStart, onTouchMove, onTouchEnd, onTouchCancel,
    onGestureStart, onGestureChange, onGestureEnd,
  };
};

/**
 * `touch-action` for a viewer's scroll container.
 *
 * `pan-x pan-y` grants native panning in both directions — so ONE-finger
 * scrolling of the document stays native and smooth — while implicitly denying
 * `pinch-zoom` and `double-tap-zoom`. That is what stops the browser from
 * running its own page zoom alongside ours. Applied ONLY to the viewer surface,
 * never to the app: the rest of the dashboard keeps pinch-to-zoom.
 */
export const VIEWER_TOUCH_ACTION = 'pan-x pan-y';

export function useZoomAnchor(
  elRef: RefObject<HTMLElement | null>,
  /** Re-run the effect when the content geometry changes (e.g. the layout). */
  layout: unknown,
  zoom: number,
  /**
   * The non-scaling chrome on each axis, resolved at a SPECIFIC zoom.
   *
   * It takes the zoom as an argument because the PDF viewer scales its gap and
   * padding WITH the zoom, so the chrome is a function of the zoom rather than a
   * constant. Returning one value for the whole gesture was what made the anchor
   * drift by roughly `pageIndex * PAGE_GAP * (ratio - 1)` — the gaps were being
   * scaled by the ratio while the padding subtracted from the focal point was
   * not.
   *
   *  - `lead` is the padding BEFORE the content: it separates a viewport
   *    coordinate from a content coordinate.
   *  - `total` is EVERY constant term on the axis, used to derive a measured
   *    ratio. It is ignored when the caller supplies an analytic ratio.
   */
  getFixed: (el: HTMLElement, atZoom: number) => { leadX: number; leadY: number; totalX: number; totalY: number },
  /**
   * Run inside this effect, before the scroll write, in the same commit.
   *
   * The viewer uses it to retire the gesture preview and move finished bitmaps
   * onto the visible canvases, so the transform removal, the wrapper resize, the
   * canvas swap, the forced layout and the scroll write all land in ONE
   * synchronous block before paint. Doing the swap from a separate effect meant
   * the wrappers were already at the new size while the canvases still held old
   * or cleared bitmaps, which is the remaining flash.
   */
  beforeWrite?: (el: HTMLElement) => void,
  /**
   * Called after the scroll write with what was asked for and what actually
   * landed. Used to surface a clamp, which means the scroll surface was not at
   * its final size when the write happened.
   */
  onWritten?: (info: {
    want: { l: number; t: number };
    actual: { l: number; t: number };
    extent: { w: number; h: number };
  }) => void,
): ZoomAnchor {
  const anchorRef = useRef<FocalAnchor | null>(null);
  const writeRef = useRef<{ l: number; t: number } | null>(null);

  const capture = useCallback((el: HTMLElement, clientX?: number, clientY?: number, ratio?: number) => {
    if (anchorRef.current) return; // already armed for this gesture
    const rect = el.getBoundingClientRect();
    const cx = clientX === undefined ? el.clientWidth / 2 : clientX - rect.left;
    const cy = clientY === undefined ? el.clientHeight / 2 : clientY - rect.top;
    anchorRef.current = {
      cx,
      cy,
      fixedOld: getFixed(el, zoom),
      // Scroll OFFSET is not affected by a transform, so these are safe to read
      // even while the preview is applied.
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      // Extents are only trustworthy when NO transform is applied. The button
      // path has none, so it captures them here and the effect derives the ratio
      // from them. The gesture path passes an analytic `ratio` instead, precisely
      // because its extents are inflated by the live preview.
      ...(ratio === undefined
        ? { scrollW: Math.max(1, el.scrollWidth), scrollH: Math.max(1, el.scrollHeight) }
        : {}),
      ratio,
    };
  }, [getFixed, zoom]);

  const cancel = useCallback(() => { anchorRef.current = null; }, []);
  const isArmed = useCallback(() => anchorRef.current !== null, []);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const el = elRef.current;
    if (!el) return;
    // ONE SHOT. Clearing first means a re-render — or a write that throws —
    // cannot apply the same anchor twice.
    anchorRef.current = null;

    const fixedNew = getFixed(el, zoom);

    // One synchronous block, before paint, in this order:
    //   1. the caller retires the preview transform and swaps in finished
    //      bitmaps (see `beforeWrite`);
    //   2. force a synchronous layout — reading offsetHeight flushes pending
    //      style and layout, so the extents below reflect the NEW geometry;
    //   3. measure;
    //   4. write the scroll.
    // There is no await and no rAF anywhere in here, so the browser cannot paint
    // an intermediate state — not a blank canvas, and not a half-resized stack.
    beforeWrite?.(el);
    void el.offsetHeight;

    const sw = Math.max(1, el.scrollWidth);
    const sh = Math.max(1, el.scrollHeight);

    // The scale to apply. When the caller knows it analytically — the gesture
    // path, which cannot measure its extents at capture time — that value wins,
    // because it is the scale actually committed. Otherwise it is measured from
    // the now-clean extents, which folds in clamping, rounding and the
    // devicePixelRatio budget.
    const ratioX = a.ratio ?? ((sw - fixedNew.totalX) / Math.max(1, (a.scrollW ?? sw) - a.fixedOld.totalX));
    const ratioY = a.ratio ?? ((sh - fixedNew.totalY) / Math.max(1, (a.scrollH ?? sh) - a.fixedOld.totalY));

    // Map the focal point into content space, scale it, then map it back.
    // Working in content space is what makes the constant chrome cancel: a
    // fraction of the raw scroll size would instead be dragged toward the
    // padding and gaps, leaving the view near — but not on — the cursor.
    const contentX = a.scrollLeft + a.cx - a.fixedOld.leadX;
    const contentY = a.scrollTop + a.cy - a.fixedOld.leadY;
    const wantLeft = contentX * ratioX + fixedNew.leadX - a.cx;
    const wantTop = contentY * ratioY + fixedNew.leadY - a.cy;

    // Force an instant write: `scroll-behavior: smooth` (ours, inherited, or
    // added by a theme later) would animate the assignment and fight the next
    // frame.
    //
    // Record the position the write ACTUALLY landed on, not the one we asked
    // for. The browser clamps an out-of-range assignment (zooming out near the
    // top of a short document, or a zoom that shrank the content), and if the
    // echo were matched against the requested value it would miss by more than
    // the tolerance — so the view would treat its own write as a user drag and
    // cancel the anchor.
    const previous = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = wantLeft;
    el.scrollTop = wantTop;
    el.style.scrollBehavior = previous;
    writeRef.current = { l: el.scrollLeft, t: el.scrollTop };

    // (2) Verify the write actually landed. A clamp here means the scroll surface
    // was not at its final size when we wrote — the layout was stale, and the
    // whole point of the commit block is that it is not. Reported, not hidden.
    const actualNow = { l: el.scrollLeft, t: el.scrollTop };
    const clampedL = Math.abs(actualNow.l - wantLeft) > 0.5;
    const clampedT = Math.abs(actualNow.t - wantTop) > 0.5;
    onWritten?.({
      want: { l: wantLeft, t: wantTop },
      actual: actualNow,
      extent: { w: el.scrollWidth, h: el.scrollHeight },
    });

    // Retry once on the next frame if the browser clamped. If the layout was
    // genuinely final this is a no-op; if it was not, the surface has since
    // grown and the write can now land.
    if ((clampedL || clampedT) && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (el.scrollLeft === wantLeft && el.scrollTop === wantTop) return;
        const prev2 = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = wantLeft;
        el.scrollTop = wantTop;
        el.style.scrollBehavior = prev2;
        writeRef.current = { l: el.scrollLeft, t: el.scrollTop };
      });
    }
  }, [elRef, layout, zoom, getFixed, beforeWrite, onWritten]);

  return {
    capture,
    cancel,
    isArmed,
    lastWrite: useCallback(() => writeRef.current, []),
    clearWrite: useCallback(() => { writeRef.current = null; }, []),
  };
}
