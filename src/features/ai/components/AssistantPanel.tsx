import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Expand, Trash2, X } from 'lucide-react';
import { Z } from '../../../components/ui/zIndex';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { useFloatingAiStore, type BubbleMode } from '../../../stores/useFloatingAiStore';
import { AssistantChat } from './AssistantChat';

interface AssistantPanelProps {
  onOpenSettings: () => void;
  /** Navigate to the full-page assistant at /assistant. */
  onExpand: () => void;
  /** Which bubble slot is showing, so the panel opens on the matching edge. */
  mode?: BubbleMode;
}

/** Desktop width range. The panel is a card on a desktop, not a full column. */
const MIN_W = 340;
const MAX_W = 520;
const DEFAULT_W = 380;
const MIN_H = 240;
/** Phone sheet height, as a fraction of the viewport. */
const SHEET_H = 0.6;

/**
 * Floating chat panel.
 *
 * A thin wrapper around `AssistantChat` — no chat logic of its own — so the
 * full-page assistant renders exactly the same conversation. Reusing the chat is
 * what makes the conversation shared rather than duplicated: a turn started here
 * is the same turn a pane shows.
 *
 * Two layouts, because one cannot serve both:
 *
 *  - Phone: a bottom sheet capped at 60vh, with a drag handle. A floating card
 *    on a phone either covers the content or is too small to read.
 *  - Desktop: a floating card anchored to whichever edge the bubble is docked
 *    to, so it opens beside the control that opened it rather than in a fixed
 *    corner the user may have moved away from.
 */
export const AssistantPanel: React.FC<AssistantPanelProps> = ({
  onOpenSettings, onExpand, mode = 'standalone',
}) => {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const clearChat = useAssistantStore((s) => s.clearChat);
  const edge = useFloatingAiStore((s) => s.memory[mode].edge);

  const [width, setWidth] = useState(DEFAULT_W);
  const [isPhone, setIsPhone] = useState(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Track the breakpoint instead of reading it during render, so the sheet and
  // the card do not fight each other when the window crosses 640px mid-drag.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Escape closes the panel, same as the close button. Bound to the panel's own
  // keydown rather than the window, so it cannot fire while the user is in a
  // dialog, a PDF viewer or Settings.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  /** Drag the sheet's height, or the card's width, from the resize grip. */
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startX = e.clientX;
      const startHeight = panelRef.current?.offsetHeight ?? 0;
      const startWidth = panelRef.current?.offsetWidth ?? DEFAULT_W;

      const onMove = (ev: PointerEvent) => {
        if (isPhone) {
          // The sheet is anchored to the bottom, so a smaller clientY means taller.
          const next = startHeight - (ev.clientY - startY);
          setSheetHeight(Math.max(MIN_H, Math.min(window.innerHeight * SHEET_H, next)));
        } else {
          // A right-docked card grows as the pointer moves right, and vice versa.
          const delta = edge === 'right' ? ev.clientX - startX : startX - ev.clientX;
          setWidth(Math.max(MIN_W, Math.min(MAX_W, startWidth + delta)));
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [isPhone, edge],
  );

  if (!open) return null;

  const panelStyle: React.CSSProperties = isPhone
    ? sheetHeight
      ? { height: sheetHeight }
      : { height: `${SHEET_H * 100}vh`, maxHeight: `${SHEET_H * 100}vh` }
    : { width };

  return (
    <div
      ref={panelRef}
      // Declares itself a keep-out zone so the floating bubble moves out of the way
      // instead of sitting on top of the panel it just opened.
      data-floating-ai-keepout="assistant-panel"
      onKeyDown={onKeyDown}
      className={`fixed ${Z.modal} flex flex-col overflow-hidden ${
        isPhone
          ? 'inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-bg-surface shadow-2xl'
          : `${edge === 'right' ? 'right-4' : 'left-4'} top-24 max-h-[80vh] rounded-2xl border border-border bg-bg-surface shadow-2xl`
      }`}
      style={panelStyle}
    >
      {isPhone && (
        <div
          onPointerDown={startResize}
          className="shrink-0 pt-2 pb-1 flex justify-center cursor-ns-resize touch-none"
          aria-label="Resize assistant"
          role="separator"
          aria-orientation="horizontal"
        >
          <span className="h-1 w-10 rounded-full bg-border-strong" />
        </div>
      )}
      <AssistantChat
        onOpenSettings={onOpenSettings}
        headerExtra={
          <>
            <button onClick={() => void clearChat()} aria-label="Clear chat" title="Clear chat" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onExpand} aria-label="Open full page" title="Open full page" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <Expand className="w-4 h-4" />
            </button>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <X className="w-4 h-4" />
            </button>
          </>
        }
      />
      {!isPhone && (
        <div
          onPointerDown={startResize}
          className={`absolute bottom-0 w-3 h-3 cursor-ew-resize touch-none ${
            edge === 'right' ? 'right-0' : 'left-0'
          }`}
          aria-label="Resize assistant"
          role="separator"
          aria-orientation="vertical"
        >
          <span
            className={`absolute bottom-1 w-2 h-2 border-border-strong ${
              edge === 'right' ? 'right-1 border-b border-r' : 'left-1 border-b border-l'
            }`}
          />
        </div>
      )}
    </div>
  );
};
