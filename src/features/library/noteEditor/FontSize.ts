import { Extension } from '@tiptap/core';

/**
 * Font size as a text style mark.
 *
 * Tiptap has no built-in font size, and the obvious alternative (a Node
 * extension storing an attribute) fights the `TextStyle` mark that colour and
 * underline already use. So this is a mark in the same family: it renders a
 * `<span style="font-size:…">` and composes with colour instead of replacing it.
 *
 * The value is deliberately NOT free-form. `FONT_SIZES` is the single allowlist,
 * enforced in `addAttributes`, because this string ends up in stored HTML that is
 * later re-rendered through `dangerouslySetInnerHTML`. Accepting arbitrary CSS
 * here would reopen the injection hole the note sanitizer exists to close.
 */
export const FONT_SIZES = [
  { label: 'Small', value: '0.85em' },
  { label: 'Normal', value: '1em' },
  { label: 'Large', value: '1.25em' },
  { label: 'Huge', value: '1.6em' },
] as const;

const ALLOWED = new Set<string>(FONT_SIZES.map((s) => s.value));

export interface FontSizeOptions {
  /** Applied when a selection has no explicit size. */
  defaultSize: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return { defaultSize: '1em' };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              // Read back the allowlisted value only; anything else is ignored so
              // pasted markup cannot smuggle in a font-size.
              const raw = (element as HTMLElement).style?.fontSize ?? '';
              return ALLOWED.has(raw) ? raw : null;
            },
            renderHTML: (attributes) => {
              const size = attributes.fontSize as string | null;
              if (!size || !ALLOWED.has(size)) return {};
              return { style: `font-size:${size}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          // An unknown size is a no-op rather than a throw: a stale toolbar must
          // never be able to corrupt a note.
          ALLOWED.has(size) ? chain().setMark('textStyle', { fontSize: size }).run() : false,
      unsetFontSize:
        () =>
        ({ chain }) =>
          // `unsetAllMarks` rather than clearing only the attribute, so "Normal"
          // also drops any leftover colour on the same run rather than leaving
          // an empty <span> behind.
          chain().setMark('textStyle', { fontSize: null }).unsetAllMarks().run(),
    };
  },
});
