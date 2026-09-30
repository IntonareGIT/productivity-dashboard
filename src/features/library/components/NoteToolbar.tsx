import React, { useCallback, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Baseline, CaseSensitive, Eraser,
} from 'lucide-react';
import {
  ALIGNMENTS, NOTE_COLORS, SIZE_PRESETS, clearFormatting, colorVar, divTag, spanTag,
  wrapSelection, type Align, type NoteColor, type Selection,
} from '../noteFormat';

const btn = 'flex items-center justify-center gap-1 px-2 min-h-[40px] rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0';

/**
 * Formatting toolbar for the notes editor.
 *
 * Owns no text: it reads and writes the editor through the imperative handle the
 * caller passes, so a formatting click never round-trips through a stale React
 * state value and the caret stays where the user put it.
 *
 * MOBILE: one horizontally scrolling row (`overflow-x-auto`, no wrapping) with a
 * 40px minimum touch height, so every control stays reachable by thumb instead of
 * wrapping into a tall unusable stack or clipping off the right edge.
 */
export interface NoteToolbarApi {
  /** Current text plus caret/selection inside the editor. */
  read: () => { text: string; selection: Selection };
  /** Replace the text and restore the caret. */
  write: (text: string, selection: Selection) => void;
}

export const NoteToolbar: React.FC<{ api: NoteToolbarApi }> = ({ api }) => {
  const wrap = useCallback((open: string, close: string) => {
    const { text, selection } = api.read();
    const next = wrapSelection(text, selection, open, close);
    api.write(next.text, next.selection);
  }, [api]);

  // Alignment is a BLOCK wrapper, so it applies to whole lines and the wrapped
  // region is put on its own lines to keep the markdown valid.
  const alignBlock = useCallback((align: Align) => {
    const { text, selection } = api.read();
    const start = Math.max(0, Math.min(selection.start, text.length));
    const end = Math.max(start, Math.min(selection.end, text.length));
    // With no selection, fall back to the whole current line.
    const from = start === end ? text.lastIndexOf('\n', start - 1) + 1 : start;
    const nl = text.indexOf('\n', end);
    const to = nl === -1 ? text.length : nl;

    const body = text.slice(from, to);
    if (body.trim() === '') return;
    const wrapped = `${divTag(align)}\n${body}\n</div>`;
    const next = text.slice(0, from) + wrapped + text.slice(to);
    api.write(next, { start: from, end: from + wrapped.length });
  }, [api]);

  const [showColors, setShowColors] = useState(false);

  return (
    // `overscroll-x-contain` stops a horizontal swipe here from firing the
    // browser's back gesture on a phone.
    <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap pb-1 bg-bg-elevated/40 border border-border rounded-xl">
      {/* ---- size ---- */}
      <span className="flex items-center gap-1 shrink-0" role="group" aria-label="Font size">
        <Baseline className="w-3.5 h-3.5 text-content-tertiary shrink-0" />
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => wrap(spanTag({ size: p.value }), '</span>')}
            aria-label={`Font size ${p.label}`}
            className={`${btn} text-[11px] font-semibold`}
          >
            <span style={{ fontSize: p.value }}>{p.label}</span>
          </button>
        ))}
      </span>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      {/* ---- alignment ---- */}
      <span className="flex items-center gap-1 shrink-0" role="group" aria-label="Text alignment">
        {ALIGNMENTS.map((a) => {
          const Icon = a.id === 'left' ? AlignLeft : a.id === 'center' ? AlignCenter : AlignRight;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => alignBlock(a.id)}
              aria-label={`Align ${a.label}`}
              className={`${btn} w-9`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </span>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      {/* ---- color: a popover of swatches, not 8 permanent buttons ---- */}
      <span className="relative shrink-0">
        <button
          type="button"
          onClick={() => setShowColors((v) => !v)}
          aria-label="Text color"
          aria-expanded={showColors}
          className={btn}
        >
          <CaseSensitive className="w-4 h-4" />
          <span className="w-3 h-3 rounded-sm" style={{ color: colorVar('rose'), background: 'currentColor' }} />
        </button>
        {showColors && (
          <>
            {/* A transparent full-screen catcher closes the popover on an outside
                tap, which is the only reliable way to do that on a phone. */}
            <button
              type="button"
              aria-label="Close colors"
              onClick={() => setShowColors(false)}
              className="fixed inset-0 z-20 cursor-default"
              tabIndex={-1}
            />
            <div
              role="group"
              aria-label="Text color palette"
              className="absolute left-0 z-30 mt-1 w-52 max-w-[calc(100vw-2rem)] p-2 rounded-xl border border-border bg-bg-surface shadow-lg"
            >
              <div className="grid grid-cols-4 gap-1">
                {NOTE_COLORS.map((c: NoteColor) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { wrap(spanTag({ color: colorVar(c) }), '</span>'); setShowColors(false); }}
                    aria-label={`Color ${c}`}
                    className="min-h-[40px] rounded-lg border border-border hover:border-border-strong transition-colors flex items-center justify-center"
                  >
                    <span className="text-sm font-bold" style={{ color: colorVar(c) }}>Aa</span>
                  </button>
                ))}
              </div>
              {/* "Default" clears the color by removing the wrapper entirely. */}
              <button
                type="button"
                onClick={() => setShowColors(false)}
                className="mt-1 w-full min-h-[40px] rounded-lg border border-border text-xs text-content-secondary hover:text-content-primary transition-colors"
              >
                Default (clear color)
              </button>
            </div>
          </>
        )}
      </span>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      {/* ---- clear all ---- */}
      <button
        type="button"
        onClick={() => {
          const { text, selection } = api.read();
          const next = clearFormatting(text);
          api.write(next, {
            start: Math.min(selection.start, next.length),
            end: Math.min(selection.end, next.length),
          });
        }}
        aria-label="Clear formatting"
        className={`${btn} shrink-0`}
      >
        <Eraser className="w-4 h-4" />
        Clear
      </button>
    </div>
  );
};
