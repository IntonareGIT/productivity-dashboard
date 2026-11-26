/**
 * Strict allowlist sanitizer for editor HTML.
 *
 * This is the security boundary for `contentHtml`: that value is written by the
 * editor, round-tripped through Dexie (and Dexie Cloud), and read back into
 * `dangerouslySetInnerHTML`. Pasted content is the attack path, so anything not
 * named here is DROPPED, and a dropped element keeps its text.
 *
 * Deliberately absent: `script`, `iframe`, `object`, `embed`, `form`, `svg`,
 * `style`, `link`, and every `on*` handler. There is no `href` anywhere. The one
 * URL-bearing attribute that remains is an image `src`, and it is confined by
 * `safeImageSrc` to raster `data:` images and same-origin `blob:` URLs, so it
 * cannot become a tracking pixel or a script vector. See that function for why
 * that trade was made and what it rules out.
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
  // `mark` is the highlight. It carries no behaviour of its own, so allowing the
  // tag cannot introduce anything; only its `style` is kept, and only for the
  // four background tokens.
  'mark',
  // `img` is the only tag that reintroduces a URL, and it is heavily constrained
  // below. See `safeImageSrc`.
  'img',
]);

/**
 * Image sources, and why the list is so short.
 *
 * The original rule was "no `href` or `src` anywhere, which removes URL-based
 * vectors (javascript:, data:) entirely". Notes now embed images, so a `src` is
 * unavoidable, and the decision is made explicit rather than by omission:
 *
 *  - `data:image/...` only, and only for the RASTER formats. `svg+xml` is
 *    deliberately excluded even though it is an image type: an SVG is a document
 *    that can carry scripts, and the point of this allowlist is that nothing in a
 *    note can execute. Rasters also cover the real case, a pasted screenshot.
 *  - `blob:` only. A file the user picked in this session arrives this way.
 *
 * Both are same-origin, in-memory, and cannot fetch a remote resource, so there
 * is no tracking pixel, no beacon and no outbound request. Everything else,
 * including `http(s):` and every scripting scheme, is rejected and the whole
 * `src` is dropped rather than rewritten, so the image fails visibly instead of
 * becoming a silent network call.
 */
export function safeImageSrc(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  if (/^blob:[a-z0-9-]+$/i.test(v)) return v;
  return null;
}

/** Tags that are removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form']);

/** Elements the editor legitimately emits that carry no formatting meaning. */
const VOID_TAGS = new Set(['br', 'hr']);

const COLOR_TOKEN = /^var\(--note-c-(red|rose|orange|amber|green|teal|blue|purple|gray)\)$/;
const HIGHLIGHT_TOKEN = /^var\(--note-hl-(yellow|red|green|blue)\)$/;
const FONT_SIZE_TOKEN = /^(0\.85|1|1\.25|1\.6)em$/;
const ALIGN_TOKEN = /^(left|center|right)$/;
/** `max-width:45%` / `max-width:100%`, used only by floated note images. */
const MAX_WIDTH_TOKEN = /^(45|100)%$/;

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
    // A highlight background is restricted to the four named tokens rather than
    // any colour, so it can never be used to repaint a page or hide text.
    if (prop === 'background-color') {
      if (HIGHLIGHT_TOKEN.test(value)) kept.push(`background-color:${value}`);
      continue;
    }
    if (prop === 'max-width') {
      if (MAX_WIDTH_TOKEN.test(value)) kept.push(`max-width:${value}`);
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

/**
 * The only `data-*` attributes that survive.
 *
 * `class` is dropped by design, so a callout and a floated image cannot carry
 * their variant in one. `data-` is the narrowest channel that works, and this
 * list is closed: each value is matched against a literal token below, so an
 * attacker cannot smuggle arbitrary data through an attribute name that happens
 * to start with `data-`.
 */
const ALLOWED_DATA_ATTRS: Record<string, RegExp> = {
  'data-callout': /^(formula|warning|note)$/,
  'data-align': /^(left|right)$/,
};

/** Extract one attribute value, quoted either way. */
function attrValue(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\s${name.replace(/[-]/g, '\\-')}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/**
 * Keep the allowlisted `data-*` attributes present on `tag`.
 *
 * Returns them already quoted and joined, ready to splice into the output, so
 * the caller does not have to know the quoting rules.
 */
export function safeDataAttrs(attrs: string): string {
  const kept: string[] = [];
  for (const [name, pattern] of Object.entries(ALLOWED_DATA_ATTRS)) {
    const raw = attrValue(attrs, name);
    if (raw === undefined) continue;
    const v = raw.trim();
    if (!pattern.test(v)) continue;
    // The token patterns admit no quotes or angle brackets, so this cannot break
    // out of the attribute; the escape is belt-and-braces.
    kept.push(`${name}="${v.replace(/["<>&]/g, '')}"`);
  }
  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

/**
 * Render an `img`, or return null to drop it.
 *
 * An image with no acceptable `src` is removed entirely rather than kept as a
 * broken element, so a pasted payload cannot leave a dangling box behind.
 */
function sanitizeImg(attrs: string): string | null {
  const src = safeImageSrc(attrValue(attrs, 'src'));
  if (!src) return null;
  const alt = (attrValue(attrs, 'alt') ?? '').replace(/["<>]/g, '').slice(0, 200);
  const style = sanitizeStyleAttr(attrValue(attrs, 'style') ?? '');
  const align = attrValue(attrs, 'data-align');
  const dataAlign = align && /^(left|right)$/.test(align.trim())
    ? ` data-align="${align.trim()}"`
    : '';

  // A resized image stores its size as the standard HTML `width`/`height`
  // attributes, which is where a resized image persists it. They are kept, but
  // only as bounded integers: an unbounded value could be used to lay out the
  // page (a huge width, or a negative one), so the range is capped at a size
  // larger than any real editor pane and floored at 1.
  const size = (name: string): string => {
    const raw = attrValue(attrs, name);
    if (raw === undefined) return '';
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) return '';
    const c = Math.round(Math.min(100000, Math.max(1, n)));
    return ` ${name}="${c}"`;
  };

  return `<img src="${src}" alt="${alt}"${dataAlign}${size('width')}${size('height')}${style ? ` style="${style}"` : ''}>`;
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

  // Self-closing form is not produced by the editor; normalise it away.
  const attrs = attrsRaw.replace(/\/\s*$/, '');

  // `img` is void AND carries a validated `src`, so it is handled here rather
  // than falling through to the generic attribute logic below.
  if (canonical === 'img') return sanitizeImg(attrs) ?? '';

  if (VOID_TAGS.has(canonical)) return `<${canonical}>`;

  // The `data-*` attributes are appended first, then `style`. `class`, `id`,
  // `href` and every `on*` handler are still dropped by omission, which is why
  // no filter list is needed for them.
  const data = safeDataAttrs(attrs);
  const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  const style = styleMatch ? sanitizeStyleAttr(styleMatch[2] ?? styleMatch[3] ?? '') : null;
  return `<${canonical}${data}${style ? ` style="${style}"` : ''}>`;
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
