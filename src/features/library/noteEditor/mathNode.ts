import { Node, mergeAttributes } from '@tiptap/core';
// ProseMirror's Node, under a different name: this file also extends Tiptap's own
// `Node`, and `Node` alone resolves to the Tiptap base class, which is not what
// `replaceWith` accepts.
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { InputRule } from '@tiptap/core';
import { renderLatexSource } from './mathRender';

/**
 * Math as an INLINE ATOM node.
 *
 * The editor shows `$x^2$` as maths rather than as literal dollar signs, and does
 * it without an engine: `renderLatexSource` is the only function that formats a
 * formula, shared with the read view. Adding KaTeX later means replacing that
 * one function; this node, the toolbar and storage do not move.
 *
 * It is an ATOM holding the literal source in `data-latex`. That is what keeps the
 * note round-trippable: search and the AI note tools read text back out, and a
 * formula must come out as `$x^2$` rather than as a pile of spans.
 *
 * Serialised output is deliberately INERT (`<span data-latex="…">source</span>`):
 * the formula is read from the attribute, and stored HTML is sanitized and
 * re-rendered on load, so the rendered markup never has to survive a round trip.
 */
export interface MathOptions {
  HTMLAttributes: Record<string, string>;
}

/** Matches `$$x$$` first, then `$x`. The trailing `$` is the trigger. */
const BLOCK_RE = /\$\$([^$\n]+?)\$\$$/;
const INLINE_RE = /\$([^$\n]+?)\$$/;

/**
 * Build an input rule for one maths delimiter style.
 *
 * `nodeType` is passed in EXPLICITLY rather than read from `this` inside the
 * handler: this is a plain module-level function, so an arrow-function handler
 * would capture an undefined `this` and throw "Cannot read properties of
 * undefined (reading 'type')" the first time anyone types a formula.
 *
 * The match groups are Tiptap's convention, not a normal regex's: `match[0]` is
 * the WHOLE text from the start of the line, `match[1]` is the part BEFORE the
 * formula, `match[2]` is the formula itself, and `match[3]` is the part after.
 * Using `match[1]` as the source (the obvious mistake) consumes the text in
 * front of the `$` and leaves a stray delimiter behind.
 */
function buildMathRule(
  nodeType: { create: (attrs: Record<string, unknown>) => ProseMirrorNode },
  display: boolean,
) {
  // The INLINE pattern refuses to match when a `$` sits on EITHER side of it.
  //
  // Tiptap runs an input rule's pattern against the text from the start of the
  // block, UNANCHORED, so it can match starting at the SECOND `$` of a `$$…$$`
  // block. The first lookbehind rejects that (the opening `$` is preceded by a
  // `$`); without it, typing `$$a+b$$` eats `a+b` as inline maths and leaves a
  // stray `$` on each side. Rule ORDER cannot fix this: by the time the block
  // pattern would be tried, the text no longer contains `$$`.
  const re = display
    ? /(\$)\$([^$]+?)\$\$/
    : /(?<!\$)(\$)([^\$\n][^$]*?)(?<!\$)\$/;
  return new InputRule({
    find: re,
    handler: ({ state, range, match }) => {
      // `match[2]` is the formula source; `match[1]` is the delimiter before it.
      const source = match[2];
      if (!source || !source.trim()) return null;
      // `range.from` already points AT the opening delimiter, so replacing
      // `[range.from, range.to)` takes both delimiters with it. Adding
      // `match[1].length` here would leave the opening `$` behind as stray text.
      return state.tr.replaceWith(range.from, range.to, nodeType.create({ latex: source, display }));
    },
  });
}

export const MathNode = Node.create<MathOptions>({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex') ?? '',
        renderHTML: (attributes) => ({ 'data-latex': String(attributes.latex ?? '') }),
      },
      display: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-display') === 'true',
        renderHTML: (attributes) => ({ 'data-display': String(!!attributes.display) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-latex]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const source = String(node.attrs.latex ?? '');
    return [
      'span',
      mergeAttributes(
        { 'data-latex': source, 'data-display': String(!!node.attrs.display) },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      // The SOURCE, not the rendered markup: stored HTML stays inert.
      source,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('span');
      dom.className = `note-math${node.attrs.display ? ' note-math-block' : ''}`;
      dom.setAttribute('data-latex', String(node.attrs.latex ?? ''));
      dom.setAttribute('data-display', String(!!node.attrs.display));
      // `contenteditable=false` keeps the atom from being edited into.
      dom.setAttribute('contenteditable', 'false');
      dom.innerHTML = renderLatexSource(String(node.attrs.latex ?? ''), !!node.attrs.display);
      Object.entries(HTMLAttributes).forEach(([k, v]) => {
        if (k !== 'class' && k !== 'data-latex' && k !== 'data-display') dom.setAttribute(k, v);
      });
      return { dom };
    };
  },

  // The INLINE pattern explicitly refuses a doubled delimiter.
  //
  // Input rules are tried in order and the inline form would otherwise match
  // inside `$$a+b$$`, consuming only part of it and leaving a stray `$` behind.
  // Ordering alone is not enough here because Tiptap retries the remaining text,
  // so the guard is written into the pattern: `([^$]...)` cannot start with `$`.
  addInputRules() {
    return [buildMathRule(this.type, true), buildMathRule(this.type, false)];
  },
});
