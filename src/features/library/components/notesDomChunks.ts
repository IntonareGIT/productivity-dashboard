/**
 * Where each spoken sentence sits in the rendered note.
 *
 * The reader speaks one sentence at a time, and Omar wants the sentence being
 * read highlighted and the controls to jump between sentences and paragraphs.
 * That needs a mapping the markdown text alone cannot give: the spoken words for
 * a formula ("omega sub n equals square root of k over m") are not the words on
 * screen (`\omega_n = \sqrt{k/m}`), so a text search over the note would land in
 * the wrong place.
 *
 * So the note's OWN DOM is the source: this walks the rendered `.note-body`,
 * builds a spoken string per paragraph while remembering which text node and
 * offset every character came from, cuts it into sentences, and returns each
 * sentence with the Range that covers it. A formula or an image is an atom: its
 * spoken text is the formula words (or the cue) and its Range is the whole
 * element, which is exactly what should light up when it is read.
 *
 * DOM-only by design: it runs in the browser against the note the reader sees.
 */
import {
  CUE_PAUSE_MS,
  FORMULA_CUE,
  IMAGE_CUE,
  formulaWordsOrCue,
  imageWords,
  splitSentences,
} from './notesSpeech';

export interface DomSpeechChunk {
  /** What is said. */
  text: string;
  /** A heading, spoken as one utterance. */
  heading?: boolean;
  /** Wait this long after the chunk (a formula or image cue). */
  pauseAfter?: number;
  /** Paragraph number, so the controls can jump a paragraph at a time. */
  block: number;
  /** Where the sentence sits in the note, or null if it cannot be located. */
  range: Range | null;
}

/** Elements that start a new paragraph for the reader's purposes. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'HR',
]);

/** Content that is never spoken: code, and the editor's own controls. */
const SKIP_TAGS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'TEXTAREA']);

interface Piece {
  /** The words this piece contributes. */
  spoken: string;
  /** A text node and the offset its first character sits at. */
  node: Text | null;
  /** An element read as one atom (a formula or an image). */
  atom: Range | null;
  block: number;
  heading: boolean;
  /** Ends with a cue that asks the listener to look at the screen. */
  pause: boolean;
}

function rangeOfNode(el: Element): Range {
  const range = document.createRange();
  range.selectNode(el);
  return range;
}

/** Collect the note's content as ordered pieces, paragraph by paragraph. */
function collect(root: HTMLElement): Piece[] {
  const pieces: Piece[] = [];
  let block = 0;

  const visit = (parent: Node, blockId: number, heading: boolean) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text.trim()) {
          pieces.push({ spoken: text, node: child as Text, atom: null, block: blockId, heading, pause: false });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) continue;

      // A formula: the editor stores its LaTeX, the markdown path stores it in a
      // styled span. Either way it is one atom with its own spoken form.
      if (el.classList.contains('note-math')) {
        const latex = el.getAttribute('data-latex') ?? '';
        const spoken = formulaWordsOrCue(latex || el.textContent || '');
        pieces.push({ spoken: ` ${spoken} `, node: null, atom: rangeOfNode(el), block: blockId, heading, pause: spoken === FORMULA_CUE });
        continue;
      }

      if (tag === 'IMG') {
        const spoken = imageWords(el.getAttribute('alt') ?? '');
        pieces.push({ spoken: ` ${spoken} `, node: null, atom: rangeOfNode(el), block: blockId, heading, pause: spoken === IMAGE_CUE });
        continue;
      }

      if (tag === 'BR') {
        pieces.push({ spoken: '\n', node: null, atom: null, block: blockId, heading, pause: false });
        continue;
      }

      if (BLOCK_TAGS.has(tag)) {
        block += 1;
        visit(el, block, /^H[1-6]$/.test(tag) ? true : heading);
        block += 1;
      } else {
        visit(el, blockId, heading);
      }
    }
  };

  visit(root, block, false);
  return pieces;
}

/** Sentences of one paragraph, with the Range that covers each one. */
function chunksForBlock(pieces: Piece[]): DomSpeechChunk[] {
  if (!pieces.length) return [];
  const heading = pieces[0].heading;
  const block = pieces[0].block;

  // One string for the whole paragraph, plus the origin of every character.
  let full = '';
  const origin: { piece: number; offset: number }[] = [];
  pieces.forEach((piece, index) => {
    for (let offset = 0; offset < piece.spoken.length; offset += 1) {
      origin.push({ piece: index, offset });
    }
    full += piece.spoken;
  });

  const pause = pieces.some((piece) => piece.pause);

  const rangeFor = (start: number, end: number): Range | null => {
    const first = origin[start];
    const last = origin[end - 1];
    if (!first || !last) return null;
    const firstPiece = pieces[first.piece];
    const lastPiece = pieces[last.piece];
    const range = document.createRange();
    if (firstPiece.atom) {
      range.setStart(firstPiece.atom.startContainer, firstPiece.atom.startOffset);
    } else if (firstPiece.node) {
      range.setStart(firstPiece.node, first.offset);
    } else {
      return null;
    }
    if (lastPiece.atom) {
      range.setEnd(lastPiece.atom.endContainer, lastPiece.atom.endOffset);
    } else if (lastPiece.node) {
      range.setEnd(lastPiece.node, last.offset + 1);
    } else {
      return null;
    }
    return range;
  };

  if (heading) {
    const text = full.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const firstText = full.search(/\S/);
    const lastText = full.trimEnd().length;
    return [{
      text,
      heading: true,
      block,
      range: firstText >= 0 ? rangeFor(firstText, lastText) : null,
    }];
  }

  // Sentence boundaries over the paragraph string.
  const out: DomSpeechChunk[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(full)) {
    const at = full.indexOf(sentence, cursor);
    if (at < 0) continue;
    const start = at;
    const end = at + sentence.length;
    cursor = end;
    const text = sentence.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({
      text,
      block,
      range: rangeFor(start, end),
      ...(pause ? { pauseAfter: CUE_PAUSE_MS } : {}),
    });
  }
  return out;
}

/**
 * Every sentence of the rendered note, in reading order, each with its place in
 * the page.
 */
export function chunksFromDom(root: HTMLElement): DomSpeechChunk[] {
  const pieces = collect(root);
  const blocks = new Map<number, Piece[]>();
  for (const piece of pieces) {
    // A <br> only separates; it is not spoken.
    if (piece.spoken === '\n') continue;
    const list = blocks.get(piece.block) ?? [];
    list.push(piece);
    blocks.set(piece.block, list);
  }
  const out: DomSpeechChunk[] = [];
  for (const block of Array.from(blocks.keys()).sort((a, b) => a - b)) {
    out.push(...chunksForBlock(blocks.get(block) as Piece[]));
  }
  return out;
}
