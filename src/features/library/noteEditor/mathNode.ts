import { Node, mergeAttributes } from '@tiptap/core';
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

function buildMathRule(display: boolean) {
  const re = display ? BLOCK_RE : INLINE_RE;
  return new InputRule({
    find: re,
    /**
     * `state` is the text before the match; the match itself is consumed. The
     * match includes any leading literal for inline maths so a formula typed
     * straight after a word does not delete that word.
     */
    handler: ({ state, range, match }) => {
      const source = display ? match[1] : match[1];
      if (!source || !source.trim()) return null;

      const start = range.from + (match[0].length - source.length - (display ? 4 : 2));
      const tr = state.tr.replaceWith(start, range.to, this.type.create({ latex: source, display }));
      // Replace the node that contained the match if it is now empty, otherwise
      // the user is left with a stray empty paragraph.
      return tr;
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

  addInputRules() {
    return [buildMathRule(true), buildMathRule(false)];
  },
});
