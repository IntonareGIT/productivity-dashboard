/**
 * Strict allowlist sanitizer for editor HTML.
 *
 * This is the security boundary for `contentHtml`: that value is written by the
 * editor, round-tripped through Dexie (and Dexie Cloud), and read back into
 * `dangerouslySetInnerHTML`. Pasted content is the attack path, so anything not
 * named here is DROPPED, and a dropped element keeps its text.
 *
 * Deliberately absent: `script`, `iframe`, `object`, `embed`, `form`, `img`,
 * `svg`, `style`, `link`, and every `on*` handler. There is no `href` or `src`
 * anywhere, which removes URL-based vectors (javascript:, data:) entirely rather
 * than trying to filter them.
 *
 * Implemented as a tag-regex pass over the string rather than via the DOM so it
 * runs identically in the browser and in the Node verify scripts, and so there
 * is exactly one implementation to audit.
 */

/** Tags that survive. Everything else is unwrapped to its text. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'span', 'div',
]);

/** Tags that are removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form']);

/** Elements the editor legitimately emits that carry no formatting meaning. */
const VOID_TAGS = new Set(['br', 'hr']);

const COLOR_TOKEN = /^var\(--note-c-(rose|orange|amber|green|teal|blue|purple|gray)\)$/;
const FONT_SIZE_TOKEN = /^(0\.85|1|1\.25|1\.6)em$/;
const ALIGN_TOKEN = /^(left|center|right)$/;

/**
 * Keep only the style declarations this app is allowed to emit.
 * Returns null when nothing survives, so the caller can drop the attribute.
 */
export function sanitizeStyleAttr(raw: string): string | null {
  const kept: string[] = [];
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().replace(/^["']|["']$/g, '').trim();
    if (!value) continue;

    if (prop === 'color') {
      if (COLOR_TOKEN.test(value)) kept.push(`color:${value}`);
      continue;
    }
    if (prop === 'font-size') {
      if (FONT_SIZE_TOKEN.test(value)) kept.push(`font-size:${value}`);
      continue;
    }
    if (prop === 'text-align') {
      if (ALIGN_TOKEN.test(value)) kept.push(`text-align:${value}`);
      continue;
    }
    // `font-weight`, `text-decoration` and anything else is dropped. They carry
    // no extra risk but no value either, and keeping the surface small is the
    // point of an allowlist.
  }
  return kept.length > 0 ? kept.join(';') : null;
}

/** Sanitize one tag. `null` means "remove the tag but keep its text". */
function sanitizeOneTag(tag: string): string | null {
  const m = tag.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)>?$/);
  if (!m) return null;
  const [, closing, nameRaw, attrsRaw] = m;
  const name = nameRaw.toLowerCase();

  if (DROP_WITH_CONTENT.has(name)) return null;

  // `b`/`i` are normalised to `strong`/`em` so the stored HTML has one spelling.
  const canonical = name === 'b' ? 'strong' : name === 'i' ? 'em' : name;

  if (!ALLOWED_TAGS.has(canonical)) return null;

  if (closing) return `</${canonical}>`;

  if (VOID_TAGS.has(canonical)) return `<${canonical}>`;

  // Self-closing form is not produced by the editor; normalise it away.
  const attrs = attrsRaw.replace(/\/\s*$/, '');

  // ONLY a `style` attribute is ever kept. `class`, `id`, `href`, `src` and every
  // `on*` handler are dropped by omission, which is why no filter list is needed.
  const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!styleMatch) return `<${canonical}>`;
  const style = sanitizeStyleAttr(styleMatch[2] ?? styleMatch[3] ?? '');
  return style ? `<${canonical} style="${style}">` : `<${canonical}>`;
}

/**
 * Sanitize a whole HTML string against the allowlist.
 *
 * `<script>`/`<style>` bodies are removed entirely (content included), everything
 * else outside the allowlist is unwrapped so its TEXT survives, and comments are
 * stripped. Text between tags is left untouched, so `&`/`<` handling is whatever
 * the producer already did.
 */
export function sanitizeEditorHtml(html: string): string {
  if (!html) return '';
  let out = html;

  // Remove dangerous containers WITH their content, before the tag pass, so a
  // `<script>alert(1)</script>` body cannot be re-emitted as stray text.
  out = out.replace(/<\s*(script|style|iframe|object|embed|svg|math|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // Same, for an unterminated one at the end of the string.
  out = out.replace(/<\s*(script|style|iframe|object|embed|svg|math|form)\b[\s\S]*$/gi, '');

  out = out.replace(/<!--[\s\S]*?-->/g, '');

  out = out.replace(/<\/?[a-zA-Z][^>]*>?/g, (tag) => sanitizeOneTag(tag) ?? '');

  // An empty wrapper is noise; the editor would not produce one.
  out = out.replace(/<(span|div)(\s[^>]*)?><\/\1>/g, '');
  return out;
}

/** Plain text from editor HTML, for search and for the AI note tools. */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return sanitizeEditorHtml(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|blockquote|pre)\s*>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
