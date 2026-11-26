import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A toolbar dropdown that anchors under a button and closes on outside press.
 *
 * Four of the note toolbar's controls need this behaviour (colour, highlight,
 * callout, arrow), and the first implementation inlined it once. Repeating that
 * four times is how they drift apart, so it lives here instead.
 *
 * Two details are load-bearing and easy to lose:
 *
 * 1. The panel is rendered through a PORTAL. The toolbar is `overflow-x-auto`,
 *    so an absolutely-positioned child is clipped on a phone — the panel would
 *    be cut off at the toolbar's edge.
 * 2. The anchor keeps `onMouseDown -> preventDefault` (see `NoteEditor`). Without
 *    it the editor loses focus and the selection collapses before the click, so
 *    the command applies to nothing. That is why every button inside this panel
 *    calls the same `keepSelection` the toolbar buttons do.
 */
export interface AnchoredPopoverProps {
  /** Whether the panel is open. */
  open: boolean;
  onClose: () => void;
  /** The button the panel hangs from. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Accessible name for the panel, and for the anchor's `aria-expanded` group. */
  label: string;
  /** Marks the anchor so the outside-press listener can ignore it. */
  anchorAttr: string;
  /** Marks the panel so the same listener can ignore presses inside it. */
  popoverAttr: string;
  /** Panel width in px; the positioner clamps to the viewport using this. */
  width?: number;
  children: React.ReactNode;
}

export const AnchoredPopover: React.FC<AnchoredPopoverProps> = ({
  open, onClose, anchorRef, label, anchorAttr, popoverAttr, width = 224, children,
}) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      // Clamped so the panel never hangs off the right edge on a phone.
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
  }, [anchorRef, width]);

  // Re-place on any scroll (capture, so an inner scroller counts) and on resize,
  // otherwise the panel stays where it was while the toolbar scrolled away.
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  // Outside press closes. `pointerdown` fires before `click` for mouse and touch
  // alike, so one listener covers both.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(`[${popoverAttr}]`) || t.closest(`[${anchorAttr}]`)) return;
      onClose();
    };
    // Escape closes too, because a dropdown that only closes by clicking
    // elsewhere is unreachable from the keyboard.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorAttr, popoverAttr]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      {...{ [popoverAttr]: '' }}
      role="group"
      aria-label={label}
      style={{ top: pos.top, left: pos.left, width }}
      className="fixed z-50 p-2 rounded-xl border border-border bg-bg-surface shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
};

/** Keep the editor selection alive while a toolbar button is pressed. */
export const keepSelection = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();

/** Shared button row inside a dropdown panel. */
export const POPOVER_ITEM =
  'w-full min-h-[40px] rounded-lg px-2 text-xs text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors flex items-center gap-2 text-left';