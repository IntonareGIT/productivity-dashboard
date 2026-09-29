import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Columns2, Maximize2, Minimize2, PanelLeftClose, X } from 'lucide-react';
import { db } from '../../db/db';
import type { Resource, Topic } from '../../types';
import {
  addSecondPane, closePane, initialSplitState, setPane, toggleMaximize,
  type PaneSlot, type SplitState,
} from './splitModel';

export const ico = 'inline-flex items-center justify-center p-1.5 min-h-[30px] rounded-lg border border-transparent text-slate-300 hover:text-white hover:bg-slate-700/70 transition-colors shrink-0';

// The dropdowns sit on the opaque slate-900 header, so they use a solid dark
// treatment. A light translucent field on the dark bar both clashed and
// reintroduced the blur-glow the solid header exists to prevent.
const field = 'min-w-0 bg-slate-800 text-slate-100 border border-slate-600 rounded-lg px-1.5 py-1 text-[11px] outline-none focus:border-accent';

export 
/* ---------------- Pane header ---------------- */

interface PaneHeaderProps {
  index: number;
  slot: PaneSlot;
  split: boolean;
  maximized: boolean;
  setState: React.Dispatch<React.SetStateAction<SplitState>>;
  /**
   * The PDF-specific controls, supplied by the mounted viewer. The viewer owns
   * page/zoom/rotation state, so it must render its own controls — but they are
   * handed UP to this header rather than rendered in the viewer's own toolbar,
   * which is what keeps ONE header per pane. Null whenever the view is not a
   * PDF, so the controls appear and disappear with the view type.
   */
  pdfControls?: React.ReactNode;
}

/**
 * The per-pane header, rendered for EVERY pane kind: the view dropdown, the
 * document dropdown and the pane-level actions. The view and document dropdowns
 * are unconditional so the user is never stranded without a way out; only the
 * PDF-specific controls are conditional, and those are contributed by the
 * viewer itself through `pdfControls`.
 */
export const PaneHeader: React.FC<PaneHeaderProps> = ({
  index, slot, split, maximized, setState, pdfControls,
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

  // The current document, encoded so one dropdown can carry both kinds.
  const selectedDoc = slot.kind === 'pdf' && slot.resourceId
    ? `pdf:${slot.resourceId}`
    : slot.kind === 'notes' && slot.topicId
      ? `note:${slot.topicId}`
      : '';

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

      {/* The document dropdown is ALWAYS rendered, on every pane kind. It used
          to appear only for pdf/notes, which left an empty pane with just a
          view selector: picking "PDF preview" gave a pane whose only way
          forward was another round of navigation. Now the file can be chosen
          straight from the header, and choosing one also switches the pane to
          the matching kind, so no intermediate step is needed. */}
      <select
        aria-label={`Pane ${index + 1} document`}
        value={selectedDoc}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('pdf:')) select({ kind: 'pdf', resourceId: v.slice(4) });
          else if (v.startsWith('note:')) select({ kind: 'notes', topicId: v.slice(5) });
          else select({ kind: slot.kind === 'pdf' ? 'pdf' : 'notes' });
        }}
        className={`${field} w-[8rem] sm:w-[11rem] shrink-0`}
      >
        <option value="">Select file\u2026</option>
        {(pdfs as Resource[]).length > 0 && (
          <optgroup label="PDFs">
            {(pdfs as Resource[]).map((r) => (
              <option key={r.id} value={`pdf:${r.id}`}>{r.title}</option>
            ))}
          </optgroup>
        )}
        {(topics as Topic[]).length > 0 && (
          <optgroup label="Notes">
            {(topics as Topic[]).map((t) => (
              <option key={t.id} value={`note:${t.id}`}>{t.title}</option>
            ))}
          </optgroup>
        )}
      </select>
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
      {/* LEFT: view + document selectors, always present. */}
      <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
        {selectors}
      </div>

      {/* PDF-only controls, contributed by the viewer when a document is
          loaded. Empty for every other view, which is what makes this
          conditional rather than duplicated. */}
      {pdfControls && (
        <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
          {pdfControls}
        </div>
      )}

      {/* RIGHT: pane-level actions. */}
      <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">{actions}</div>
    </div>
  );
};

/**
 * The universal pane wrapper. EVERY pane kind — empty, dashboard, pdf, notes
 * and assistant — renders through this, so the header is always in exactly the
 * same place and switching view never moves it.
 *
 * The header is `flex-shrink-0` and the content is `flex-1 min-h-0`, which is
 * the pair that makes the content scroll INSIDE the pane. Without `min-h-0` the
 * content refuses to shrink below its own height, the pane grows instead of
 * scrolling, and the bottom cards go out of reach.
 */
export const PaneContainer: React.FC<PaneHeaderProps & { children: React.ReactNode }> = ({
  index, slot, split, maximized, setState, pdfControls, children,
}) => (
  <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="flex-shrink-0 w-full bg-slate-900 text-slate-100 border-b border-slate-800 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
      <div className="h-11 px-3 flex items-center gap-2 min-w-max justify-between">
        <PaneHeader
          index={index}
          slot={slot}
          split={split}
          maximized={maximized}
          setState={setState}
          pdfControls={pdfControls}
        />
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      {children}
    </div>
  </div>
);
