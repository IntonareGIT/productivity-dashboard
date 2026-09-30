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

/** TEMPORARY pinch instrumentation. Remove with the rest of the [zoomdbg] set. */
const ZOOM_DEBUG = true;

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
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    if (ZOOM_DEBUG) {
      console.log('[zoomdbg] commit-step', JSON.stringify({
        step: 4, name: 'force-layout', t: +nowMs.toFixed(2),
      }));
    }
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
    if (ZOOM_DEBUG) {
      console.log('[zoomdbg] commit-step', JSON.stringify({
        step: 5, name: 'write-scroll', t: +nowMs.toFixed(2),
        want: { l: wantLeft, t: wantTop },
        actual: actualNow,
        clampedByBrowser: clampedL || clampedT,
        // Non-zero here is a BUG, not a normal edge case: the surface must be at
        // its committed size before this write.
        severity: clampedL || clampedT ? 'ERROR' : 'ok',
      }));
    }

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
        if (ZOOM_DEBUG) {
          console.log('[zoomdbg] write-retry', JSON.stringify({
            t: +nowMs.toFixed(2),
            want: { l: wantLeft, t: wantTop },
            actual: { l: el.scrollLeft, t: el.scrollTop },
            recovered: Math.abs(el.scrollLeft - wantLeft) <= 0.5 && Math.abs(el.scrollTop - wantTop) <= 0.5,
            extent: { w: el.scrollWidth, h: el.scrollHeight },
          }));
        }
      });
    }

    // The browser clamps an out-of-range assignment, and at commit time the
    // content may be momentarily smaller than the target offset implies (the new
    // wrapper sizes land in the same commit, but a page still awaiting its
    // canvas render can briefly report the old band). Re-assert ONCE on the next
    // frame, and only if the value actually differs — a second write is
    // invisible when it is a no-op, and is the difference between landing on the
    // focal point and landing near it.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (el.scrollLeft !== wantLeft || el.scrollTop !== wantTop) {
          el.style.scrollBehavior = 'auto';
          el.scrollLeft = wantLeft;
          el.scrollTop = wantTop;
          el.style.scrollBehavior = previous;
          writeRef.current = { l: el.scrollLeft, t: el.scrollTop };
        }
      });
    }

    // TEMPORARY pinch instrumentation. Remove with the rest of the [zoomdbg] set.
    if (ZOOM_DEBUG) {
      const now = { l: el.scrollLeft, t: el.scrollTop };
      console.log('[zoomdbg] write', JSON.stringify({
        ratioX,
        ratioY,
        fixedOld: a.fixedOld,
        fixedNew,
        want: { l: wantLeft, t: wantTop },
        actual: now,
        clampedByBrowser: Math.abs(now.l - wantLeft) > 0.5 || Math.abs(now.t - wantTop) > 0.5,
        extentAfter: { w: el.scrollWidth, h: el.scrollHeight },
      }));
      requestAnimationFrame(() => {
        console.log('[zoomdbg] next-frame', JSON.stringify({
          scroll: { l: el.scrollLeft, t: el.scrollTop },
          movedSinceWrite: Math.abs(el.scrollLeft - now.l) > 0.5 || Math.abs(el.scrollTop - now.t) > 0.5,
          extent: { w: el.scrollWidth, h: el.scrollHeight },
        }));
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
