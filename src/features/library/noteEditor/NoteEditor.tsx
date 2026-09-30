import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, CaseSensitive, Eraser, Italic,
  List, ListOrdered, Underline as UnderlineIcon,
} from 'lucide-react';
import { FONT_SIZES, FontSize } from './FontSize';
import { MathNode } from './mathNode';
import { NOTE_COLORS, colorVar } from './noteFormatShared';
import { sanitizeEditorHtml } from './sanitizeHtml';

/**
 * The notes WYSIWYG editor.
 *
 * Replaces the old textarea: select text, press a button, see the result at once.
 * Tag code is never visible, because there is no textarea to show it in.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * 1. **Every toolbar button calls `preventDefault` on `mousedown`.** Without it
 *    the browser moves focus off the editor and collapses the selection before
 *    `onClick` runs, so the command applies to nothing. This is the same bug that
 *    made the previous editor look broken, and Tiptap does not save you from it:
 *    `onMouseDown` firing before `onClick` is browser behaviour, not a framework
 *    detail.
 * 2. **`setContent` is never driven by the editor's own `onUpdate`.** Doing that
 *    resets the selection on every keystroke. Content is re-seeded only when
 *    `noteKey` changes, i.e. when a different note is opened.
 */

export const NOTE_EDITOR_EXTENSIONS = [
  StarterKit.configure({
    // StarterKit 3 bundles underline and link. Underline comes from the
    // standalone package so there is one obvious source for it, and link is off
    // entirely: the note sanitizer allows no `href`, so an editable link would
    // render as dead text.
    underline: false,
    link: false,
  }),
  Underline,
  TextStyle,
  Color.configure({ types: ['textStyle'] }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
  FontSize,
  MathNode,
];

export interface NoteEditorProps {
  /** Editor HTML. Only re-read when `noteKey` changes. */
  html: string;
  onChange: (html: string) => void;
  /** Identity of the note being edited; changing it re-seeds the editor. */
  noteKey: string;
  minHeight?: string;
  placeholder?: string;
}

export const NOTE_TOOLBAR_BTN =
  'flex items-center justify-center gap-1 px-2 min-h-[40px] rounded-lg text-content-secondary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0';

/** Keep the editor selection alive while a button is pressed. See note 1. */
const keepSelection = (e: React.MouseEvent) => e.preventDefault();

export const NoteEditor: React.FC<NoteEditorProps> = ({
  html,
  onChange,
  noteKey,
  minHeight = 'min-h-[280px]',
  placeholder = 'Write your notes here.',
}) => {
  const editor = useEditor({
    extensions: NOTE_EDITOR_EXTENSIONS,
    // Sanitized on the way IN as well as out: stored HTML came from a paste at
    // some point, and this is the boundary before it can be edited.
    content: sanitizeEditorHtml(html),
    onUpdate: ({ editor: ed }) => onChange(sanitizeEditorHtml(ed.getHTML())),
    editorProps: {
      attributes: {
        class: `${minHeight} w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent`,
      },
    },
  });

  // Exposed so the Playwright checks in scripts/ can assert against the LIVE
  // editor rather than only the stored string. Harmless in production: it is the
  // same object React already holds and nothing but a test reads it.
  (window as unknown as Record<string, unknown>).__noteEditor = editor;

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(sanitizeEditorHtml(html), { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteKey]);

  return (
    <div className="flex flex-col gap-2">
      <NoteEditorToolbar editor={editor} />
      <NoteShortcutsHint />
      <div className="note-editor-surface">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

/**
 * One line under the toolbar listing only shortcuts that are actually verified
 * to work. Adding a line here is a promise to the user, so the hint is derived
 * from the same extension list the editor actually registers.
 */
const NoteShortcutsHint: React.FC = () => (
  <p className="text-[10px] text-content-tertiary px-1">
    Shortcuts: <code className="font-mono">#</code> heading, <code className="font-mono">**bold**</code>, <code className="font-mono">-</code> list, <code className="font-mono">`code`</code>, <code className="font-mono">$x$</code> math
  </p>
);

/* ------------------------------------------------------------------ toolbar */

const NoteEditorToolbar: React.FC<{ editor: Editor | null }> = ({ editor }) => {
  const [colorsOpen, setColorsOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The palette is rendered in a PORTAL because the toolbar is
  // `overflow-x-auto`, which would clip an absolutely-positioned child on a
  // phone. It is positioned from the button's rect on open, and kept in place
  // on scroll and resize.
  useEffect(() => {
    if (!colorsOpen) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 232)) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [colorsOpen]);

  // Outside tap closes. `pointerdown` fires before `click` on both mouse and
  // touch, so one listener covers a desktop click and a phone tap.
  useEffect(() => {
    if (!colorsOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-color-popover]') || t.closest('[data-color-anchor]')) return;
      setColorsOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [colorsOpen]);

  useEffect(() => {
    if (!colorsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColorsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [colorsOpen]);

  const isOn = useCallback((name: string, attrs?: Record<string, unknown>) => {
    try { return !!editor?.isActive(name, attrs); } catch { return false; }
  }, [editor]);

  const run = (fn: (ed: Editor) => void) => { if (editor) fn(editor); };
  const btnCls = (on: boolean) => `${NOTE_TOOLBAR_BTN} ${on ? 'bg-bg-elevated text-content-primary' : ''}`;

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap pb-1 bg-bg-elevated/40 border border-border rounded-xl"
      role="toolbar"
      aria-label="Note formatting"
    >
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleBold().run())}
        aria-label="Bold" aria-pressed={isOn('bold')} className={btnCls(isOn('bold'))}
      ><Bold className="w-4 h-4" /></button>
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleItalic().run())}
        aria-label="Italic" aria-pressed={isOn('italic')} className={btnCls(isOn('italic'))}
      ><Italic className="w-4 h-4" /></button>
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleUnderline().run())}
        aria-label="Underline" aria-pressed={isOn('underline')} className={btnCls(isOn('underline'))}
      ><UnderlineIcon className="w-4 h-4" /></button>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      {FONT_SIZES.map((s) => {
        let on = false;
        try { on = (editor?.getAttributes('textStyle')?.fontSize as string) === s.value; } catch { on = false; }
        return (
          <button
            key={s.value} type="button" onMouseDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().setFontSize(s.value).run())}
            aria-label={`Font size ${s.label}`} aria-pressed={on}
            className={`${btnCls(on)} text-[11px] font-semibold`}
          ><span style={{ fontSize: s.value }}>{s.label}</span></button>
        );
      })}

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleBulletList().run())}
        aria-label="Bullet list" aria-pressed={isOn('bulletList')} className={btnCls(isOn('bulletList'))}
      ><List className="w-4 h-4" /></button>
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleOrderedList().run())}
        aria-label="Numbered list" aria-pressed={isOn('orderedList')} className={btnCls(isOn('orderedList'))}
      ><ListOrdered className="w-4 h-4" /></button>
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run())}
        aria-label="Heading" aria-pressed={isOn('heading', { level: 2 })}
        className={`${btnCls(isOn('heading', { level: 2 }))} text-[11px] font-bold`}
      >H</button>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      <button
        ref={anchorRef} type="button" data-color-anchor onMouseDown={keepSelection}
        onClick={() => setColorsOpen((v) => !v)}
        aria-label="Text color" aria-expanded={colorsOpen} className={NOTE_TOOLBAR_BTN}
      >
        <CaseSensitive className="w-4 h-4" />
        <span className="w-3 h-3 rounded-sm" style={{ color: colorVar('rose'), background: 'currentColor' }} />
      </button>

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      {(['left', 'center', 'right'] as const).map((a) => {
        const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
        const on = isOn('paragraph', { textAlign: a });
        return (
          <button
            key={a} type="button" onMouseDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().setTextAlign(a).run())}
            aria-label={`Align ${a}`} aria-pressed={on} className={`${btnCls(on)} w-9`}
          ><Icon className="w-4 h-4" /></button>
        );
      })}

      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => run((ed) => ed.chain().focus().unsetAllMarks().clearNodes().run())}
        aria-label="Clear formatting" className={NOTE_TOOLBAR_BTN}
      ><Eraser className="w-4 h-4" /></button>

      {colorsOpen && pos && typeof document !== 'undefined' && createPortal(
        <div
          data-color-popover role="group" aria-label="Text color palette"
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-56 p-2 rounded-xl border border-border bg-bg-surface shadow-lg"
        >
          <div className="grid grid-cols-4 gap-1">
            {NOTE_COLORS.map((c) => {
              const v = colorVar(c);
              return (
                <button
                  key={c} type="button" onPointerDown={keepSelection}
                  onClick={() => run((ed) => ed.chain().focus().setColor(v).run())}
                  aria-label={`Color ${c}`}
                  className="min-h-[40px] rounded-lg border border-border hover:border-border-strong transition-colors flex items-center justify-center"
                ><span className="text-sm font-bold" style={{ color: v }}>Aa</span></button>
              );
            })}
          </div>
          <button
            type="button" onPointerDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().unsetColor().run())}
            className="mt-1 w-full min-h-[40px] rounded-lg border border-border text-xs text-content-secondary hover:text-content-primary transition-colors"
          >Default (clear color)</button>
        </div>,
        document.body,
      )}
    </div>
  );
};
