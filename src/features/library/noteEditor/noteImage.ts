import Image from '@tiptap/extension-image';
import type { CommandProps, Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';
import { imageAlignAttr, type NoteImageLayout } from './noteFormatShared';

/** The eight grab points. */
type Direction =
  | 'top' | 'right' | 'bottom' | 'left'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

const DIRECTIONS: Direction[] = [
  'topLeft', 'top', 'topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft', 'left',
];

/**
 * The four CORNERS, which scale proportionally. The four EDGES stretch freely.
 *
 * This is an EXPLICIT set rather than a shape test. The obvious shortcut,
 * `d.length > 4`, is wrong: 'right' is 5 characters and 'bottom' is 6, so both
 * would be classified as corners and every edge drag would silently lock the
 * aspect ratio — exactly the behaviour edges are supposed not to have.
 */
const CORNERS = new Set<Direction>(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
const isCorner = (d: Direction) => CORNERS.has(d);

/**
 * Smallest size an image may be dragged to.
 *
 * A hard floor, deliberately NOT tied to the image's starting size. Deriving
 * the floor from the current dimensions is what makes an image impossible to
 * shrink: every drag is clamped back to where it began, so it only grows.
 *
 * 50px is about one line of text tall. Below roughly 40px the 10px handles
 * start to overlap each other and the image can no longer be grabbed again,
 * which would strand the user with something they cannot select.
 */
const MIN_SIZE = 50;

interface ImgAttrs {
  src?: string; alt?: string | null; title?: string | null;
  width?: number | null; height?: number | null; align?: string | null;
}

/**
 * The image node view: an 8-handle resize box around a selectable image.
 *
 * NOT the stock `resize: { enabled: true }` option. That view has a single
 * `alwaysPreserveAspectRatio` flag shared by every handle, so it can only be
 * "corners and edges both lock the ratio" or "neither does". The behaviour
 * wanted here is per-handle, which the built-in cannot express:
 *
 *  - the four CORNERS scale proportionally, and
 *  - the four EDGES stretch freely in one axis only.
 *
 * Size is written to the node's own `width`/`height` attributes, which the stock
 * attribute set already declares, so a resized image survives save, reload and
 * the read-only preview with no separate storage.
 *
 * `NodeView` from prosemirror-view is an INTERFACE, not a base class, so this
 * implements it and owns `node`/`getPos`/`editor` itself.
 */
export class NoteImageView implements NodeView {
  dom: HTMLElement;

  /**
   * NULL, deliberately.
   *
   * An image is a LEAF: its schema declares no `content`, so there is nothing
   * for ProseMirror to render into a content hole. Handing it an `<img>` as
   * `contentDOM` does not put the image inside the wrapper — it makes ProseMirror
   * treat the `<img>` as the content node and append its own separator element
   * beside it, which adds a `ProseMirror-separator` class to the image, leaves
   * `src` empty, and leaves `naturalWidth` at 0. The image then exists in the
   * document but renders as a 0x0 broken box that cannot be resized or selected.
   *
   * With `contentDOM` null the wrapper owns the `<img>` outright and
   * `getPos()`/`update()` still work, which is all an atomic node needs.
   */
  contentDOM = null;

  private node: PMNode;
  private getPos: () => number | undefined;
  private editor: Editor;
  private img: HTMLImageElement;
  private frame: HTMLSpanElement;
  /** Set while a drag is in progress. */
  private dragging = false;

  constructor(node: PMNode, getPos: () => number | undefined, editor: Editor) {
    this.node = node;
    this.getPos = getPos;
    this.editor = editor;

    this.img = document.createElement('img');
    this.frame = document.createElement('span');
    this.frame.className = 'note-img-frame';
    this.frame.appendChild(this.img);

    // NOT draggable, and this is load-bearing for resizing.
    //
    // The Image node is declared `draggable: true`, so ProseMirror marks the
    // element as a drag source. Pressing a corner handle and dragging INWARD
    // keeps the pointer over the image, the browser starts a native HTML5 drag,
    // and it then stops delivering `pointermove` to the window listener that is
    // driving the resize. The resize simply never ran.
    //
    // Dragging OUTWARD moved the pointer off the image onto empty editor
    // background, no drag started, and growing appeared to work perfectly —
    // which is exactly the lopsided behaviour that makes this so confusing to
    // diagnose. Disabling the native drag makes both directions behave the same.
    this.img.draggable = false;
    this.frame.draggable = false;

    // Assigned here rather than as class fields: a field initialiser runs before
    // the constructor body, so it would capture `undefined` for `this.img`.
    this.dom = this.frame;

    this.applyAttributes(node);
    this.buildHandles();
  }

  private applyAttributes(node: PMNode) {
    const a = node.attrs as ImgAttrs;
    if (a.src) this.img.src = a.src;
    if (a.alt) this.img.alt = a.alt;
    if (a.title) this.img.title = a.title;

    // Only an EXPLICIT size is applied. A missing width/height must leave the
    // image at its natural size rather than at 0, or an unsized image vanishes.
    //
    // NEVER while a drag is running. ProseMirror can re-render the node mid-drag
    // (a selection change, a transaction from elsewhere), and re-running this
    // then stamps the STORED size straight back over the live one. The picture
    // springs back to its previous size on every frame, so the drag appears to
    // do nothing — and because the same code commits on pointerup, the resize is
    // then saved as the original dimensions rather than the new ones.
    if (!this.dragging) {
      this.img.style.width = a.width ? `${a.width}px` : '';
      this.img.style.height = a.height ? `${a.height}px` : '';
    }

    if (a.align) this.img.setAttribute('data-align', a.align);
    else this.img.removeAttribute('data-align');
  }

  /**
   * Build the eight handles.
   *
   * They sit on the WRAPPER rather than the image so their hit area stays a
   * fixed size while the image scales underneath. They are inert until the node
   * is selected: eight invisible boxes permanently over the text would make
   * clicking prose beside a picture start a resize.
   */
  private buildHandles() {
    for (const d of DIRECTIONS) {
      const h = document.createElement('span');
      h.className = `note-img-handle note-img-handle-${d}`;
      h.dataset.direction = d;
      h.setAttribute('aria-hidden', 'true');
      h.addEventListener('pointerdown', (e) => this.startDrag(e, d));
      this.frame.appendChild(h);
    }
  }

  /**
   * Tell ProseMirror to ignore events that land on a resize handle.
   *
   * This is not an optimisation, it is what makes resizing work at all. A
   * pointerdown inside the editor moves the selection, and a selection change
   * makes ProseMirror rebuild the node view — which REPLACES the wrapper and
   * every handle. The in-flight drag was then mutating a DETACHED `<img>`:
   * the picture on screen did not move, and the commit read `clientWidth` as 0
   * and silently bailed, so the resize vanished and was never saved.
   *
   * Returning true keeps the drag attached to the live element. Selection is
   * unaffected because the node was already selected before the drag began.
   */
  stopEvent(event: Event): boolean {
    // The WHOLE drag, not just the initial press.
    //
    // Guarding only the handle is not enough: once the pointer leaves the 10px
    // square, `event.target` is the image itself, ProseMirror starts handling
    // the move, and it re-renders the node — which re-runs `applyAttributes` and
    // stamps the STORED width back over the live one. The picture snapped back
    // to its old size on every frame, so shrinking appeared to do nothing while
    // growing still worked (it committed on pointerup, after the re-render).
    if (this.dragging) return true;

    const t = event.target as HTMLElement | null;
    return !!t && t.classList?.contains('note-img-handle');
  }
private startDrag(e: PointerEvent, dir: Direction) {
    e.preventDefault();
    e.stopPropagation();

    const pos0 = this.getPos();
    if (pos0 === undefined) return;

    // Measure the CURRENT rendered size, not the natural size: once a user has
    // stretched an image, the next proportional drag must respect the shape they
    // made rather than snapping back to the original photo's ratio.
    const el = this.dom.querySelector('img');
    const startW = (el?.clientWidth || el?.naturalWidth || MIN_SIZE);
    const startH = (el?.clientHeight || el?.naturalHeight || MIN_SIZE);
    const startX = e.clientX;
    const startY = e.clientY;
    const ratio = startW / startH;

    this.dragging = true;
    this.frame.classList.add('is-resizing');

    // Mutate the live element for instant feedback, and remember the size.
    //
    // The rendered size and the stored size are kept consistent by the
    // `this.dragging` guard in `applyAttributes`: ProseMirror owns this subtree
    // and will re-apply the STORED size over anything set here the moment it
    // re-renders, which is what made shrinking appear to do nothing — the image
    // sprang back to its starting size on every frame and the release then saved
    // those original dimensions.
    //
    // The size is remembered as a NUMBER rather than re-read from the DOM on
    // release. Reading `clientWidth` at that point is unreliable: the element can
    // have been re-created, in which case the read is 0 and the resize is
    // silently discarded.
    let lastW = 0;
    let lastH = 0;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let w = startW;
      let h = startH;

      if (dir.includes('right')) w = startW + dx;
      if (dir.includes('left')) w = startW - dx;
      if (dir.includes('bottom')) h = startH + dy;
      if (dir.includes('top')) h = startH - dy;

      if (isCorner(dir)) {
        // PROPORTIONAL: the larger axis leads and the other follows the ratio.
        // Leading with the larger axis is what makes a corner drag feel like
        // grabbing the picture, instead of the two axes fighting each other.
        if (w / ratio > h) h = w / ratio;
        else w = h * ratio;
      }
      // An EDGE deliberately falls through with NO ratio applied, so one axis can
      // be stretched while the other stays exactly where it was.

      // The floor is the constant MIN_SIZE, never the starting size. Deriving it
      // from the current dimensions is what makes an image impossible to shrink:
      // every drag would be clamped back to where it began.
      lastW = Math.max(MIN_SIZE, Math.round(w));
      lastH = Math.max(MIN_SIZE, Math.round(h));

      const img = this.dom.querySelector('img') ?? this.img;
      img.style.width = `${lastW}px`;
      img.style.height = `${lastH}px`;
      // An inline image sits on the text baseline, so a tall one is clipped by
      // the line box. Aligning to the middle keeps the surrounding text readable.
      img.style.verticalAlign = 'middle';
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);

      // Persist whatever the last move computed, BEFORE the guard is lifted --
      // otherwise `applyAttributes` would immediately repaint the stored size and
      // the commit would be too late to matter.
      if (lastW && lastH) {
        this.editor.chain().updateAttributes(this.node.type.name, { width: lastW, height: lastH }).run();
      }
      this.dragging = false;
      this.frame.classList.remove('is-resizing');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.applyAttributes(node);
    return true;
  }

  /**
   * Selection feedback. Handles become live only while THIS node is selected,
   * which is what stops a drag on nearby prose from resizing an image that
   * nobody touched.
   */
  selectNode(): void {
    this.frame.classList.add('is-selected');
  }

  deselectNode(): void {
    this.frame.classList.remove('is-selected');
  }

  /** True while dragging, so other pointer handling can stand down. */
  get isDragging(): boolean {
    return this.dragging;
  }
}

/**
 * Note image, with a layout mode attached.
 *
 * The stock Image node is extended rather than replaced so every one of its
 * defaults survives (inline rendering, drag handling, the paste handler). Only
 * one attribute is added: `data-align`.
 *
 * `data-align` rather than a class or an inline style, because the sanitizer
 * drops `class` and reduces `style` to a fixed token list that has no `float` in
 * it. Keeping the layout as a semantic attribute means the responsive
 * narrow-pane reset in `noteEditor.css` is pure CSS and needs no inline override
 * fighting it.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null as 'left' | 'right' | null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-align');
          return v === 'left' || v === 'right' ? v : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const a = imageAlignAttr(attrs.align as NoteImageLayout);
          // Inline/stacked stores nothing, so the default markup is unchanged.
          return a ? { 'data-align': a } : {};
        },
      },
    };
  },

  addCommands() {
    return {
      // CRITICAL. `this.parent?.()` MUST be spread here.
      //
      // `addCommands` REPLACES the parent extension's commands rather than
      // merging them. Returning only `setNoteImageAlign` silently deleted the
      // stock `setImage`, so the toolbar's upload button threw
      // "editor.chain().focus().setImage is not a function" while pasting still
      // worked, because paste goes through `parseHTML` and never touches the
      // command. This one spread is the difference between those two paths.
      ...this.parent?.(),

      /**
       * Float an image, or return it to the inline/stacked default.
       *
       * This changes the node's own attributes only. It never touches
       * neighbouring text, which is the whole point of `float`: the paragraph
       * flow continues around the image on its own.
       */
      setNoteImageAlign:
        (align: NoteImageLayout) =>
        ({ commands }: CommandProps) =>
          commands.updateAttributes('image', {
            align: imageAlignAttr(align),
          }),
    };
  },

  /**
   * An 8-handle resize box.
   *
   * NOT the stock `resize: { enabled: true }` option. That one has a single
   * `alwaysPreserveAspectRatio` flag shared by every handle, so it can only be
   * "corners and edges both lock the ratio" or "neither does". The behaviour
   * wanted here is per-handle: the four CORNERS scale proportionally, the four
   * EDGES stretch freely in one axis only. That distinction does not exist in the
   * built-in view, so the node view below implements it.
   *
   * Size lives in the node's own `width`/`height` attributes, which the stock
   * attribute set already declares, so a resized image persists through save,
   * reload and the read-only preview with no extra storage.
   */
  addNodeView() {
    return ({ node, getPos, editor }) => new NoteImageView(node, getPos, editor);
  },
}).configure({
  // INLINE. An inline image is a text-level node, so it can sit inside a
  // sentence: "as shown in [diagram], the gradient ...". A block image forces a
  // paragraph break on both sides and can only ever stand alone.
  //
  // Floating is unaffected: `float` promotes an inline-level box to block-level
  // formatting, which is exactly how square text wrap is implemented in CSS.
  inline: true,
  allowBase64: true,
});