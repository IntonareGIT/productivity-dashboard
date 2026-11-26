/**
 * Note-title rules.
 *
 * Deliberately separate from db.ts: these are pure string helpers with no Dexie
 * dependency. That keeps them directly testable, and stops a module that only
 * needs the title rules from pulling in the database (which several verify
 * scripts stub, and which touches `window`/`indexedDB` on import).
 */

/**
 * The default title, kept as the last-resort fallback for a note whose subject
 * cannot be found (a deleted subject, or a rename racing an edit).
 *
 * Prefer `getDefaultNoteTitle(subject)`, which produces the real per-subject
 * title. This constant only exists so nothing has to invent a string.
 */
export const DEFAULT_NOTE_TITLE = 'Untitled note';

/**
 * The legacy placeholder every auto-created topic was given.
 *
 * The v9 migration already replaced these with a title derived from the note's
 * first line, so a surviving one means the note was empty. It is kept because
 * the v15 migration has to recognise it too.
 */
export const LEGACY_NOTE_TITLE = 'General';

/**
 * How a note title reads when the user has not typed one.
 *
 * Exactly `<Subject name>'s Notes`, so "Thermodynamics" gives
 * "Thermodynamics's Notes". The awkward possessive is deliberate and matches
 * what the brief asks for: "fixing" it to "Thermodynamics Notes" would make the
 * title disagree with every string the user was given to look for.
 *
 * Pure, and takes the subject rather than an id, so the UI, the AI tools and the
 * migration all call ONE function and cannot drift.
 */
export const getDefaultNoteTitle = (subject: { name: string } | null | undefined): string =>
  subject && subject.name.trim() ? `${subject.name.trim()}'s Notes` : DEFAULT_NOTE_TITLE;

/**
 * A default title that no sibling note already uses.
 *
 * The first note in a subject is "<Subject>'s Notes". A second gets
 * "<Subject>'s Notes 2", a third "... 3", and so on. The number matters because
 * a note list and the file picker both show titles side by side: two identical
 * rows are as useless to the user as the duplicate file names this picker
 * already fixes.
 *
 * `taken` is the set of titles already in use, so the caller decides the scope
 * (all notes in a subject). Comparison is case-insensitive, because "notes" and
 * "Notes" are the same label to a person reading a list.
 *
 * The gap is filled rather than stopping at the first free number, so a set of
 * {"A's Notes", "A's Notes 3"} yields "A's Notes 2" rather than "A's Notes 4".
 */
export function uniqueDefaultNoteTitle(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());
  if (!used.has(base.trim().toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base} ${n}`.trim().toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/**
 * True when a note's title is one this app GENERATED rather than one the user
 * typed, so it may be rewritten when the subject is renamed.
 *
 * The check is textual and deliberate, so no new field is needed: a title is
 * "still ours" when it is the default for the subject's current name, or that
 * default with a number on the end ("X's Notes 2"). Anything else was typed,
 * or derived from content by the v9 migration, and is left alone forever.
 *
 * The number is returned so a rename can carry it across unchanged.
 */
export function generatedNoteTitleNumber(
  title: string | undefined | null,
  subjectName: string,
): number | null {
  const t = (title ?? '').trim();
  const base = getDefaultNoteTitle({ name: subjectName });
  if (t.toLowerCase() === base.toLowerCase()) return 1;
  const m = new RegExp(`^${escapeRegExp(base)}\\s+(\\d+)$`, 'i').exec(t);
  return m ? Number(m[1]) : null;
}

/** The same title for a specific number: 1 gives the bare default. */
export function noteTitleForNumber(subjectName: string, n: number): string {
  const base = getDefaultNoteTitle({ name: subjectName });
  return n <= 1 ? base : `${base} ${n}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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