import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftRight, Columns2, Maximize2, Minimize2, PanelLeftClose, X,
} from 'lucide-react';
import { db } from '../../db/db';
import type { NavTab } from '../../components/layout/Sidebar';
import type { Resource, Topic } from '../../types';
import { PaneContent } from './PaneContent';
import { FullScreenPreview } from './FullScreenPreview';
import {
  addSecondPane, clampRatio, closePane, initialSplitState, isSplit, setPane,
  swapPanes, toggleMaximize, type PaneSlot, type SplitState,
} from './splitModel';

const ico = 'inline-flex items-center justify-center p-2 min-h-[36px] rounded-lg border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors';

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
  const [fullScreenResource, setFullScreenResource] = useState<Resource | null>(null);
  const split = isSplit(state);

  const openFullScreenFor = useCallback(async (resourceId?: string) => {
    if (!resourceId) return;
    const r = await db.resources.get(resourceId);
    if (r) setFullScreenResource(r);
  }, []);

  const onDrag = useCallback((clientX: number, rect: DOMRect) => {
    const next = clampRatio((clientX - rect.left) / rect.width);
    setState((s) => ({ ...s, ratio: next }));
  }, [setState]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {split && (
        <SplitBody
          state={state}
          setState={setState}
          onNavigate={onNavigate}
          onOpenAssistantSettings={onOpenAssistantSettings}
          onOpenFullScreen={openFullScreenFor}
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

      {fullScreenResource && (
        <FullScreenPreview
          resource={fullScreenResource}
          onClose={() => setFullScreenResource(null)}
        />
      )}
    </div>
  );
};

/* ---------------- The two-pane body ---------------- */

interface SplitBodyProps extends Omit<SplitViewProps, 'state'> {
  state: SplitState;
  onOpenFullScreen: (resourceId?: string) => void;
}

const SplitBody: React.FC<SplitBodyProps> = ({
  state, setState, onNavigate, onOpenAssistantSettings, onOpenFullScreen, onCloseSplit,
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
        className={`min-w-0 min-h-0 flex flex-col ${hidden ? 'hidden' : ''}`}
        style={hidden ? undefined : { flex: `${flex} 1 0%` }}
        aria-hidden={hidden || undefined}
      >
        {!hidden && (
          <>
            <PaneHeader
              index={index}
              slot={slot}
              split={isSplit(state)}
              maximized={maximized === index}
              setState={setState}
              onCloseSplit={onCloseSplit}
            />
            <div className="flex-1 min-h-0 overflow-auto">
              <PaneContent
                slot={slot}
                onNavigate={onNavigate}
                onOpenAssistantSettings={onOpenAssistantSettings}
                onRequestFullScreen={onOpenFullScreen}
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
      className={`flex-1 min-h-0 flex ${stacked ? 'flex-col' : 'flex-row'}`}
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
        className={`shrink-0 flex items-center justify-center bg-border hover:bg-accent/60 transition-colors touch-none select-none ${
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
}

/**
 * The small per-pane header: what this pane shows (with a picker), plus swap,
 * close, maximize and open-split controls.
 */
const PaneHeader: React.FC<PaneHeaderProps> = ({
  index, slot, split, maximized, setState, onCloseSplit,
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

  const label =
    slot.kind === 'dashboard' ? 'Dashboard'
      : slot.kind === 'assistant' ? 'Assistant'
        : slot.kind === 'notes'
          ? topics.find((t: Topic) => t.id === slot.topicId)?.title ?? 'Notes'
          : pdfs.find((p: Resource) => p.id === slot.resourceId)?.title ?? 'PDF preview';

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-bg-elevated/40 shrink-0">
      <select
        aria-label={`Pane ${index + 1} content`}
        value={slot.kind}
        onChange={(e) => select({ kind: e.target.value as PaneSlot['kind'] })}
        className="min-w-0 max-w-[9rem] bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-[11px] font-semibold text-content-primary outline-none focus:border-accent"
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
          className="min-w-0 flex-1 bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-[11px] text-content-primary outline-none focus:border-accent"
        >
          <option value="">{slot.kind === 'pdf' ? 'Choose a file…' : 'Choose a topic…'}</option>
          {slot.kind === 'pdf'
            ? (pdfs as Resource[]).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)
            : (topics as Topic[]).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}

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
          <span className="hidden sm:inline text-[11px] text-content-tertiary truncate max-w-[10rem]">{label}</span>
          <button
            onClick={() => setState((s) => toggleMaximize(s, index))}
            aria-label={maximized ? `Restore pane ${index + 1}` : `Maximize pane ${index + 1}`}
            title={maximized ? 'Restore' : 'Maximize pane'}
            className={ico}
          >
            {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setState((s) => swapPanes(s))}
            aria-label={`Swap pane ${index + 1} with the other`}
            title="Swap panes"
            className={ico}
          >
            <ArrowLeftRight className="w-4 h-4" />
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

      {/* Close the whole overlay, leaving the active tab untouched. */}
      {split && onCloseSplit && (
        <button
          onClick={onCloseSplit}
          aria-label="Close split view"
          title="Close split view"
          className={ico}
        >
          <X className="w-4 h-4" />
        </button>
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
    </div>
  );
};

