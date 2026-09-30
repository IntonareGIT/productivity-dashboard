/**
 * Note formatting: the small inline-HTML subset the notes editor may emit, the
 * strict sanitizer that lets it through the renderer, and the pure text
 * transforms the toolbar uses.
 *
 * Markdown remains the STORAGE format. Formatting is stored as a tiny subset of
 * inline HTML inside the markdown source, so an existing note is untouched and
 * a note with no formatting renders exactly as it always did.
 *
 * The whole module is pure and dependency-free (no Dexie, no React) so the
 * toolbar, the renderer and the verification script all exercise the same code.
 *
 * SECURITY: the renderer feeds this module's output to
 * `dangerouslySetInnerHTML`. Only `span` and `div` survive, and inside them only
 * `color`, `font-size` and `text-align` — each against a fixed allowlist of
 * values. Every other tag, attribute and property is dropped. There is no `on*`
 * handler, no `href`/`src`, no `class`, and no `url()`.
 */

/* ------------------------------------------------------------------ palette */

/**
 * The eight palette slots.
 *
 * Each maps to a CSS custom property that themes.css defines SEPARATELY for
 * light and dark. That is what makes a color readable in BOTH themes: the note
 * stores `var(--note-c-rose)` and the theme resolves it to a darker shade on a
 * light background and a lighter one on a near-black one. A fixed hex cannot do
 * that — any single hex is either too dark on white or too pale on black.
 */
export const NOTE_COLORS = [
  'rose', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'gray',
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** The only color values the sanitizer will pass through. */
const COLOR_TOKEN = /^var\(--note-c-(rose|orange|amber|green|teal|blue|purple|gray)\)$/;

/* ------------------------------------------------------------ size presets */

export interface SizePreset {
  id: string;
  label: string;
  /** Must be in SIZE_VALUES or the sanitizer will strip it. */
  value: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'small', label: 'Small', value: '0.85em' },
  { id: 'normal', label: 'Normal', value: '1em' },
  { id: 'large', label: 'Large', value: '1.25em' },
  { id: 'huge', label: 'Huge', value: '1.6em' },
];

/** The only font-size values the sanitizer will pass through. */
const SIZE_VALUES = new Set(SIZE_PRESETS.map((p) => p.value));

/* ---------------------------------------------------------- text alignment */

export type Align = 'left' | 'center' | 'right';

export const ALIGNMENTS: { id: Align; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];

const ALIGN_VALUES = new Set<string>(['left', 'center', 'right']);

/* ------------------------------------------------------- tag construction */

/** `style` text for an inline run. Order is fixed so output is stable. */
function styleAttr(opts: { color?: string | null; size?: string | null; align?: Align | null }): string {
  const decls: string[] = [];
  if (opts.color) decls.push(`color:${opts.color}`);
  if (opts.size) decls.push(`font-size:${opts.size}`);
  if (opts.align) decls.push(`text-align:${opts.align}`);
  return decls.join(';');
}

export const spanTag = (opts: { color?: string | null; size?: string | null }): string =>
  `<span style="${styleAttr(opts)}">`;

export const divTag = (align: Align): string => `<div style="text-align:${align}">`;

export const colorVar = (c: NoteColor): string => `var(--note-c-${c})`;

/* -------------------------------------------------------- text transforms */

export interface Selection {
  start: number;
  end: number;
}

/**
 * Wrap the selected text, or insert the tags at the cursor when nothing is
 * selected. Returns the new text and the selection to restore, so the textarea
 * keeps the cursor where the user expects.
 */
export const wrapSelection = (
  text: string,
  sel: Selection,
  open: string,
  close: string,
): { text: string; selection: Selection } => {
  const a = Math.max(0, Math.min(sel.start, text.length));
  const b = Math.max(0, Math.min(sel.end, text.length));
  // A reversed range is normalised by SWAPPING rather than collapsing, so a
  // caller that reports the caret before the anchor still wraps the run
  // between them instead of inserting empty tags.
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const inner = text.slice(start, end);
  const next = text.slice(0, start) + open + inner + close + text.slice(end);
  // Keep the wrapped text selected so it can be restyled in one go.
  const at = start + open.length;
  return {
    text: next,
    selection: { start: at, end: at + inner.length },
  };
};

/** Remove every formatting tag, keeping all the text between them. */
export const unwrapFormatting = (text: string): string => text.replace(/<\/?\s*(span|div)\b[^>]*>/gi, '');

/**
 * "Clear formatting" for the toolbar.
 *
 * Also tidies the blank lines a block wrapper tends to leave behind, since
 * alignment wraps whole paragraphs and removing only the tags would otherwise
 * leave stray newlines where the `<div>` used to be.
 */
export const clearFormatting = (text: string): string =>
  unwrapFormatting(text)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');

/* -------------------------------------------------------------- sanitizer */

interface SanitizedTag {
  html: string;
  placeholder: string;
}

/**
 * Private-use sentinels bracket a placeholder. They are not produced by normal
 * typing, are not HTML, and survive `escapeHtml` and the markdown/latex regexes
 * untouched — so a tag can be held aside while the text around it is processed
 * and then re-inserted exactly where it was.
 */
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

const placeholderFor = (i: number) => `${PH_OPEN}${i}${PH_CLOSE}`;

/**
 * Pull every ALLOWED tag out of raw text and leave everything else as plain
 * text.
 *
 * Separating the two is what makes the pipeline safe: the remaining text is
 * escaped and markdown/math-processed exactly as before, and only tags that
 * passed the allowlist are ever re-inserted as markup. A rejected tag is
 * dropped but its TEXT survives, so an imported or hand-typed tag degrades to
 * plain text instead of eating the note's content.
 */
export const extractFormatting = (raw: string): { text: string; tags: SanitizedTag[] } => {
  const tags: SanitizedTag[] = [];
  let out = '';
  let cursor = 0;

  // Match ANY tag (and comments) so a disallowed one is consumed and dropped
  // rather than left in the text to be escaped into visible junk.
  const anyTag = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = anyTag.exec(raw)) !== null) {
    out += raw.slice(cursor, m.index);
    cursor = m.index + m[0].length;

    const clean = sanitizeTag(m[0]);
    if (clean) {
      const placeholder = placeholderFor(tags.length);
      out += placeholder;
      tags.push({ html: clean, placeholder });
    }
  }
  out += raw.slice(cursor);
  return { text: out, tags };
};

/** Put the sanitized tags back once the surrounding text has been rendered. */
export const restoreFormatting = (rendered: string, tags: SanitizedTag[]): string => {
  let out = rendered;
  for (const t of tags) out = out.split(t.placeholder).join(t.html);
  return out;
};

/**
 * Validate one tag against the allowlist, returning a normalized tag or null.
 *
 * Exported so the verification script can assert the rejection cases directly.
 */
export const sanitizeTag = (tag: string): string | null => {
  const m = tag.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)>?$/);
  if (!m) return null;
  const [, closing, nameRaw, attrsRaw] = m;
  const name = nameRaw.toLowerCase();

  // Only these two. Notably NOT script, iframe, a, img, style, object, form.
  if (name !== 'span' && name !== 'div') return null;
  if (closing) return `</${name}>`;

  // A self-closing `<span/>` is not in our subset; the toolbar never emits one,
  // so drop it rather than guess at the intent.
  if (/\/\s*>$/.test(tag)) return null;

  const style = sanitizeStyle(attrsRaw);
  if (style === null) return null;
  return `<${name} style="${style}">`;
};

/**
 * Reduce an attribute string to an allowlisted `style` value.
 *
 * Returns null when there is no `style` attribute (nothing worth keeping). Any
 * non-`style` attribute — `class`, `onclick`, `href`, anything at all — is
 * ignored, and any disallowed style property is dropped while the rest of the
 * declaration survives.
 */
export const sanitizeStyle = (attrsRaw: string): string | null => {
  const sm = attrsRaw.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!sm) return null;
  // Only the FIRST `style` attribute is considered. A second one is an
  // attempt to smuggle a declaration past the first, so it is ignored.
  const raw = (sm[1] ?? sm[2] ?? sm[3] ?? '').trim();
  if (!raw) return null;

  const kept: string[] = [];
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    // Also strip a wrapping pair of quotes that survived a sloppy attribute,
    // and any stray whitespace, so a value is judged on its own merits.
    const value = decl.slice(idx + 1).trim().replace(/^["']|["']$/g, '').trim();
    if (!value) continue;

    if (prop === 'color') {
      // A literal hex/rgb/named color is rejected on purpose: the palette vars
      // are the only allowed values, and that is what guarantees the color is
      // readable in both light and dark themes.
      if (COLOR_TOKEN.test(value)) kept.push(`color:${value}`);
      continue;
    }
    if (prop === 'font-size') {
      if (SIZE_VALUES.has(value)) kept.push(`font-size:${value}`);
      continue;
    }
    if (prop === 'text-align') {
      if (ALIGN_VALUES.has(value)) kept.push(`text-align:${value}`);
      continue;
    }
    // Everything else — background, position, expression, url(), … — is dropped.
  }
  // Nothing survived, so there is no formatting left to keep. Returning null
  // (rather than an empty `style=""`) means the tag is dropped entirely instead
  // of being re-inserted as a pointless element.
  return kept.length > 0 ? kept.join(';') : null;
};

