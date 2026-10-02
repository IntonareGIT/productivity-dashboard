import { Node, mergeAttributes } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CALLOUT_VARIANTS, CALLOUTS, type CalloutVariant } from './noteFormatShared';

/** Shown in a freshly inserted, still-empty callout so the box is not blank. */
export const CALLOUT_PLACEHOLDER = 'Type your note here...';

/**
 * The callout block: a bordered, tinted container wrapping editable prose.
 *
 * Implemented as a real block node with a `content: 'block+'` hole rather than as
 * a paragraph that happens to carry a background. The difference matters in edit
 * mode: as a node, the whole box is one unit, so clicking it selects the box
 * rather than half a paragraph, and the text inside stays ordinary editable
 * content that can itself be bold, coloured or highlighted.
 *
 * The variant is stored as `data-callout` because the sanitizer drops `class`,
 * and that is the only data attribute its allowlist knows for this node. No
 * inline colour is emitted at all: the painting is CSS selected by
 * `[data-callout="..."]`, so a box follows the light and dark theme variables
 * without the stored HTML carrying a value that can only be right in one mode.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'note' as CalloutVariant,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-callout');
          return v && (CALLOUT_VARIANTS as readonly string[]).includes(v)
            ? (v as CalloutVariant)
            : 'note';
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-callout': attrs.variant as string,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      /**
       * Wrap ONLY THE SELECTED TEXT in a callout.
       *
       * This is deliberately NOT `wrapIn`. `wrapIn` wraps the entire block the
       * cursor happens to be in, so highlighting three words inside a long
       * paragraph produced a callout around the whole paragraph — the "applies
       * too broadly" behaviour.
       *
       * Instead the block is SPLIT at both ends of the selection so the chosen
       * text becomes a block of its own, and only that block is wrapped. Text
       * before the selection and text after it stay outside the box, in their own
       * ordinary paragraphs.
       *
       * Split order matters and is easy to get wrong: the END is split first,
       * because splitting at the start would shift the end position. Positions
       * are only recomputed once, after both splits.
       */
      setCallout:
        (variant: CalloutVariant) =>
        ({ state, dispatch, chain }: CommandProps) => {
          const { selection } = state;
          const { from, to, empty } = selection;
          const $from = state.doc.resolve(from);
          const $to = state.doc.resolve(to);

          // EMPTY STATE: a bare cursor, no highlighted text. Insert a new empty
          // callout carrying placeholder text at the cursor's position, rather
          // than boxing the paragraph the cursor is sitting in.
          if (empty) {
            return chain()
              .focus()
              .insertContent({
                type: this.name,
                attrs: { variant },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: CALLOUT_PLACEHOLDER }] },
                ],
              })
              .run();
          }

          // MULTI-BLOCK selection: the selection already covers whole blocks, so
          // wrapping the range directly is already the correct scope.
          if ($from.parent !== $to.parent) {
            return chain().focus().wrapIn(this.name, { variant }).run();
          }

          // SINGLE-BLOCK selection: split it into up to three blocks and wrap the
          // middle one.
          //
          // Split order matters: the END is split first, because splitting at the
          // START would push the end position out from under us.
          //
          // Both splits and the new selection go into ONE transaction via a
          // single `command` step. Running them on a scratch transaction to
          // "preview" the numbers is the trap here: the real chain starts from
          // the ORIGINAL document, where those positions still sit inside one
          // paragraph, so the wrap silently swallowed the text before the
          // selection as well.
          const splitEnd = $to.end() > to;
          const splitStart = $from.start() < from;
          // A split at `from` inserts a boundary there, pushing everything after
          // it forward by one position.
          const midEnd = splitStart ? to + 1 : to;

          if (midEnd <= from) {
            // Nothing survived the splits; fall back to boxing the whole block.
            return chain().focus().wrapIn(this.name, { variant }).run();
          }

          return chain()
            .command(({ tr }) => {
              // Only split where the selection actually stops short of a block
              // boundary; splitting at an existing boundary is a no-op that
              // would corrupt the position arithmetic.
              if (splitEnd) tr.split(to);
              if (splitStart) tr.split(from);

              // Map the ORIGINAL endpoints through the transaction rather than
              // computing offsets by hand.
              //
              // Hand arithmetic is wrong here and fails quietly: a split does not
              // move positions by one, it inserts a node boundary AND the new
              // block's opening token, so the selected text lands at `from + 2`
              // while the same text at the end of a block lands at `to + 2`.
              // `tr.mapping` is the authoritative record of both splits.
              //
              // `TextSelection.near` then snaps each mapped point to a valid
              // position INSIDE the intended block: `+1` biases forward for the
              // start so the caret does not land on the block boundary, and `-1`
              // biases backward for the end so it does not reach into the next
              // block.
              const from2 = tr.mapping.map(from, 1);
              const to2 = tr.mapping.map(to, -1);
              tr.setSelection(TextSelection.create(
                tr.doc,
                TextSelection.near(tr.doc.resolve(from2), 1).from,
                TextSelection.near(tr.doc.resolve(to2), -1).to,
              ));
              return true;
            })
            .wrapIn(this.name, { variant })
            .run();
        },

      /** Remove the callout wrapper but keep its text. */
      unsetCallout:
        () =>
        ({ commands }: CommandProps) =>
          commands.lift(this.name),
    };
  },
});

/** Human labels for the toolbar, kept next to the node that renders them. */
export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  formula: CALLOUTS.formula.label,
  warning: CALLOUTS.warning.label,
  note: CALLOUTS.note.label,
};

/** The colour pair each variant paints with, for `noteEditor.css`. */
export const CALLOUT_COLORS: Record<CalloutVariant, { border: string; fill: string }> = {
  formula: { border: CALLOUTS.formula.border, fill: CALLOUTS.formula.fill },
  warning: { border: CALLOUTS.warning.border, fill: CALLOUTS.warning.fill },
  note: { border: CALLOUTS.note.border, fill: CALLOUTS.note.fill },
};