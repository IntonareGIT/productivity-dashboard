/**
 * The one place that turns a formula into markup.
 *
 * This is the seam the project already had as `renderLatex` in
 * `MarkdownNotes.tsx`, extracted so BOTH the read view and the editor share it.
 * Nothing else in the app formats maths, so replacing this function (and adding a
 * real parser) is the whole of a future KaTeX migration.
 *
 * It styles the formula; it does not typeset it. That is deliberate and
 * unchanged: there is no engine yet, and an engine swap must not require
 * touching storage, the toolbar, or the sanitizer.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Shared class so the editor and the read view look identical. */
export const MATH_CLASS = 'note-math';

/**
 * Render a formula SOURCE (no `$` delimiters) to styled HTML.
 *
 * `display` switches the block padding/background. Both variants keep the source
 * visible, because without a real engine a typeset-looking-but-wrong result would
 * be worse than honest plain text.
 */
export function renderLatexSource(source: string, display = false): string {
  const body = esc(String(source ?? ''));
  if (!body) return '';
  return display
    ? `<span class="${MATH_CLASS} ${MATH_CLASS}-block" data-latex="${esc(source)}">${body}</span>`
    : `<span class="${MATH_CLASS}" data-latex="${esc(source)}">${body}</span>`;
}

/**
 * Class names the theme stylesheet uses for a rendered formula.
 * Kept here so the editor, the read view and the CSS cannot drift.
 */
export const NOTE_MATH_CLASS = MATH_CLASS;
