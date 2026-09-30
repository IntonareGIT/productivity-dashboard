/**
 * Palette shared by the editor and the legacy note formatter.
 *
 * Kept in its own module so the editor (which needs the names and the CSS var
 * helper) does not have to import the whole legacy `noteFormat`, which pulls in
 * the markdown tag builders that only the old textarea path still uses.
 */
export const NOTE_COLORS = [
  'rose', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'gray',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The only colour values the sanitizer will pass through. */
export const colorVar = (c: NoteColor): string => `var(--note-c-${c})`;
