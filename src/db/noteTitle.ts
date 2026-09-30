/**
 * Note-title rules.
 *
 * Deliberately separate from db.ts: these are pure string helpers with no Dexie
 * dependency. That keeps them directly testable, and stops a module that only
 * needs the title rules from pulling in the database (which several verify
 * scripts stub, and which touches `window`/`indexedDB` on import).
 */

/** The title a brand-new note gets. */
export const DEFAULT_NOTE_TITLE = 'Untitled note';

/**
 * The legacy placeholder every auto-created topic was given. Notes still
 * carrying it have no real title, so the migration derives one from content.
 */
export const LEGACY_NOTE_TITLE = 'General';

/** Longest derived title. A note's first line can be arbitrarily long. */
export const MAX_DERIVED_TITLE = 60;

/**
 * Derive a note title from its markdown body.
 *
 * Takes the FIRST NON-EMPTY line, strips the markdown syntax that would look
 * wrong in a one-line label (heading hashes, emphasis, list bullets, blockquote
 * and code fences, links), collapses whitespace, and trims to ~60 characters on a
 * word boundary. Returns the default when the note is empty or has no text.
 *
 * Used by the v9 migration so an existing note gets a real title without its
 * content being touched.
 */
export const deriveNoteTitle = (markdown: string | undefined | null): string => {
  const first = (markdown ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return DEFAULT_NOTE_TITLE;

  const cleaned = first
    .replace(/^\s*#{1,6}\s+/, '')          // ATX heading
    .replace(/^\s*>\s?/, '')               // blockquote
    .replace(/^\s*[-*+]\s+/, '')           // bullet list
    .replace(/^\s*\d+[.)]\s+/, '')         // ordered list
    .replace(/^\s*([-*_]\s*){3,}$/, '')    // horizontal rule
    .replace(/^\s*```.*$/, '')             // code fence
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')  // image
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link -> its text
    .replace(/[*_~`]+/g, '')               // emphasis / code spans
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return DEFAULT_NOTE_TITLE;
  if (cleaned.length <= MAX_DERIVED_TITLE) return cleaned;

  const cut = cleaned.slice(0, MAX_DERIVED_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a word boundary if it does not throw away most of the title.
  return `${(lastSpace > MAX_DERIVED_TITLE * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

/** True when a topic's title is still the generic legacy placeholder. */
export const needsTitleBackfill = (title: string | undefined | null): boolean => {
  const t = (title ?? '').trim();
  return t === '' || t === LEGACY_NOTE_TITLE;
};