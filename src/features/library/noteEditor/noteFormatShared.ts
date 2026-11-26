/**
 * Palette shared by the editor and the legacy note formatter.
 *
 * Kept in its own module so the editor (which needs the names and the CSS var
 * helper) does not have to import the whole legacy `noteFormat`, which pulls in
 * the markdown tag builders that only the old textarea path still uses.
 */
export const NOTE_COLORS = [
  'red', 'rose', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'gray',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The only colour values the sanitizer will pass through. */
export const colorVar = (c: NoteColor): string => `var(--note-c-${c})`;

/**
 * Soft highlight backgrounds.
 *
 * Separate from `NOTE_COLORS` on purpose: a highlight is a BACKGROUND and a
 * colour is a FOREGROUND, and reusing one token for both would force the
 * sanitizer to accept arbitrary `background-color` values. These four names map
 * to four CSS variables, so the allowlist stays exactly as small as it was.
 */
export const NOTE_HIGHLIGHTS = ['yellow', 'red', 'green', 'blue'] as const;

export type NoteHighlight = (typeof NOTE_HIGHLIGHTS)[number];

export const highlightVar = (h: NoteHighlight): string => `var(--note-hl-${h})`;

/**
 * Callout variants, and the token each one paints with.
 *
 * A callout is a real block node, not a paragraph with a colour, because it has
 * to keep its own border, padding and background while the text inside it stays
 * editable prose. Keeping the variant in `data-callout` (rather than a class)
 * matters because the sanitizer drops `class`; `data-*` is on a narrow
 * allowlist for exactly this reason.
 */
export const CALLOUT_VARIANTS = ['formula', 'warning', 'note'] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export interface CalloutSpec {
  label: string;
  /** Left rule colour. */
  border: string;
  /** Very soft fill behind the text. */
  fill: string;
}

export const CALLOUTS: Record<CalloutVariant, CalloutSpec> = {
  // Key formula / maths: the accent colour, so it reads as "this matters".
  formula: {
    label: 'Key formula',
    border: 'var(--accent-primary)',
    fill: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
  },
  // Common exam and calculation errors. Red is a warning, so it is reserved.
  warning: {
    label: 'Warning / trap',
    border: 'var(--rose-500, #ef4444)',
    fill: 'color-mix(in srgb, #ef4444 10%, transparent)',
  },
  // A general definition, deliberately quieter than the other two.
  note: {
    label: 'Note / definition',
    border: 'var(--blue-500, #3b82f6)',
    fill: 'color-mix(in srgb, #3b82f6 10%, transparent)',
  },
};

/** Directional arrows for flowcharts and step-by-step derivations. */
export const ARROW_SYMBOLS = ['→', '⇒', '↔', '↑', '↓'] as const;

/**
 * Image layout modes inside a note.
 *
 * `inline` is the default and has no attribute at all, so an image is centred
 * and full width. The two floats carry `data-align`, which the sanitizer keeps,
 * and the CSS in `noteEditor.css` does the actual layout.
 */
export const NOTE_IMAGE_LAYOUTS = ['inline', 'left', 'right'] as const;

export type NoteImageLayout = (typeof NOTE_IMAGE_LAYOUTS)[number];

/** `null` means "no attribute", which is how inline/stacked is stored. */
export const imageAlignAttr = (l: NoteImageLayout): 'left' | 'right' | null =>
  l === 'inline' ? null : l;
