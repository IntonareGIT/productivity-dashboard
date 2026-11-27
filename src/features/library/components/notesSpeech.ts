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
  return hasMathSymbol && content / dense.length < 0.55;
}

/** Strip the inline markup a spoken sentence should not carry. */
function stripInline(input: string): string {
  let out = input;
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                    // images
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                  // links keep their words
  out = out.replace(/`([^`]*)`/g, '$1');                              // inline code keeps its words
  out = out.replace(/<\/?[a-z][^>\n]*>/gi, ' ');                      // stray tags
  out = out.replace(/https?:\/\/\S+/g, ' ');                          // bare URLs
  out = out.replace(/\$\$[\s\S]*?\$\$/g, ' ');                        // block maths
  // Inline maths, except a money amount: "$5" must survive, "$x^2$" must not.
  out = out.replace(/\$([^$\n]{1,200})\$/g, (match, inner: string) =>
    /^\s*\d[\d.,]*\s*$/.test(inner) ? match : ' ');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');                        // bold
  out = out.replace(/\*([^*\n]+)\*/g, '$1');                          // italic
  out = out.replace(/~~([^~]+)~~/g, '$1');                            // strike
  return out;
}

/** Collapse the whitespace a stripped tag leaves behind. */
function tidy(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Editor HTML to blocks, keeping headings.
 *
 * `contentHtml` comes from the rich-text editor, so its paragraphs, headings and
 * list items are real tags. Formulas arrive as `span.note-math` (the editor's
 * one maths seam) and images as `img`; both are dropped whole so their source
 * never leaks into speech.
 */
function htmlToBlocks(html: string): { text: string; heading: boolean }[] {
  let s = html;
  s = s.replace(/<(script|style|pre)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<span[^>]*class="[^"]*note-math[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ');
  s = s.replace(/<img\b[^>]*>/gi, ' ');
  // Headings get a sentinel so the line pass can still mark them as headings.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _level, inner: string) => `\u0001${inner}\u0002\n\n`);
  s = s.replace(/<li\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|li|blockquote|tr)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);

  const blocks: { text: string; heading: boolean }[] = [];
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
function markdownToBlocks(markdown: string): { text: string; heading: boolean }[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: { text: string; heading: boolean }[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  let inBlockMath = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = tidy(stripInline(paragraph.join(' ')));
    if (text) blocks.push({ text, heading: false });
    paragraph = [];
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

    // Multi-line $$ ... $$ blocks.
    if (!inBlockMath && trimmed.startsWith('$$')) {
      flushParagraph();
      inBlockMath = !trimmed.endsWith('$$') || trimmed === '$$';
      continue;
    }
    if (inBlockMath) {
      if (trimmed.endsWith('$$')) inBlockMath = false;
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
function toChunks(block: { text: string; heading: boolean }): SpeechChunk[] {
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
    return out;
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
  return out.map((text) => ({ text, heading: block.heading }));
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
    if (looksLikeFormula(block.text)) continue;
    chunks.push(...toChunks(block));
  }
  return chunks;
}
