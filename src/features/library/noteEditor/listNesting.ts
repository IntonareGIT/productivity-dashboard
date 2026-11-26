import { Extension } from '@tiptap/core';

/**
 * List ergonomics: nesting with Tab, and soft line breaks with Shift+Enter.
 *
 * Both bindings live in their own extension because they are BEHAVIOUR rather
 * than markup, and because `addKeyboardShortcuts` receives no editor instance
 * unless the handler is written against the command context — which is what the
 * `this` in `addOptions`/`addCommands` gives us.
 *
 * The binding is deliberately guarded on being inside a list. Without that
 * guard, Tab would be swallowed everywhere in the editor and a keyboard user
 * could never tab out of it, which is a real accessibility regression.
 */
export const ListNesting = Extension.create({
  name: 'listNesting',

  addKeyboardShortcuts() {
    return {
      /**
       * Tab nests the current item into a sub-list.
       *
       * `sinkListItem` returns false when the item cannot go deeper, and the
       * handler passes that straight through, so at the top level Tab keeps the
       * browser's own focus-movement behaviour rather than trapping the user.
       */
      Tab: () => this.editor.commands.sinkListItem('listItem'),

      /** Shift+Tab outdents back towards the top level. */
      'Shift-Tab': () => this.editor.commands.liftListItem('listItem'),

      /**
       * Shift+Enter is a SOFT break inside the current item.
       *
       * Plain Enter ends the item and starts a new bullet; a hard break keeps the
       * continuation in the SAME bullet, which is what a worked explanation
       * under a single point needs.
       *
       * `keepMarks` is configured on the HardBreak extension itself (via
       * StarterKit) rather than passed here, because `setHardBreak` takes no
       * arguments in Tiptap 3. With it set, bold, colour and highlight carry from
       * the first line onto the continuation; without it the break silently
       * drops the marks and the second line renders unformatted, which reads as a
       * random bug.
       */
      'Shift-Enter': () => this.editor.commands.setHardBreak(),
    };
  },
});