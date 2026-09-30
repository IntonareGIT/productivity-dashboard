/**
 * Convert a legacy markdown note into editor HTML.
 *
 * Two rules make this safe to run on real notes:
 *
 * 1. **The original markdown is never touched.** This function only READS it.
 *    `Topic.notes` stays byte-for-byte as the backup forever; the converted HTML
 *    goes to the separate `contentHtml` field and is only persisted once the user
 *    actually edits.
 * 2. **Math is protected before anything else touches the text.** `$..$` and
 *    `$$..$$` are pulled out into placeholders first, then the markdown pass
 *    runs, then they are put back. Without this a formula containing `_` or
 *    `*` would be eaten as emphasis, and `renderLatex` would never see it.
 *
 * The text CONTENT is what must survive. Formatting fidelity for old notes is
 * nice; losing a character is not acceptable.
 */

const MATH_BLOCK = /\$\$[\s\S]*?\$\$/g;
const MATH_INLINE = /\$(?!\s)(?:\\.|[^$\\\n])+(?<!\s)\$/g;

interface Protected {
  text: string;
  parts: string[];
}

/**
 * Replace math spans with opaque placeholders.
 *
 * The placeholder is built from the index rather than the content, so a formula
 * can never contain something that looks like a placeholder.
 */
export function protectMath(markdown: string): Protected {
  const parts: string[] = [];
  const text = markdown
    .replace(MATH_BLOCK, (m) => {
      parts.push(m);
      return `@@MATHB${parts.length - 1}@@`;
    })
    .replace(MATH_INLINE, (m) => {
      parts.push(m);
      return `@@MATHI${parts.length - 1}@@`;
    });
  return { text, parts };
}

/** Put the protected math back, keeping `$..$` / `$$..$$` verbatim. */
export function restoreMath(text: string, parts: string[]): string {
  return text.replace(/@@MATH([BI])(\d+)@@/g, (whole, kind: string, i: string) => {
    const part = parts[Number(i)];
    return part ?? whole;
  });
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Convert markdown to the small HTML subset Tiptap can represent as a document.
 *
 * This is intentionally NOT a full markdown parser. It covers exactly what the
 * note editor and the old placeholder text produced: headings, bold, italic,
 * inline code, fenced code, bullet and numbered lists, blockquotes, rules and
 * paragraphs. Anything unrecognised stays as text inside a paragraph, which is
 * the safe failure: the words survive.
 */
export function markdownToEditorHtml(markdown: string): string {
  if (!markdown) return '';
  const { text, parts } = protectMath(markdown);
  const lines = text.split('\n');
  const out: string[] = [];

  let para: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Fenced code: content is preserved verbatim, never inline-parsed.
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushPara(); flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }

    if (line.trim() === '') { flushPara(); flushList(); continue; }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara(); flushList();
      out.push('<hr>');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const level = Math.min(heading[1].length, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara(); flushList();
      out.push(`<blockquote><p>${inline(quote[1])}</p></blockquote>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const want: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      if (listType !== want) { flushList(); out.push(`<${want}>`); listType = want; }
      out.push(`<li><p>${inline((bullet ?? numbered)![1])}</p></li>`);
      continue;
    }

    flushList();
    para.push(line);
  }

  if (inCode) out.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
  flushPara();
  flushList();

  return restoreMath(out.join(''), parts);
}

/** Inline markdown inside one block: code spans, bold, italic, strikethrough. */
function inline(s: string): string {
  // Code spans are protected first so `**` inside backticks stays literal.
  const codeSpans: string[] = [];
  let text = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${esc(code)}</code>`);
    return `@@CODE${codeSpans.length - 1}@@`;
  });

  text = esc(text);

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  text = text.replace(/@@CODE(\d+)@@/g, (_m, i: string) => codeSpans[Number(i)] ?? '');

  // Soft line breaks inside a paragraph become <br>, as markdown does.
  return text.replace(/\n/g, '<br>');
}
