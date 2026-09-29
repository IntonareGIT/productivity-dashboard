import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Maximize2, Minimize2, X } from 'lucide-react';
import type { NavTab } from '../../components/layout/Sidebar';
import { PaneContent } from './PaneContent';
import { PaneContainer, ico } from './PaneHeader';
import { ResourceFullScreen, useResourceFullScreen } from './useResourceFullScreen';
import {
  clampRatio, isSplit, swapPanes, toggleMaximize, type PaneSlot, type SplitState,
} from './splitModel';


interface SplitViewProps {
  state: SplitState;
  setState: React.Dispatch<React.SetStateAction<SplitState>>;
  onNavigate: (tab: NavTab) => void;
  onOpenAssistantSettings: () => void;
  /** Close the split overlay entirely (the top-bar icon also toggles it). */
  onCloseSplit?: () => void;
}

export const SplitView: React.FC<SplitViewProps> = ({
  state, setState, onNavigate, onOpenAssistantSettings, onCloseSplit,
}) => {
  // Non-PDF full screen (images) goes through the shared hook. PDFs are handled
  // by the shared PdfViewer itself, so no second viewer is ever mounted.
  const { fullScreenResource, closeFullScreen } = useResourceFullScreen();
  // ONE registry, created here and passed DOWN to whichever body renders. The
  // single-pane and split bodies are mutually exclusive, but they are two
  // separate components, so a `usePdfControls()` call inside each would give
  // them two independent stores — exactly the drift the comment below warns
  // about. Hoisting the hook here makes the state genuinely shared.
  const { registerPdfControls, pdfControlsFor } = usePdfControls();
  const split = isSplit(state);

  return (
    <div className="h-full min-h-0 w-full flex flex-col">
      {split && (
        <SplitBody
          state={state}
          setState={setState}
          onNavigate={onNavigate}
          onOpenAssistantSettings={onOpenAssistantSettings}
          onCloseSplit={onCloseSplit}
          registerPdfControls={registerPdfControls}
          pdfControlsFor={pdfControlsFor}
        />
      )}

      {/* Single-pane: the normal dashboard, full width. */}
      {!split && (
        <PaneContainer
          index={0}
          slot={state.panes[0]}
          split={false}
          maximized={false}
          setState={setState}
          pdfControls={pdfControlsFor(0, state.panes[0])}
        >
          <PaneContent
            slot={state.panes[0]}
            onNavigate={onNavigate}
            onOpenAssistantSettings={onOpenAssistantSettings}
            onRegisterPdfControls={(c) => registerPdfControls(0, c)}
          />
        </PaneContainer>
      )}

      {/* The same shared full-screen preview the Library preview uses. */}
      <ResourceFullScreen resource={fullScreenResource} onClose={closeFullScreen} />
    </div>
  );
};

/**
 * The PDF viewer owns page/zoom/rotation, so it must render its own controls —
 * but they have to APPEAR in the universal pane header, not in a second toolbar
 * of its own. The viewer publishes its controls here and the header renders
 * whatever is registered for its pane. This is a hook, so it creates state: it
 * MUST be called once, at the top of `SplitView`, and the resulting functions
 * handed down. Calling it separately in the split and single-pane bodies would
 * give each its own registry.
 */
const usePdfControls = () => {
  const [pdfControls, setPdfControls] = useState<Record<number, React.ReactNode>>({});
  const registerPdfControls = useCallback((index: number, node: React.ReactNode) => {
    setPdfControls((prev) => {
      const has = Boolean(prev[index]);
      // Bail when nothing changed, or the viewer re-registering every render
      // would loop: register -> render -> register ...
      if (has === !node) return prev;
      const next = { ...prev };
      if (node) next[index] = node;
      else delete next[index];
      return next;
    });
  }, []);
  const pdfControlsFor = useCallback(
    (index: number, slot: PaneSlot) =>
      // Only a pdf view with a loaded document gets document controls.
      slot.kind === 'pdf' && slot.resourceId ? pdfControls[index] : undefined,
    [pdfControls],
  );
  return { registerPdfControls, pdfControlsFor };
};

type PdfControls = ReturnType<typeof usePdfControls>;

/* ---------------- The two-pane body ---------------- */

interface SplitBodyProps extends Omit<SplitViewProps, 'state'> {
  state: SplitState;
  /** The ONE shared control registry, owned by `SplitView`. */
  registerPdfControls: PdfControls['registerPdfControls'];
  pdfControlsFor: PdfControls['pdfControlsFor'];
}

const SplitBody: React.FC<SplitBodyProps> = ({
  state, setState, onNavigate, onOpenAssistantSettings, onCloseSplit,
  registerPdfControls, pdfControlsFor,
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [stacked, setStacked] = useState(false);
  const draggingRef = useRef(false);

  // Side by side on desktop, stacked under 768px.
  useEffect(() => {
    const check = () => setStacked(window.matchMedia('(max-width: 767px)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const move = (ev: PointerEvent) => {
      if (!draggingRef.current || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const raw = stacked
        ? (ev.clientY - rect.top) / rect.height
        : (ev.clientX - rect.left) / rect.width;
      setState((s) => ({ ...s, ratio: clampRatio(raw) }));
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const [a, b] = state.panes;
  const maximized = state.maximized;
  const firstFlex = maximized === 1 ? 1 : state.ratio;
  const secondFlex = maximized === 0 ? 1 : 1 - state.ratio;

  const pane = (index: number, slot: PaneSlot, flex: number) => {
    const hidden = maximized !== null && maximized !== index;
    return (
      <div
        key={index}
        // The maximized-away pane stays MOUNTED but display:none, so it keeps
        // its viewer state (page/zoom/rotation) and is instant on restore.
        className={`min-w-0 min-h-0 relative flex flex-col overflow-hidden ${hidden ? 'hidden' : ''}`}
        style={hidden ? undefined : { flex: `${flex} 1 0%` }}
        aria-hidden={hidden || undefined}
      >
        {!hidden && (
          // Every pane kind — empty, dashboard, pdf, notes, assistant — goes
          // through the same wrapper, so the header is always in the same place
          // and switching view never moves it.
          <PaneContainer
            index={index}
            slot={slot}
            split={isSplit(state)}
            maximized={maximized === index}
            setState={setState}
            pdfControls={pdfControlsFor(index, slot)}
          >
            <PaneContent
              slot={slot}
              onNavigate={onNavigate}
              onOpenAssistantSettings={onOpenAssistantSettings}
              onRegisterPdfControls={(c) => registerPdfControls(index, c)}
            />
          </PaneContainer>
        )}
      </div>
    );
  };

  return (
    <div
      ref={wrapRef}
      className={`flex-1 min-h-0 w-full relative flex ${stacked ? 'flex-col' : 'flex-row'}`}
    >
      {pane(0, a, firstFlex)}

      {/* Draggable divider */}
      <div
        role="separator"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            setState((s) => ({ ...s, ratio: clampRatio(s.ratio - step) }));
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            setState((s) => ({ ...s, ratio: clampRatio(s.ratio + step) }));
          }
        }}
        className={`relative shrink-0 flex items-center justify-center bg-border hover:bg-accent/60 transition-colors touch-none select-none ${
          // `self-stretch` rather than `h-full`: stretch always fills the row,
          // whereas a percentage height collapses to 0 if the row height is not
          // definite, which made the divider disappear. The background is a
          // solid token too — `bg-border/40` was too faint to see on some themes.
          stacked ? 'h-2.5 w-full cursor-row-resize self-stretch' : 'w-2.5 cursor-col-resize self-stretch'
        }`}
      >
        <span
          aria-hidden="true"
          className="rounded-full bg-content-tertiary/70"
          style={{ width: stacked ? 32 : 3, height: stacked ? 3 : 32 }}
        />

        {/* The split controls live ON the divider, centred on it. Positioning
            them absolutely at the top of the pane put them straight over the
            pane title/picker; anchoring them to the divider means they sit in
            the gutter between the panes and can never cover content. */}
        {isSplit(state) && (
          <div
            role="toolbar"
            aria-label="Split view controls"
            className={`absolute z-30 flex items-center gap-0.5 rounded-full bg-slate-900 border border-slate-600 shadow-lg p-0.5 ${
              stacked
                ? 'left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 flex-row'
                : 'top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 flex-col'
            }`}
          >
      <button
        onClick={() => setState((s) => (s.maximized === null ? toggleMaximize(s, 0) : { ...s, maximized: null }))}
        aria-label={maximized === null ? 'Maximize a pane' : 'Restore both panes'}
        title={maximized === null ? 'Maximize a pane' : 'Restore both panes'}
        className={ico}
      >
        {maximized === null ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
      </button>
      <button
        onClick={() => setState((s) => swapPanes(s))}
        aria-label="Swap panes"
        title="Swap panes"
        className={ico}
      >
        <ArrowLeftRight className="w-4 h-4" />
      </button>
            {onCloseSplit && (
              <button
                onClick={onCloseSplit}
                aria-label="Close split view"
                title="Close split view"
                className={`${ico} hover:text-red-400`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {pane(1, b, secondFlex)}
    </div>
  );
};
