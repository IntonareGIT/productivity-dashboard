/**
 * Turning a note into something worth hearing.
 *
 * A note is markdown (or editor HTML) with maths, code and images mixed into the
 * prose. Read aloud as-is, a formula becomes a stream of symbols and a code
 * block becomes punctuation soup, so this module reduces a note to the sentences
 * a person would actually say. Formulas, fenced code and images are dropped;
 * links keep their words and lose their URL.
 *
 * Pure and DOM-free on purpose: the browser, the verification script and any
 * future test all run this same code, and it behaves identically in Node.
 */

export interface SpeechChunk {
  /** One utterance's worth of words, already cleaned of markup. */
  text: string;
  /** A heading, so the reader can leave a slightly longer gap before it. */
  heading?: boolean;
  /** Milliseconds to wait after this chunk: long enough to look at a formula. */
  pauseAfter?: number;
}

/** Sentences are cut at this length, comfortably under every engine's limit. */
const MAX_CHUNK = 220;

/** Below this, a fragment is merged into its neighbour instead of spoken alone. */
const MIN_CHUNK = 40;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', times: '×', deg: '°',
  le: '≤', ge: '≥', ne: '≠', plusmn: '±', minus: '−',
};

/** Decode the entities a note or the editor's HTML can realistically contain. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * A line that is really a formula rather than a sentence.
 *
 * Notes carry plenty of bare formulas outside `$..$` (a pasted working, a
 * symbol-only line). Spoken, "omega n equals root k over m" is worse than
 * silence, so a line dense in maths symbols and thin on letters is dropped.
 * The letter ratio is what keeps "k = 1.2 kN/m" (a value worth hearing) while
 * dropping "ω_n = √(k/m)".
 */
function looksLikeFormula(line: string): boolean {
  const dense = line.replace(/\s/g, '');
  if (!dense) return true;
  // Letters and digits are what a listener can use; operators and brackets are
  // what makes a line unreadable. "ω_n = √(k/m)" is 0.4 content, "k = 1.2 kN/m"
  // is 0.67, and a real sentence is far above both.
  const content = (line.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const hasMathSymbol = /[=<>≤≥±×÷√∑∫∂^_{}[\]\\]/.test(line);
  if (hasMathSymbol && content / dense.length < 0.55) return true;
  // A short line with an operator and no real word in it is a formula too:
  // "k = 1.2 kN/m" is worth saying in words, while "where k is the stiffness"
  // has words and is prose.
  return /[=<>≤≥±×÷√∑∫∂^_]/.test(line) && !/[A-Za-z]{4,}/.test(line);
}

/* ---------------------------------------------------------------- formulas */

/** Said instead of a formula we will not risk reading. */
export const FORMULA_CUE = 'formula here, look at the screen';

/** Said instead of an image with nothing to describe it. */
export const IMAGE_CUE = 'image here, look at the picture';

/** A pause long enough to look at the screen, in milliseconds. */
export const CUE_PAUSE_MS = 700;

/** Spoken names for the symbols a course note actually uses. */
const SYMBOL_WORDS: Record<string, string> = {
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
  '−': 'minus',
  '×': 'times',
  '·': 'times',
  '*': 'times',
  '/': 'over',
  '÷': 'divided by',
  '±': 'plus or minus',
  '<': 'less than',
  '>': 'greater than',
  '≤': 'less than or equal to',
  '≥': 'greater than or equal to',
  '≈': 'approximately',
  '≠': 'not equal to',
  '→': 'tends to',
  '∞': 'infinity',
  '%': 'percent',
  '°': 'degrees',
  '∂': 'partial',
  '(': 'open bracket',
  ')': 'close bracket',
  '.': 'point',
  ',': 'comma',
};

/** Greek letters, in LaTeX and in the plain characters a note may use. */
const GREEK: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'Delta',
  epsilon: 'epsilon', varepsilon: 'epsilon', zeta: 'zeta', eta: 'eta', theta: 'theta',
  Theta: 'Theta', iota: 'iota', kappa: 'kappa', lambda: 'lambda', Lambda: 'Lambda',
  mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', Pi: 'Pi', rho: 'rho', sigma: 'sigma',
  Sigma: 'Sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi', varphi: 'phi',
  Phi: 'Phi', chi: 'chi', psi: 'psi', Psi: 'Psi', omega: 'omega', Omega: 'Omega',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'Δ': 'Delta',
  'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'Θ': 'Theta',
  'κ': 'kappa', 'λ': 'lambda', 'Λ': 'Lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi',
  'π': 'pi', 'Π': 'Pi', 'ρ': 'rho', 'σ': 'sigma', 'Σ': 'Sigma', 'τ': 'tau',
  'φ': 'phi', 'Φ': 'Phi', 'χ': 'chi', 'ψ': 'psi', 'Ψ': 'Psi', 'ω': 'omega',
  'Ω': 'Omega',
};

/** Function names that are words rather than symbols. */
const FUNCTION_WORDS: Record<string, string> = {
  sin: 'sine', cos: 'cosine', tan: 'tangent', cot: 'cotangent', sec: 'secant',
  csc: 'cosecant', ln: 'natural log', log: 'log', exp: 'exponential',
  sinh: 'hyperbolic sine', cosh: 'hyperbolic cosine', tanh: 'hyperbolic tangent',
};

/** Unicode superscripts and subscripts a pasted formula may carry. */
const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', 'ⁿ': 'n' };
const SUBSCRIPT: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', 'ₙ': 'n' };

/** Everything that may remain once the LaTeX has been replaced with words. */
const ALLOWED = /^[A-Za-z0-9\s.,+\-=*/()<>±×·÷≤≥≈≠→∞%°∂α-ωΑ-Ω]+$/;

function exponentWords(raw: string): string | null {
  const inner = raw.trim();
  if (inner === '2') return 'squared';
  if (inner === '3') return 'cubed';
  if (/^[A-Za-z0-9]+$/.test(inner)) return `to the power of ${inner}`;
  return null;
}

/**
 * A formula, in words, or `null` when it is too complex to risk.
 *
 * The rule from Omar: read the simple ones out loud ("x equals m times a",
 * simple fractions, powers, subscripts, Greek names), and for anything else say
 * "formula here, look at the screen" instead. Reading a formula WRONGLY is worse
 * than not reading it, so this converter is deliberately narrow: it recognises a
 * fixed set of LaTeX constructs and returns `null` the moment anything is left
 * over that it does not understand (integrals, sums, matrices, primes, unknown
 * commands, leftover braces).
 */
export function formulaToWords(latex: string): string | null {
  let s = (latex ?? '').trim();
  if (!s) return null;
  // Whole classes of notation that are never "simple".
  if (/\\begin|\\end|\\sum|\\int|\\prod|\\lim|\\oint|\\iint|\\\\|&|\|/.test(s)) return null;
  // A prime is read as nothing at all, which would change the meaning.
  if (/'/.test(s)) return null;

  s = s.replace(/\\(left|right)\b/g, '');
  s = s.replace(/\\(quad|qquad|,|;|:|!)/g, ' ');

  // \frac, innermost first so \sqrt{\frac{k}{m}} works.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = s;
    s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (match, a: string, b: string) => {
      const left = wordsOfPlain(a);
      const right = wordsOfPlain(b);
      if (left === null || right === null) return match;
      if (left === '1' && right === '2') return 'one half';
      if (left === '1' && right === '3') return 'one third';
      if (left === '1' && right === '4') return 'one quarter';
      return `${left} over ${right}`;
    });
    if (s === before) break;
  }

  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (match, inner: string) => {
    const words = wordsOfPlain(inner);
    return words === null ? match : `square root of ${words}`;
  });
  // The plain character form a note may paste instead of \sqrt.
  s = s.replace(/√\s*\(([^()]*)\)/g, (match, inner: string) => {
    const words = wordsOfPlain(inner);
    return words === null ? match : `square root of ${words}`;
  });
  s = s.replace(/√\s*([A-Za-z0-9])/g, (match, inner: string) => `square root of ${inner}`);

  s = s.replace(/\\ddot\s*\{([^{}]*)\}/g, (match, inner: string) => `${plain(inner)} double dot`);
  s = s.replace(/\\dot\s*\{([^{}]*)\}/g, (match, inner: string) => `${plain(inner)} dot`);
  s = s.replace(/\\hat\s*\{([^{}]*)\}/g, (match, inner: string) => `${plain(inner)} hat`);
  s = s.replace(/\\(?:bar|overline)\s*\{([^{}]*)\}/g, (match, inner: string) => `${plain(inner)} bar`);
  s = s.replace(/\\(?:text|mathrm|mathit|operatorname)\s*\{([^{}]*)\}/g, (_match, inner: string) => ` ${inner} `);

  // Operators written as commands.
  s = s.replace(/\\(times|cdot)\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\(le|leq)\b/g, '≤')
    .replace(/\\(ge|geq)\b/g, '≥')
    .replace(/\\(ne|neq)\b/g, '≠')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\(to|rightarrow|Rightarrow)\b/g, '→')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\partial\b/g, '∂');

  // Greek letters and function names.
  // No \b here: in `\omega_n` the boundary between "a" and "_" is not a word
  // boundary, so a \b-anchored pattern would leave the whole command in place.
  s = s.replace(/\\([A-Za-z]+)/g, (match, name: string) => {
    if (GREEK[name]) return GREEK[name];
    if (FUNCTION_WORDS[name]) return FUNCTION_WORDS[name];
    return match; // left in place, and the leftover check below rejects it
  });

  // Powers and subscripts, after the commands above have become words.
  s = s.replace(/\^\{([^{}]+)\}/g, (match, inner: string) => {
    const words = exponentWords(inner);
    return words === null ? match : ` ${words}`;
  });
  s = s.replace(/\^([A-Za-z0-9])/g, (match, inner: string) => {
    const words = exponentWords(inner);
    return words === null ? match : ` ${words}`;
  });
  s = s.replace(/_\{([^{}]+)\}/g, (_match, inner: string) => ` sub ${plain(inner)}`);
  s = s.replace(/_([A-Za-z0-9])/g, (_match, inner: string) => ` sub ${inner}`);

  // Unicode superscripts and subscripts.
  s = s.replace(/[⁰¹²³⁴⁵⁶ⁿ]/g, (ch) => ` ${exponentWords(SUPERSCRIPT[ch]) ?? ch} `);
  s = s.replace(/[₀₁₂₃₄ₙ]/g, (ch) => ` sub ${SUBSCRIPT[ch]} `);

  if (!ALLOWED.test(s)) return null;

  // Now the string holds only letters, digits and known symbols.
  const words = wordsFromPlain(s);
  if (!words) return null;
  // A long string of loose symbols is not a simple formula.
  if (words.split(' ').length > 28) return null;

  return words
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn a cleaned formula string into words.
 *
 * Runs of letters and digits stay together as one word ("omega", "1.2" is two
 * tokens around the point); every other character must be a symbol we have a
 * spoken name for, or the whole formula is refused.
 */
function wordsFromPlain(src: string): string | null {
  const parts: string[] = [];
  let word = '';
  const flush = () => {
    if (word) { parts.push(word); word = ''; }
  };
  for (const ch of src) {
    if (/\s/.test(ch)) { flush(); continue; }
    if (/[A-Za-z0-9]/.test(ch)) { word += ch; continue; }
    const mapped = SYMBOL_WORDS[ch];
    if (!mapped) return null;
    flush();
    parts.push(mapped);
  }
  flush();
  return parts.length ? parts.join(' ') : null;
}

/** The plain text of a small LaTeX group, for use inside another construct. */
function plain(src: string): string {
  return src.replace(/\\[A-Za-z]+/g, (m) => GREEK[m.slice(1)] ?? FUNCTION_WORDS[m.slice(1)] ?? m).replace(/[{}]/g, '').trim();
}

/** Words for a group's contents, or null if it contains anything unknown. */
function wordsOfPlain(src: string): string | null {
  const inner = plain(src);
  if (!inner) return null;
  if (!ALLOWED.test(inner)) return null;
  return wordsFromPlain(inner);
}

/** Strip the inline markup a spoken sentence should not carry. */
function stripInline(input: string): string {
  let out = input;
  // An image is read by its alt text when it has one: that is the only
  // description of the picture the note carries.
  out = out.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_match, alt: string) => ` ${imageWords(alt)} `);
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                  // links keep their words
  out = out.replace(/`([^`]*)`/g, '$1');                              // inline code keeps its words
  out = out.replace(/<\/?[a-z][^>\n]*>/gi, ' ');                      // stray tags
  out = out.replace(/https?:\/\/\S+/g, ' ');                          // bare URLs
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_match, inner: string) => ` ${formulaWordsOrCue(inner)} `);
  // Inline maths, except a money amount: "$5" must survive, "$x^2$" must not.
  out = out.replace(/\$([^$\n]{1,200})\$/g, (match, inner: string) =>
    /^\s*\d[\d.,]*\s*$/.test(inner) ? match : ` ${formulaWordsOrCue(inner)} `);
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');                        // bold
  out = out.replace(/\*([^*\n]+)\*/g, '$1');                          // italic
  out = out.replace(/~~([^~]+)~~/g, '$1');                            // strike
  return out;
}

/** A formula's words, or the cue that sends the reader's eyes to the screen. */
function formulaWordsOrCue(source: string): string {
  return formulaToWords(source) ?? FORMULA_CUE;
}

/**
 * What to say for an image.
 *
 * The alt text is the caption a note carries, so it is read when it is real
 * prose. A filename or a bare URL is not a description, and then the reader is
 * sent to the picture itself.
 */
function imageWords(alt: string): string {
  const text = decodeEntities(alt ?? '').trim();
  const looksLikePath = !text
    || /^[\w./-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(text)
    || /^(https?:|data:|blob:|\/)/i.test(text)
    || /^[\w-]+$/.test(text);
  if (looksLikePath) return IMAGE_CUE;
  return `Image: ${text.replace(/[.!?]+$/, '')}.`;
}

/** Collapse the whitespace a stripped tag leaves behind. */
function tidy(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    // A formula that ends in a number leaves a space before the comma that
    // follows it in the sentence: "equals 0 , and" reads badly.
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Editor HTML to blocks, keeping headings.
 *
 * `contentHtml` comes from the rich-text editor, so its paragraphs, headings and
 * list items are real tags. Formulas arrive as `span.note-math` (the editor's
 * one maths seam) and images as `img`; both are dropped whole so their source
 * never leaks into speech.
 */
function htmlToBlocks(html: string): { text: string; heading: boolean; pause?: boolean }[] {
  let s = html;
  s = s.replace(/<(script|style|pre)\b[\s\S]*?<\/\1>/gi, ' ');
  // A maths span carries its source in `data-latex`, so the editor's formulas
  // are read (or cued) exactly like a markdown `$..$`.
  s = s.replace(/<span[^>]*class="[^"]*note-math[^"]*"[^>]*>[\s\S]*?<\/span>/gi, (match) => {
    const latex = /data-latex="([^"]*)"/.exec(match);
    return ` ${formulaWordsOrCue(latex ? decodeEntities(latex[1]) : '')} `;
  });
  s = s.replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
    const alt = /\balt="([^"]*)"/i.exec(attrs);
    return ` ${imageWords(alt ? decodeEntities(alt[1]) : '')} `;
  });
  // Headings get a sentinel so the line pass can still mark them as headings.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _level, inner: string) => `\u0001${inner}\u0002\n\n`);
  s = s.replace(/<li\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|li|blockquote|tr)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);

  const blocks: { text: string; heading: boolean; pause?: boolean }[] = [];
  for (const rawLine of s.split('\n')) {
    const headingMatch = rawLine.match(/\u0001([\s\S]*?)\u0002/);
    if (headingMatch) {
      const text = tidy(stripInline(headingMatch[1]));
      if (text) blocks.push({ text, heading: true });
      continue;
    }
    const text = tidy(stripInline(rawLine));
    if (text) blocks.push({ text, heading: false });
  }
  return blocks;
}

/** Markdown to blocks: fences, tables, lists and headings resolved line by line. */
function markdownToBlocks(markdown: string): { text: string; heading: boolean; pause?: boolean }[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: { text: string; heading: boolean; pause?: boolean }[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  let inBlockMath = false;
  let blockMath: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = tidy(stripInline(paragraph.join(' ')));
    if (text) blocks.push({ text, heading: false });
    paragraph = [];
  };

  /** A display formula: words when it is simple, otherwise the cue and a pause. */
  const pushFormulaBlock = (source: string) => {
    const words = formulaToWords(source);
    blocks.push(words
      ? { text: words, heading: false }
      : { text: FORMULA_CUE, heading: false, pause: true });
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Fenced code: dropped whole. Nobody wants a code block read out.
    if (trimmed.startsWith('```')) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // $$ ... $$ blocks, single- or multi-line: a display formula gets its own
    // utterance, in words when it is simple and a cue when it is not.
    if (!inBlockMath && trimmed.startsWith('$$')) {
      flushParagraph();
      const rest = trimmed.slice(2);
      if (rest.endsWith('$$') && rest.trim().length > 0) {
        pushFormulaBlock(rest.slice(0, -2));
        continue;
      }
      inBlockMath = true;
      blockMath = rest.trim() ? [rest] : [];
      continue;
    }
    if (inBlockMath) {
      const closes = trimmed.endsWith('$$');
      const piece = closes ? trimmed.slice(0, -2) : line;
      if (piece.trim()) blockMath.push(piece);
      if (closes) {
        inBlockMath = false;
        pushFormulaBlock(blockMath.join(' '));
        blockMath = [];
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Horizontal rule: a pause, not words.
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const text = tidy(stripInline(heading[1]));
      if (text) blocks.push({ text, heading: true });
      continue;
    }

    // Table rows: cells read as a comma-separated list, the pipe rule is silent.
    if (trimmed.includes('|')) {
      if (/^\|?[\s:|-]+\|?$/.test(trimmed)) continue;
      flushParagraph();
      const cells = trimmed.split('|').map((c) => tidy(stripInline(c))).filter(Boolean);
      if (cells.length) blocks.push({ text: cells.join(', '), heading: false });
      continue;
    }

    const bullet = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const text = tidy(stripInline(bullet[1]));
      if (text) blocks.push({ text, heading: false });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    paragraph.push(quote ? quote[1] : trimmed);
  }
  flushParagraph();
  return blocks;
}

/**
 * Sentence boundaries, decided by hand rather than by a regex.
 *
 * A period only ends a sentence when whitespace or the end of the text follows
 * it: "k = 1.2 kN/m" is one thing to say, not "k = 1." and "2 kN/m".
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ';') continue;
    const next = text[i + 1];
    if (next && !/\s/.test(next)) continue;
    out.push(text.slice(start, i + 1));
    start = i + 1;
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Cut a block into speakable sentences, merging scraps and splitting run-ons. */
function toChunks(block: { text: string; heading: boolean; pause?: boolean }): SpeechChunk[] {
  // A heading is spoken whole: "1. Fundamentals" cut at its own numbering reads
  // as "one" and then a separate fragment.
  if (block.heading) {
    const out: SpeechChunk[] = [];
    let rest = block.text;
    while (rest.length > MAX_CHUNK) {
      const cut = rest.lastIndexOf(' ', MAX_CHUNK);
      const at = cut > MIN_CHUNK ? cut : MAX_CHUNK;
      out.push({ text: rest.slice(0, at).trim(), heading: true });
      rest = rest.slice(at).trim();
    }
    if (rest) out.push({ text: rest, heading: true });
    return out.map((chunk) => (block.pause ? { ...chunk, pauseAfter: CUE_PAUSE_MS } : chunk));
  }

  const sentences = splitSentences(block.text);
  const out: string[] = [];
  for (const raw of sentences) {
    let sentence = raw.trim();
    if (!sentence) continue;
    // A run-on with no punctuation still has to fit one utterance.
    while (sentence.length > MAX_CHUNK) {
      const cut = sentence.lastIndexOf(' ', MAX_CHUNK);
      const at = cut > MIN_CHUNK ? cut : MAX_CHUNK;
      out.push(sentence.slice(0, at).trim());
      sentence = sentence.slice(at).trim();
    }
    if (!sentence) continue;
    const previous = out[out.length - 1];
    // Headings never merge: a heading spoken together with the sentence under
    // it stops being a heading.
    if (!block.heading && previous && previous.length < MIN_CHUNK) {
      out[out.length - 1] = `${previous} ${sentence}`;
    } else {
      out.push(sentence);
    }
  }
  return out.map((text) => (block.pause
    ? { text, heading: block.heading, pauseAfter: CUE_PAUSE_MS }
    : { text, heading: block.heading }));
}

/**
 * The whole pipeline: note (markdown, or editor HTML when `hasHtml`) to the
 * ordered list of utterances a reader speaks.
 */
export function notesToSpeech(input: {
  text?: string;
  html?: string;
  hasHtml?: boolean;
}): SpeechChunk[] {
  const useHtml = Boolean(input.hasHtml && input.html && input.html.trim());
  const blocks = useHtml
    ? htmlToBlocks(input.html as string)
    : markdownToBlocks(input.text ?? '');

  const chunks: SpeechChunk[] = [];
  for (const block of blocks) {
    if (looksLikeFormula(block.text)) {
      // A bare formula line (no `$` around it) is still a formula: read it when
      // it is simple, otherwise cue the screen and pause.
      const words = formulaToWords(block.text);
      chunks.push(words
        ? { text: words, heading: false }
        : { text: FORMULA_CUE, heading: false, pauseAfter: CUE_PAUSE_MS });
      continue;
    }
    chunks.push(...toChunks(block));
  }
  return chunks;
}
