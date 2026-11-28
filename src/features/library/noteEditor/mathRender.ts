/**
 * The one place that turns a formula into markup, now typeset with KaTeX.
 *
 * Shared by the read view and the editor. Stored note HTML stays INERT
 * (`<span data-latex="..." data-display="...">source</span>`); the typeset markup
 * is generated here, after sanitizing, and never stored. KaTeX runs with
 * `trust: false` and `throwOnError: false`, so a bad formula shows its source
 * (in red) instead of breaking the note.
 *
 * Listen is unaffected: it reads the `data-latex` attribute, never the typeset
 * text, and says simple formulas in words or a cue for complex ones.
 */
import katex from 'katex';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unesc = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Shared class so the editor and the read view look identical. */
export const MATH_CLASS = 'note-math';

/** KaTeX markup for a formula source (no `$` delimiters). Falls back to escaped source. */
export function katexHtml(source: string, display = false): string {
  const src = String(source ?? '');
  try {
    return katex.renderToString(src, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'html',
      maxSize: 20,
      maxExpand: 200,
    });
  } catch {
    return esc(src);
  }
}

/** Render a formula SOURCE (no `$` delimiters) to a typeset, labelled wrapper. */
export function renderLatexSource(source: string, display = false): string {
  const src = String(source ?? '');
  if (!src.trim()) return '';
  const cls = display ? `${MATH_CLASS} ${MATH_CLASS}-block` : MATH_CLASS;
  return `<span class="${cls}" data-latex="${esc(src)}" data-display="${display}" role="math" aria-label="${esc(src)}">${katexHtml(src, display)}</span>`;
}

/**
 * Typeset every inert formula span in already-sanitized note HTML.
 * Matches only the exact shape the sanitizer emits.
 */
export function typesetMath(html: string): string {
  return html.replace(
    /<span\s+data-latex="([^"]*)"(?:\s+data-display="(true|false)")?[^>]*>[^<]*<\/span>/g,
    (_m, latex: string, display?: string) => renderLatexSource(unesc(latex), display === 'true'),
  );
}

/** Class name the theme stylesheet uses for a rendered formula. */
export const NOTE_MATH_CLASS = MATH_CLASS;
