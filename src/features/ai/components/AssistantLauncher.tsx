import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import {
  useFloatingAiStore,
  type BubbleMode,
  type FloatingAiMemory,
} from '../../../stores/useFloatingAiStore';
import { Z } from '../../../components/ui/zIndex';
import {
  edgeFromX,
  snapY,
  toPixels,
  type DockGeometry,
  type DockPos,
  type Rect,
} from '../floatingAiDock';

/** Bubble edge length in px. Matches the old 56px button. */
const SIZE = 56;
/** Gap kept between the bubble and the viewport edge, safe areas and any pane. */
const MARGIN = 12;
/** Idle time before the bubble fades, in ms. */
const IDLE_MS = 4000;

/**
 * Read the CSS `safe-area-inset-*` values, which are 0 on a device with no notch.
 *
 * Read through a probe element rather than by exposing them as CSS custom
 * properties. An unregistered custom property's computed value still contains
 * the unresolved `env(...)` token in several browsers, so `parseFloat` would
 * silently yield 0 on exactly the notched devices that need the value. Padding
 * on a real element is always resolved, and `@property` is not universally
 * available.
 *
 * Measured rather than assumed: a notched phone and a desktop share this code,
 * so hard-coding 0 would put the bubble under the notch on one of them.
 */
let probeEl: HTMLElement | null = null;

function getProbe(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (probeEl?.isConnected) return probeEl;
  probeEl = document.createElement('div');
  probeEl.setAttribute('aria-hidden', 'true');
  probeEl.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');
  document.body.appendChild(probeEl);
  return probeEl;
}

export function readSafeInsets(): { top: number; right: number; bottom: number; left: number } {
  const el = getProbe();
  if (!el) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(el);
  const px = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}

interface AssistantLauncherProps {
  /** Jump to Settings when AI is not configured yet. */
  onOpenSettings: () => void;
  /** True when a model row is configured AND the user is signed in to Dexie Cloud. */
  configured: boolean;
  /**
   * Hide the launcher. Owned by `shouldShowFloatingAi`, which is the single rule
   * for this and covers the assistant pane, the full assistant view, true
   * fullscreen and the user's setting.
   */
  hidden?: boolean;
  /** Which memory slot to use, so the two modes park independently. */
  mode?: BubbleMode;
}

/**
 * The floating AI button: docked to a screen edge, draggable along it, and never
 * covering a pane header, the tab bar or the assistant panel.
 *
 * Positioning is measured from live DOM rects on every resize and every drag
 * rather than from fixed offsets, because everything it must avoid is
 * viewport-sized: a pane header that is 44px on desktop and clipped on a phone,
 * a tab bar that only exists on mobile, and a panel that is a floating card on
 * one and a bottom sheet on the other.
 */
export const AssistantLauncher: React.FC<AssistantLauncherProps> = ({
  onOpenSettings, configured, hidden = false, mode = 'standalone',
}) => {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);

  const memory = useFloatingAiStore((s) => s.memory[mode]);
  const remember = useFloatingAiStore((s) => s.remember);

  const [pos, setPos] = useState<DockPos>(memory);
  const [geometry, setGeometry] = useState<DockGeometry | null>(null);
  const [keepOuts, setKeepOuts] = useState<Rect[]>([]);
  const [dragging, setDragging] = useState(false);
  const [faded, setFaded] = useState(false);
  // Read from inside pointer handlers, which must not re-subscribe on every move.
  const keepOutsRef = useRef<Rect[]>([]);
  const geometryRef = useRef<DockGeometry | null>(null);
  // Set on pointerdown and cleared on the following click, so a drag never
  // registers as a click.
  const suppressClickRef = useRef(false);

  /**
   * Measure the viewport, the safe areas and every keep-out zone, live.
   *
   * Keep-out zones are declared by the surfaces themselves via
   * `data-floating-ai-keepout`, so adding a new one is a one-attribute change
   * where it lives rather than a guess about its height in a central constant.
   */
  const measure = useCallback(() => {
    const insets = readSafeInsets();
    setGeometry({
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      safeTop: insets.top,
      safeRight: insets.right,
      safeBottom: insets.bottom,
      safeLeft: insets.left,
      size: SIZE,
      margin: MARGIN,
    });
    const rects = Array.from(
      document.querySelectorAll<HTMLElement>('[data-floating-ai-keepout]'),
    )
      // A hidden zone must not push the bubble around: `display:none` elements
      // report a zero rect, which the geometry layer already ignores, but an
      // `opacity:0` one reports a real rect and would.
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
    setKeepOuts(rects);
  }, []);

  useEffect(() => {
    if (hidden) return;
    measure();
    window.addEventListener('resize', measure);
    // Separate from resize because it can fire without one on some mobile browsers.
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [hidden, measure]);

  // The assistant panel opens and closes underneath the bubble, so the keep-out
  // set changes with `open`. Re-measuring on that change is what stops the bubble
  // from coming to rest on top of the panel it just opened.
  useEffect(() => {
    if (hidden) return;
    const id = window.setTimeout(measure, 0);
    return () => window.clearTimeout(id);
  }, [hidden, open, measure]);

  keepOutsRef.current = keepOuts;
  geometryRef.current = geometry;

  /**
   * Idle fade.
   *
   * A faded bubble is `pointer-events: none`, and any pointer movement or focus
   * restores it. That pairing matters: an unfaded-but-invisible button would be
   * a control the user cannot see and cannot click, and a faded one that kept
   * hit-testing would swallow clicks meant for the content behind it.
   */
  useEffect(() => {
    if (hidden || dragging) return;
    setFaded(false);
    const wake = () => setFaded(false);
    const id = window.setTimeout(() => setFaded(true), IDLE_MS);
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('focusin', wake);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('focusin', wake);
    };
  }, [hidden, dragging]);

  /**
   * Re-clamp whenever the geometry changes.
   *
   * A position remembered on a wide desktop must not place the bubble
   * off-screen on a phone, or under the notch after a rotation.
   */
  useEffect(() => {
    if (hidden || !geometry) return;
    const snapped = snapY(pos.yFraction, geometry, keepOutsRef.current, pos.edge);
    if (snapped !== pos.yFraction) setPos((p) => ({ ...p, yFraction: snapped }));
    // `pos` is deliberately excluded: it is the value being corrected, and
    // depending on it here would re-run the correction on every state write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, geometry]);

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!geometry) return;
    // Capture the pointer so the drag survives the cursor leaving the button,
    // and prevent the default focus shift so repositioning never steals keyboard
    // focus from whatever the user was actually typing into.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFaded(false);
    // Suppress the click that follows the drag, which would otherwise toggle
    // the panel open at the end of every reposition.
    suppressClickRef.current = true;

    const onMove = (ev: PointerEvent) => {
      const g = geometryRef.current;
      if (!g) return;
      const insets = readSafeInsets();
      const live: DockGeometry = { ...g, safeTop: insets.top, safeBottom: insets.bottom };
      const edge = edgeFromX(ev.clientX - SIZE / 2, live.viewportW);
      const bandTop = live.safeTop + live.margin;
      const bandBottom = live.viewportH - live.safeBottom - live.margin - live.size;
      const span = bandBottom - bandTop;
      const rawFraction = span > 0 ? (ev.clientY - bandTop) / span : 0;
      // Snapping during the drag, not only on release, is what makes the bubble
      // visibly give way as it is pushed past a pane header.
      setPos({ yFraction: snapY(rawFraction, live, keepOutsRef.current, edge), edge });
    };

    const finish = (ev: PointerEvent) => {
      setDragging(false);
      // Re-measure at drop time: the layout may have moved while dragging.
      measure();
      const live = geometryRef.current ?? geometry;
      const edge = edgeFromX(ev.clientX, live.viewportW);
      setPos((current) => {
        const yFraction = snapY(current.yFraction, live, keepOutsRef.current, edge);
        // Persist on drop only, never per pointer move.
        remember(mode, { yFraction, edge });
        return { yFraction, edge };
      });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  /**
   * Keyboard nudge. A drag-only control is unusable without a pointer, so the
   * arrow keys move it along the edge and PageUp/PageDown take bigger steps.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!geometry) return;
    const step = e.shiftKey ? 0.2 : 0.05;
    const delta: Record<string, number> = { ArrowUp: -step, ArrowDown: step };
    const d = delta[e.key];
    if (d === undefined && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    measure();
    const yFraction = snapY(pos.yFraction + (d ?? 0), geometry, keepOutsRef.current, pos.edge);
    const edge =
      e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : pos.edge;
    const saved: FloatingAiMemory = { yFraction, edge };
    setPos(saved);
    remember(mode, saved);
  };

  if (hidden) return null;

  const px = geometry ? toPixels(pos, geometry) : null;
  // Until the first measurement, render at the remembered edge rather than
  // snapping to the centre, so the button never blinks through the middle of
  // the screen on first paint.
  const style: React.CSSProperties | undefined = px
    ? { left: px.left, top: px.top }
    : { right: pos.edge === 'left' ? undefined : MARGIN, left: pos.edge === 'left' ? MARGIN : undefined };

  return (
    <button
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // A drag must not also fire a click, or every reposition toggles the
        // panel. Reset the flag either way so the next real click still works.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          return;
        }
        if (!configured) {
          onOpenSettings();
          return;
        }
        setOpen(!open);
      }}
      title={
        configured
          ? 'Ask the assistant (drag to move, arrow keys to nudge)'
          : 'Configure an AI provider in Settings first'
      }
      aria-label={configured ? 'Open AI assistant' : 'Configure AI provider in Settings'}
      className={`fixed ${Z.nav} touch-none select-none transition-opacity duration-500 ${
        dragging ? 'opacity-100 cursor-grabbing' : 'cursor-grab'
      } ${faded && !dragging ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={style}
    >
      <span
        className={`flex w-14 h-14 rounded-2xl shadow-xl items-center justify-center transition-transform ${
          dragging ? '' : 'hover:scale-105'
        } ${
          configured
            ? 'bg-accent hover:bg-accent-hover text-white'
            : 'bg-bg-elevated border border-dashed border-border-strong text-content-tertiary'
        }`}
      >
        <Sparkles className="w-6 h-6" />
      </span>
      {!configured && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-bg-surface" />
      )}
    </button>
  );
};
