import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Columns2, Maximize2, Minimize2, PanelLeftClose, X } from 'lucide-react';
import { db } from '../../db/db';
import type { Resource, Topic } from '../../types';
import {
  addSecondPane, closePane, initialSplitState, setPane, toggleMaximize,
  type PaneSlot, type SplitState,
} from './splitModel';

/**
 * Pane chrome is built ENTIRELY from the app's theme tokens, never from
 * Tailwind's fixed `slate-*` palette. The header must follow whatever theme is
 * active — including the four status themes and the light/dark override — so
 * its background, text, borders and hover states all have to be token-driven.
 */
export const ico = 'inline-flex items-center justify-center p-1.5 min-h-[30px] rounded-lg border border-transparent text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0';

// The dropdowns sit on the header, so they use the elevated surface token rather
// than a fixed dark field — a hardcoded dark select on a light theme is exactly
// the contrast break this avoids. Opaque (not translucent) so it never lets the
// scrolling content show through.
const field = 'min-w-0 bg-bg-elevated text-content-primary border border-border-strong rounded-lg px-1.5 py-1 text-[11px] outline-none focus:border-accent';

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

      {/* PDF-ONLY controls, contributed by the mounted viewer. The viewer owns
          page/zoom/rotation state, so it renders these itself and publishes them
          up here rather than drawing a second toolbar of its own. They appear
          ONLY for a PDF view with a loaded document, which is what keeps this
          conditional rather than duplicated — the base controls above are always
          present whatever the pane is showing.

          The `border-l border-border` divider separates the base pane controls
          from the document controls and is token-driven, so it stays visible in
          light mode instead of vanishing like a hardcoded dark border would. */}
      {pdfControls && (
        <div
          className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap border-l border-border mx-2 pl-2"
          role="group"
          aria-label="PDF controls"
        >
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
    {/* The header bar. Theme-token driven so it follows the active theme and the
        light/dark override, and horizontally scrollable so a squeezed pane on a
        phone (or a narrow split half) can swipe to reach controls that would
        otherwise be clipped off-screen.

        `overscroll-x-contain` stops a horizontal flick from chaining out to the
        page behind the split, and the scrollbar is hidden in BOTH the WebKit
        and the standard-property form so the bar stays 44px tall on every
        browser. `min-w-max` on the inner row is what gives the scroller
        something wider than the pane to scroll through. */}
    <div className="flex-shrink-0 w-full bg-bg-surface text-content-primary border-b border-border overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
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
