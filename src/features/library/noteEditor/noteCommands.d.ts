import type { CalloutVariant, NoteImageLayout } from './noteFormatShared';

/**
 * Teaches TypeScript about the two command families the note toolbar adds.
 *
 * Tiptap has no runtime registry for these; without this declaration
 * `editor.commands.setCallout('warning')` simply does not type-check, and the
 * failure is at the call site rather than at the definition, which is the wrong
 * place to learn a command was never registered.
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant: CalloutVariant) => ReturnType;
      unsetCallout: () => ReturnType;
    };
    noteImage: {
      /** Move an image between inline, float-left and float-right. */
      setNoteImageAlign: (align: NoteImageLayout) => ReturnType;
    };
    // The key MUST match the object literal in `softHighlight.ts`, because that
    // key is the runtime command namespace. Declaring these under the stock
    // `highlight` key instead would merge with the extension's own declaration
    // and be dropped by TypeScript, silently losing both commands here.
    softHighlight: {
      /** Apply one of the four soft highlight backgrounds. */
      setSoftHighlight: (color: string) => ReturnType;
      /** Remove highlight, and colour, from the selection. */
      unsetSoftHighlight: () => ReturnType;
    };
  }
}

export {};