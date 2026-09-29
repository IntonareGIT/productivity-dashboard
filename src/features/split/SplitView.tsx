import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftRight, Columns2, Maximize2, Minimize2, PanelLeftClose, X,
} from 'lucide-react';
import { db } from '../../db/db';
import type { NavTab } from '../../components/layout/Sidebar';
import type { Resource, Topic } from '../../types';
import { PaneContent } from './PaneContent';
import { ResourceFullScreen, useResourceFullScreen } from './useResourceFullScreen';
import {
  addSecondPane, clampRatio, closePane, initialSplitState, isSplit, setPane,
  swapPanes, toggleMaximize, type PaneSlot, type SplitState,
} from './splitModel';

const ico = 'inline-flex items-center justify-center p-1.5 min-h-[30px] rounded-lg border border-transparent text-slate-300 hover:text-white hover:bg-slate-700/70 transition-colors shrink-0';
// Focus Mode: the pane pickers float over the content, so they need their own
// translucent surface to stay readable against a PDF page.
// The dropdowns now render INSIDE the PDF viewer's opaque slate-900 toolbar,
// so they use a solid dark treatment. The old `bg-bg-surface/90
// backdrop-blur-sm` was a light, translucent field: on the dark bar it both
// clashed and reintroduced the blur-glow the solid bar was meant to remove.
const field = 'min-w-0 bg-slate-800 text-slate-100 border border-slate-600 rounded-lg px-1.5 py-1 text-[11px] outline-none focus:border-accent';

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
  const split = isSplit(state);

  const onDrag = useCallback((clientX: number, rect: DOMRect) => {
    const next = clampRatio((clientX - rect.left) / rect.width);
    setState((s) => ({ ...s, ratio: next }));
  }, [setState]);

  return (
    <div className="h-full min-h-0 w-full flex flex-col">
      {split && (
        <SplitBody
          state={state}
          setState={setState}
          onNavigate={onNavigate}
          onOpenAssistantSettings={onOpenAssistantSettings}
          onCloseSplit={onCloseSplit}
        />
      )}

      {/* Single-pane: the normal dashboard, full width. */}
      {!split && (
        <div className="flex-1 min-h-0">
          <PaneContent
            slot={state.panes[0]}
            onNavigate={onNavigate}
            onOpenAssistantSettings={onOpenAssistantSettings}
          />
        </div>
      )}

      {/* The same shared full-screen preview the Library preview uses. */}
      <ResourceFullScreen resource={fullScreenResource} onClose={closeFullScreen} />
    </div>
  );
};

/* ---------------- The two-pane body ---------------- */

interface SplitBodyProps extends Omit<SplitViewProps, 'state'> {
  state: SplitState;
}

const SplitBody: React.FC<SplitBodyProps> = ({
  state, setState, onNavigate, onOpenAssistantSettings, onCloseSplit,
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
          <>
            {/* A PDF pane has NO header of its own: the dropdowns and the pane
                actions are injected into the viewer's single solid toolbar
                (leadingControls / trailingControls), so there is exactly one
                header row. Every other kind keeps this compact floating bar,
                because it has no viewer toolbar to live in. */}
            {/* A pdf pane hides this bar only once a document is actually
                loaded: until then the pane shows only a "pick a PDF" message,
                so suppressing the bar would remove the very dropdown the user
                needs to choose a file. A dead-end with no way out. */}
            {(slot.kind !== 'pdf' || !slot.resourceId) && (
              <div className="absolute inset-x-0 top-0 z-20 flex justify-start pointer-events-none px-1.5 pt-1.5">
                <div className="pointer-events-auto flex items-center gap-1 max-w-full overflow-x-auto rounded-xl bg-slate-900 border border-slate-700 px-1 py-0.5">
                  <PaneHeader
                    index={index}
                    slot={slot}
                    split={isSplit(state)}
                    maximized={maximized === index}
                    setState={setState}
                    onCloseSplit={onCloseSplit}
                  />
                </div>
              </div>
            )}
            {/* `overflow-hidden` on the pane plus internal scrolling is what
                keeps scrolling inside the pane rather than the page. The chain
                is pane(relative, flex) -> region(flex-1 min-h-0) ->
                PaneContent (h-full) -> ResourceViewer/PdfViewer (h-full). */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <PaneContent
                slot={slot}
                onNavigate={onNavigate}
                onOpenAssistantSettings={onOpenAssistantSettings}
                leadingControls={
                  slot.kind === 'pdf' && slot.resourceId ? (
                    <PaneHeader
                      index={index}
                      slot={slot}
                      split={isSplit(state)}
                      maximized={maximized === index}
                      setState={setState}
                      onCloseSplit={onCloseSplit}
                      part="selectors"
                    />
                  ) : undefined
                }
                trailingControls={
                  slot.kind === 'pdf' && slot.resourceId ? (
                    <PaneHeader
                      index={index}
                      slot={slot}
                      split={isSplit(state)}
                      maximized={maximized === index}
                      setState={setState}
                      onCloseSplit={onCloseSplit}
                      part="buttons"
                    />
                  ) : undefined
                }
              />
            </div>
          </>
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
/* ---------------- Pane header ---------------- */

interface PaneHeaderProps {
  index: number;
  slot: PaneSlot;
  split: boolean;
  maximized: boolean;
  setState: React.Dispatch<React.SetStateAction<SplitState>>;
  onCloseSplit?: () => void;
  /**
   * Which half to render. A PDF pane needs the dropdowns INSIDE the viewer's
   * toolbar, so the pane renders `selectors` as the viewer's leading controls
   * and `buttons` as its trailing ones. Every other kind renders both together
   * in its own floating header.
   */
  part?: 'all' | 'selectors' | 'buttons';
}

/**
 * The per-pane header, in two halves: the content/document dropdowns, and the
 * pane-level actions. A PDF pane injects both into the viewer's own single
 * toolbar row; other kinds render them in a compact floating header.
 */
const PaneHeader: React.FC<PaneHeaderProps> = ({
  index, slot, split, maximized, setState, onCloseSplit, part = 'all',
}) => {
  // Pickers are driven by the currently selected kind, so each pane chooses
  // "Dashboard / PDF / Notes / Assistant" and then its own resource or topic.
  const pdfs = useLiveQuery(async () => {
    const all = await db.resources.toArray();
    return all.filter((r) => r.kind === 'file' && !!r.blob);
  }, []) ?? [];
  const topics = useLiveQuery(() => db.topics.toArray(), []) ?? [];

  const select = (patch: Partial<PaneSlot> & { kind: PaneSlot['kind'] }) => {
    const next: PaneSlot = { kind: patch.kind };
    if (patch.kind === 'pdf') next.resourceId = patch.resourceId ?? slot.resourceId;
    if (patch.kind === 'notes') next.topicId = patch.topicId ?? slot.topicId;
    setState((s) => setPane(s, index, next));
  };

  // The two dropdowns, as a value so they can be rendered in two different
  // places: inside the PDF viewer's own toolbar (a PDF pane) or in the pane's
  // own header (every other kind). This is what makes ONE header possible for
  // a PDF instead of a selector bar stacked on a viewer toolbar.
  const selectors = (
    <>
      <select
        aria-label={`Pane ${index + 1} content`}
        value={slot.kind}
        onChange={(e) => select({ kind: e.target.value as PaneSlot['kind'] })}
        className={`${field} max-w-[7.5rem] font-semibold shrink-0`}
      >
        <option value="empty">Empty</option>
        <option value="dashboard">Dashboard</option>
        <option value="pdf">PDF preview</option>
        <option value="notes">Notes</option>
        <option value="assistant">Assistant</option>
      </select>

      {(slot.kind === 'pdf' || slot.kind === 'notes') && (
        <select
          aria-label={slot.kind === 'pdf' ? `Pane ${index + 1} PDF` : `Pane ${index + 1} topic`}
          value={slot.kind === 'pdf' ? slot.resourceId ?? '' : slot.topicId ?? ''}
          onChange={(e) => {
            const v = e.target.value || undefined;
            if (slot.kind === 'pdf') select({ kind: 'pdf', resourceId: v });
            else select({ kind: 'notes', topicId: v });
          }}
          className={`${field} w-[8rem] sm:w-[11rem] shrink-0`}
        >
          <option value="">{slot.kind === 'pdf' ? 'Choose a file\u2026' : 'Choose a topic\u2026'}</option>
          {slot.kind === 'pdf'
            ? (pdfs as Resource[]).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)
            : (topics as Topic[]).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
    </>
  );

  // The pane-level actions. NOTE: there is deliberately no static title label
  // here any more. The dropdown beside it already shows the document name, so
  // the label was a second, identical rendering of the same word.
  const actions = (
    <>
      {!split && (
        <button
          onClick={() => setState((s) => addSecondPane(s, { kind: 'assistant' }))}
          aria-label="Open split view"
          title="Open split view"
          className={ico}
        >
          <Columns2 className="w-4 h-4" />
        </button>
      )}

      {split && (
        <>
          <button
            onClick={() => setState((s) => toggleMaximize(s, index))}
            aria-label={maximized ? `Restore pane ${index + 1}` : `Maximize pane ${index + 1}`}
            title={maximized ? 'Restore' : 'Maximize pane'}
            className={ico}
          >
            {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setState((s) => closePane(s, index))}
            aria-label={`Close pane ${index + 1}`}
            title="Close this pane"
            className={ico}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </>
      )}

      {!split && (
        <button
          onClick={() => setState(initialSplitState)}
          aria-label="Back to dashboard"
          title="Back to dashboard"
          className={ico}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </>
  );

  return (
    <div className="flex items-center gap-1 shrink-0">
      {part === 'selectors' ? selectors : actions}
    </div>
  );
};
