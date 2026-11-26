import Highlight from '@tiptap/extension-highlight';
import type { CommandProps } from '@tiptap/core';
import { NOTE_HIGHLIGHTS, highlightVar } from './noteFormatShared';

/**
 * Soft highlighting.
 *
 * `multicolor: true` is what lets four background tones coexist in one note; the
 * stock extension is single-colour and would make the second highlight overwrite
 * the first.
 *
 * The commands wrap the stock ones so a colour can only ever be one of the four
 * approved tokens. The extension itself would happily set any CSS colour, and
 * the sanitizer would then strip it on the very next save, so the toolbar and
 * the sanitizer agreeing on one list is what keeps the two in step.
 */
export const SoftHighlight = Highlight.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      setSoftHighlight:
        (name: string) =>
        ({ commands }: CommandProps) => {
          const token = (NOTE_HIGHLIGHTS as readonly string[]).includes(name)
            ? highlightVar(name as (typeof NOTE_HIGHLIGHTS)[number])
            : null;
          // An unapproved name clears rather than sets something the sanitizer
          // would drop, so the visible state never lies about what is stored.
          return token ? commands.setHighlight({ color: token }) : commands.unsetHighlight();
        },
      unsetSoftHighlight:
        () =>
        ({ commands }: CommandProps) =>
          commands.unsetHighlight(),
    };
  },
}).configure({ multicolor: true });