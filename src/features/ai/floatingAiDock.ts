/**
 * Geometry for the docked floating AI bubble.
 *
 * Pure functions, no React and no DOM reads, so the placement rules can be
 * verified exhaustively. The component reads live rects and calls in here.
 *
 * The central idea is that keep-out zones are RECTANGLES MEASURED FROM THE LIVE
 * DOM, never fixed pixel guesses. Pane headers are 44px on some layouts and
 * clipped on others, the bottom tab bar only exists on mobile, and the floating
 * assistant panel is 65vh on desktop and a bottom sheet on a phone. Any constant
 * that has to describe all of those is wrong somewhere, and it is wrong silently.
 */

export type BubbleEdge = 'left' | 'right';

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DockGeometry {
  viewportW: number;
  viewportH: number;
  /** Safe-area insets, i.e. notch and home-indicator padding. */
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  /** Bubble edge length in px. */
  size: number;
  /** Breathing room between the bubble and everything else. */
  margin: number;
}

export interface DockPos {
  /** Centre of the bubble as a fraction of the usable height, 0 to 1. */
  yFraction: number;
  edge: BubbleEdge;
}

/** Which keep-out zones actually constrain a bubble docked to `edge`. */
export function relevantKeepOuts(
  keepOuts: readonly Rect[],
  geometry: DockGeometry,
  edge: BubbleEdge,
): Rect[] {
  const { size, margin } = geometry;
  // The bubble's horizontal span when docked to this edge.
  const left = edge === 'left' ? geometry.safeLeft : geometry.viewportW - geometry.safeRight - size;
  const right = left + size;

  return keepOuts.filter((r) => {
    // Ignore anything that is not actually on screen, or fully behind another.
    if (r.bottom <= r.top) return false;
    // Must overlap the bubble horizontally to constrain it at all.
    return r.right > left + margin && r.left < right - margin;
  });
}

/**
 * The vertical band the bubble's TOP edge may occupy, in px, inclusive.
 *
 * Everything downstream works in TOP-edge coordinates, not centre coordinates.
 * The two are easy to mix up and the symptom is silent: a band described as a
 * centre range but consumed as a top range puts the bubble half its own height
 * above where it was asked to be, which on a notched phone means behind the
 * notch. Naming it here and deriving from it keeps one convention.
 */
export function usableBand(geometry: DockGeometry): { top: number; bottom: number } {
  const { safeTop, safeBottom, margin, size, viewportH } = geometry;
  const top = safeTop + margin;
  const bottom = Math.max(top, viewportH - safeBottom - margin - size);
  return { top, bottom };
}

/** Convert a stored fraction to a clamped top-edge px position, then back. */
export function clampFraction(yFraction: number, geometry: DockGeometry): number {
  const { top, bottom } = usableBand(geometry);
  const span = bottom - top;
  if (span <= 0) return 0;
  // `Math.min(1, Math.max(0, NaN))` is NaN, so a non-finite stored value would
  // survive the clamp and be rendered as `top: NaN`, silently throwing the
  // bubble off-screen. localStorage is user-editable, so this is reachable.
  if (!Number.isFinite(yFraction)) return 0;
  const edge = top + Math.min(1, Math.max(0, yFraction)) * span;
  return Math.min(1, Math.max(0, (edge - top) / span));
}

/** Does a candidate top edge collide with any of the given rects? */
export function collides(topEdge: number, keepOuts: readonly Rect[], geometry: DockGeometry): boolean {
  const bottomEdge = topEdge + geometry.size;
  return keepOuts.some((r) => r.bottom > topEdge && r.top < bottomEdge);
}

/**
 * Snap the bubble to the nearest position where it does not cover anything.
 *
 * Kept as-is when it already fits. Otherwise it moves to whichever of the
 * nearest free spots above or below the obstruction is closer, which is what
 * makes dropping the bubble onto a pane header feel like it "gave way" rather
 * than like it refused to drop.
 */
export function snapY(
  yFraction: number,
  geometry: DockGeometry,
  keepOuts: readonly Rect[],
  edge: BubbleEdge,
): number {
  const clamped = clampFraction(yFraction, geometry);
  const { top, bottom } = usableBand(geometry);
  const span = bottom - top;
  if (span <= 0) return clamped;

  const wanted = top + clamped * span;
  // Which rects constrain the bubble depends on the edge it is docked to: a
  // panel hugging the right edge only blocks a right-docked bubble.
  const blockers = relevantKeepOuts(keepOuts, geometry, edge);
  if (blockers.length === 0 || !collides(wanted, blockers, geometry)) return clamped;

  // Candidate escapes, in top-edge coordinates: immediately above or below each
  // blocker, then clamped into the band.
  const candidates: number[] = [];
  for (const r of blockers) {
    candidates.push(r.top - geometry.margin - geometry.size);
    candidates.push(r.bottom + geometry.margin);
  }

  const free = candidates.filter((c) => c >= top && c <= bottom && !collides(c, blockers, geometry));
  if (free.length === 0) return clamped; // Fully blocked; stay put rather than vanish.

  // Nearest wins, with ties resolved upward so repeated drops are stable.
  free.sort((a, b) => {
    const da = Math.abs(a - wanted);
    const db = Math.abs(b - wanted);
    return da === db ? a - b : da - db;
  });
  const best = free[0];
  return Math.min(1, Math.max(0, (best - top) / span));
}

/** The edge a drag was released on: whichever half of the viewport it landed in. */
export function edgeFromX(x: number, viewportW: number): BubbleEdge {
  return x < viewportW / 2 ? 'left' : 'right';
}

/**
 * Absolute pixel position for rendering.
 *
 * `left`/`top` are used instead of `right`/`bottom` because the bubble snaps
 * between two edges; setting `left` for both keeps a single code path and avoids
 * the width jitter that switching between `left` and `right` causes mid-drag.
 */
export function toPixels(
  pos: DockPos,
  geometry: DockGeometry,
): { left: number; top: number } {
  const { top, bottom } = usableBand(geometry);
  const span = bottom - top;
  const edge = top + Math.min(1, Math.max(0, pos.yFraction)) * span;
  const left =
    pos.edge === 'left'
      ? geometry.safeLeft + geometry.margin
      : geometry.viewportW - geometry.safeRight - geometry.margin - geometry.size;
  return { left, top: edge };
}