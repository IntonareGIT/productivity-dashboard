import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Box, BoxSelect, CaseSensitive,
  ChevronDown, ChevronUp, Eraser, Highlighter, Image as ImageIcon, Italic, List,
  ListOrdered, MoveRight, Underline as UnderlineIcon,
} from 'lucide-react';
import { FONT_SIZES, FontSize } from './FontSize';
import { MathNode } from './mathNode';
import {
  ARROW_SYMBOLS, CALLOUTS, CALLOUT_VARIANTS, NOTE_COLORS, NOTE_HIGHLIGHTS,
  NOTE_IMAGE_LAYOUTS, colorVar, highlightVar,
} from './noteFormatShared';
import { Callout } from './calloutNode';
import { ListNesting } from './listNesting';
import { NoteImage } from './noteImage';
import { SoftHighlight } from './softHighlight';
import {
  AnchoredPopover, POPOVER_ITEM, keepSelection,
} from './AnchoredPopover';
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
    // Shift+Enter inside a list item must CONTINUE the item, not start a new
    // bullet. `keepMarks` makes the continuation inherit bold/colour/highlight
    // from the line above it instead of silently dropping them.
    hardBreak: { keepMarks: true },
  }),
  Underline,
  TextStyle,
  Color.configure({ types: ['textStyle'] }),
  // Alignment is restricted to the block types that actually carry a
  // `text-align`. A list item would otherwise take the alignment of whatever
  // paragraph happens to be active elsewhere in the selection, and a callout box
  // would align itself instead of the prose inside it — which is why the
  // paragraphs nested in a callout are aligned, not the box.
  TextAlign.configure({
    types: ['heading', 'paragraph'],
    // `justify` is included deliberately: it is the one alignment that is not
    // representable by a toolbar icon alone, and without it a user cannot make
    // a long note column readable.
    alignments: ['left', 'center', 'right', 'justify'],
  }),
  FontSize,
  MathNode,
  // Highlights, images and callouts, added for note formatting. Each is defined
  // in its own module because each one extends a Tiptap extension rather than
  // being a plain object, and keeping them here would bury the extension list.
  SoftHighlight,
  NoteImage,
  Callout,
  // Tab / Shift+Tab nesting and Shift+Enter soft breaks. Behaviour only, no
  // markup, so it carries no schema of its own.
  ListNesting,
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
  // The bar starts OPEN: a collapsed toolbar on first run looks like a broken
  // editor, and the whole point of collapsing is to reclaim space mid-task.
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [hlOpen, setHlOpen] = useState(false);
  const [calloutOpen, setCalloutOpen] = useState(false);
  const [arrowOpen, setArrowOpen] = useState(false);
  const [imgAlignOpen, setImgAlignOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const hlRef = useRef<HTMLButtonElement | null>(null);
  const calloutRef = useRef<HTMLButtonElement | null>(null);
  const arrowRef = useRef<HTMLButtonElement | null>(null);
  const imgAlignRef = useRef<HTMLButtonElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Positioning, outside-press and Escape handling all moved into
  // `AnchoredPopover`. Five dropdowns sharing one implementation is why the
  // behaviour cannot drift between the colour palette and the newer panels.

  const isOn = useCallback((name: string, attrs?: Record<string, unknown>) => {
    try { return !!editor?.isActive(name, attrs); } catch { return false; }
  }, [editor]);

  const run = (fn: (ed: Editor) => void) => { if (editor) fn(editor); };
  const btnCls = (on: boolean) => `${NOTE_TOOLBAR_BTN} ${on ? 'bg-bg-elevated text-content-primary' : ''}`;

  /**
   * Insert a picked image as a base64 data URL.
   *
   * The file is re-encoded through a canvas rather than read with
   * `FileReader.readAsDataURL`, for two reasons. First, `safeImageSrc` accepts
   * only the raster formats and only base64 payloads, and a canvas guarantees
   * both: a PNG for a JPEG, and no scripting format slipping through as some
   * other type. Second, a photo straight off a phone camera is 4000px wide and
   * several megabytes of base64 inside a note row that is synced whole on every
   * keystroke, so it is scaled to a sane maximum first.
   *
   * The object URL is revoked in the same tick; leaving it alive leaks the blob
   * for the life of the document.
   */
  const onPickImage = useCallback((file: File) => {
    if (!editor || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 1600px keeps a diagram crisp while staying small enough to store.
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      editor.chain().focus().setImage({ src: c.toDataURL('image/png'), alt: file.name }).run();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [editor]);

  return (
    <div
      // STICKY. The bar stays at the top of the pane while a long note scrolls,
      // so the formatting controls are never more than a glance away. `z-10`
      // lifts it above the note text; the opaque `bg-bg-surface` (rather than
      // the translucent elevated tone) is what stops the text showing through as
      // it scrolls underneath.
      className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap border-b border-border px-1 py-1"
      // Opaque background via the token directly. A sticky bar must be opaque or
      // the note text scrolls visibly underneath it, which is the whole reason to
      // hide it behind a background in the first place. Note the token here is
      // `var(--bg-surface)` rather than a `bg-bg-surface` class: the theme
      // exposes that name under `backgroundColor.bg.surface`, so the doubled
      // spelling used elsewhere in the codebase compiles to nothing and renders
      // transparent. Using the variable keeps this bar correct regardless.
      style={{ backgroundColor: 'var(--bg-surface)' }}
      role="toolbar"
      aria-label="Note formatting"
    >
      {/* COLLAPSE. When collapsed the bar keeps only this control, so the whole
          strip is reclaimed on a phone. It is rendered OUTSIDE the collapsible
          region so it is still reachable when everything else is hidden —
          otherwise there would be no way to expand again. */}
      <button
        type="button"
        onMouseDown={keepSelection}
        onClick={() => setToolbarExpanded((v) => !v)}
        aria-label={toolbarExpanded ? 'Collapse formatting bar' : 'Expand formatting bar'}
        aria-expanded={toolbarExpanded}
        aria-controls={toolbarExpanded ? 'note-formatting-options' : undefined}
        className={`${NOTE_TOOLBAR_BTN} w-9 shrink-0`}
      >
        {toolbarExpanded
          ? <ChevronUp className="w-4 h-4" />
          : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Every control lives inside this fragment, which is removed entirely when
          the bar is collapsed. Unmounting rather than hiding keeps the collapsed
          strip to a single button with no leftover focusable elements that a
          keyboard user would have to tab through. */}
      {toolbarExpanded && (
        <div id="note-formatting-options" className="contents">
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

      {(['left', 'center', 'right', 'justify'] as const).map((a) => {
        // Left/center/right get real icons. `justify` has no common glyph in
        // Lucide, so it is drawn as four stacked rules, which is exactly what
        // the alignment it produces looks like.
        const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : a === 'right' ? AlignRight : AlignJustify;
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

      {/* Insert an image. A hidden file input is the only way in: a button that
          opens a picker is the accessible, keyboard-reachable route, and paste
          arrives through Tiptap's own image node instead. */}
      <button
        type="button" onMouseDown={keepSelection}
        onClick={() => fileRef.current?.click()}
        aria-label="Insert image" className={NOTE_TOOLBAR_BTN}
      ><ImageIcon className="w-4 h-4" /></button>
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImage(f);
          // Reset so picking the SAME file twice still fires a change event.
          e.target.value = '';
        }}
      />

      {/* Image layout, shown only while an image is selected. Offering three
          buttons that silently do nothing otherwise is worse than hiding them. */}
      {isOn('image') && (
        <button
          type="button" onMouseDown={keepSelection}
          onClick={() => setImgAlignOpen((v) => !v)}
          aria-label="Image alignment" aria-expanded={imgAlignOpen}
          className={btnCls(imgAlignOpen)}
        ><MoveRight className="w-4 h-4" /></button>
      )}

      <span className="w-px h-5 bg-border shrink-0" aria-hidden />

      <button
        ref={hlRef} type="button" onMouseDown={keepSelection}
        onClick={() => setHlOpen((v) => !v)}
        aria-label="Highlight" aria-expanded={hlOpen}
        className={btnCls(hlOpen || isOn('highlight'))}
      ><Highlighter className="w-4 h-4" /></button>

      <button
        ref={calloutRef} type="button" onMouseDown={keepSelection}
        onClick={() => setCalloutOpen((v) => !v)}
        aria-label="Callout box" aria-expanded={calloutOpen}
        className={btnCls(calloutOpen || isOn('callout'))}
      ><Box className="w-4 h-4" /></button>

      {/* REMOVE CALLOUT. Only offered when the caret is actually inside a box.
          Showing it unconditionally would let a user "remove" a callout that
          does not exist. `unsetCallout` LIFTS the wrapper rather than deleting
          it, so the text is preserved and simply returns to ordinary paragraphs.
          It is deliberately not undo-by-delete: unwrapping is a formatting
          change, so it belongs in the same history as the other formatting. */}
      {isOn('callout') && (
        <button
          type="button" onMouseDown={keepSelection}
          onClick={() => run((ed) => ed.chain().focus().unsetCallout().run())}
          aria-label="Remove callout box"
          className={NOTE_TOOLBAR_BTN}
        ><BoxSelect className="w-4 h-4" /></button>
      )}

      <button
        ref={arrowRef} type="button" onMouseDown={keepSelection}
        onClick={() => setArrowOpen((v) => !v)}
        aria-label="Arrow symbols" aria-expanded={arrowOpen}
        className={NOTE_TOOLBAR_BTN}
      ><MoveRight className="w-4 h-4 -rotate-45" /></button>

      {/* ---- panels ---- */}
<AnchoredPopover
        open={colorsOpen} onClose={() => setColorsOpen(false)} anchorRef={anchorRef}
        label="Text color palette" anchorAttr="data-color-anchor" popoverAttr="data-color-popover"
      >
        <div className="grid grid-cols-5 gap-1">
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
      </AnchoredPopover>

      <AnchoredPopover
        open={hlOpen} onClose={() => setHlOpen(false)} anchorRef={hlRef}
        label="Highlight colour" anchorAttr="data-hl-anchor" popoverAttr="data-hl-popover" width={176}
      >
        {NOTE_HIGHLIGHTS.map((h) => (
          <button
            key={h} type="button" onPointerDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().setSoftHighlight(h).run())}
            aria-label={`Highlight ${h}`} className={`${POPOVER_ITEM} justify-between`}
          >
            <span>{h}</span>
            <span className="w-6 h-4 rounded-sm border border-border" style={{ background: highlightVar(h) }} aria-hidden />
          </button>
        ))}
        <button
          type="button" onPointerDown={keepSelection}
          onClick={() => run((ed) => ed.chain().focus().unsetSoftHighlight().run())}
          className={POPOVER_ITEM}
        >Clear highlight</button>
      </AnchoredPopover>

      <AnchoredPopover
        open={calloutOpen} onClose={() => setCalloutOpen(false)} anchorRef={calloutRef}
        label="Callout box" anchorAttr="data-callout-anchor" popoverAttr="data-callout-popover" width={224}
      >
        {CALLOUT_VARIANTS.map((v) => (
          <button
            key={v} type="button" onPointerDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().setCallout(v).run())}
            aria-label={CALLOUTS[v].label} className={POPOVER_ITEM}
          >
            {/* The swatch paints with the same tokens the box will use, so the
                menu previews the real thing in the current theme. */}
            <span className="w-1 h-4 rounded-sm shrink-0" style={{ background: CALLOUTS[v].border }} aria-hidden />
            {CALLOUTS[v].label}
          </button>
        ))}
      </AnchoredPopover>

      <AnchoredPopover
        open={arrowOpen} onClose={() => setArrowOpen(false)} anchorRef={arrowRef}
        label="Arrow symbols" anchorAttr="data-arrow-anchor" popoverAttr="data-arrow-popover" width={200}
      >
        <div className="grid grid-cols-5 gap-1">
          {ARROW_SYMBOLS.map((a) => (
            <button
              key={a} type="button" onPointerDown={keepSelection}
              onClick={() => run((ed) => ed.chain().focus().insertContent(a).run())}
              aria-label={`Insert ${a}`}
              className="min-h-[40px] rounded-lg border border-border text-content-primary hover:bg-bg-elevated transition-colors text-base"
            >{a}</button>
          ))}
        </div>
      </AnchoredPopover>

      <AnchoredPopover
        open={imgAlignOpen} onClose={() => setImgAlignOpen(false)} anchorRef={imgAlignRef}
        label="Image alignment" anchorAttr="data-imgalign-anchor" popoverAttr="data-imgalign-popover" width={216}
      >
        {NOTE_IMAGE_LAYOUTS.map((l) => (
          <button
            key={l} type="button" onPointerDown={keepSelection}
            onClick={() => run((ed) => ed.chain().focus().setNoteImageAlign(l).run())}
            aria-label={`Image ${l}`} className={POPOVER_ITEM}
          >{l === 'inline' ? 'Inline (stacked)' : `Float ${l}`}</button>
        ))}
      </AnchoredPopover>
        </div>
      )}
    </div>
  );
};
