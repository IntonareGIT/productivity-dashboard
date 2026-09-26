import React, { useMemo } from 'react';

interface MarkdownNotesProps {
  text: string;
}

/** Escape HTML to keep the tiny renderer XSS-safe. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(escaped: string): string {
  let out = escaped;
  // links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-accent hover:underline break-all">$1</a>'
  );
  // inline code `code`
  out = out.replace(
    /`([^`\n]+)`/g,
    '<code class="px-1 py-0.5 rounded bg-bg-elevated border border-border font-mono text-[12px] text-accent-text">$1</code>'
  );
  // bold **bold**
  out = out.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="font-semibold text-content-primary">$1</strong>'
  );
  // italic *italic* (after bold so ** doesn't double-match)
  out = out.replace(
    /(^|[^*])\*([^*\n]+)\*/g,
    '$1<em class="italic">$2</em>'
  );
  return out;
}

function renderLatex(escaped: string): string {
  // Block $$..$$ left as a styled block; inline $..$ as styled span. No katex dep.
  let out = escaped.replace(
    /\$\$([\s\S]+?)\$\$/g,
    '<div class="my-2 px-3 py-2 rounded-lg bg-accent-subtle border border-border font-mono text-[13px] text-accent-text overflow-x-auto">$1</div>'
  );
  out = out.replace(
    /\$([^$\n]+?)\$/g,
    '<span class="px-1 rounded bg-accent-subtle font-mono text-[12px] text-accent-text">$1</span>'
  );
  return out;
}

/**
 * Tiny markdown renderer: headings, bold/italic, inline + fenced code,
 * bullet lists, links, and LaTeX spans (styled, no katex). Paragraphs otherwise.
 */
export const MarkdownNotes: React.FC<MarkdownNotesProps> = ({ text }) => {
  const html = useMemo(() => {
    if (!text.trim()) return '';
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const parts: string[] = [];
    let i = 0;
    let para: string[] = [];
    let list: string[] = [];

    const flushPara = () => {
      if (para.length === 0) return;
      const joined = para.join(' ');
      const withLatex = renderLatex(escapeHtml(joined));
      parts.push(`<p class="text-sm leading-relaxed text-content-primary">${inlineFormat(withLatex)}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list.length === 0) return;
      const items = list
        .map((li) => {
          const withLatex = renderLatex(escapeHtml(li));
          return `<li class="text-sm leading-relaxed text-content-primary ml-4 list-disc">${inlineFormat(withLatex)}</li>`;
        })
        .join('');
      parts.push(`<ul class="space-y-1 my-1">${items}</ul>`);
      list = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code block
      if (trimmed.startsWith('```')) {
        flushPara();
        flushList();
        const lang = trimmed.slice(3).trim();
        const buf: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          buf.push(lines[i]);
          i += 1;
        }
        i += 1; // skip closing fence
        const code = escapeHtml(buf.join('\n'));
        parts.push(
          `<pre class="my-2 px-3 py-2.5 rounded-xl bg-bg-elevated border border-border overflow-x-auto"><div class="text-[10px] uppercase tracking-wide text-content-tertiary mb-1.5">${escapeHtml(lang || 'code')}</div><code class="font-mono text-[12px] leading-relaxed text-content-primary whitespace-pre">${code || ' '}</code></pre>`
        );
        continue;
      }

      if (!trimmed) {
        flushPara();
        flushList();
        i += 1;
        continue;
      }

      const h3 = trimmed.match(/^###\s+(.*)/);
      const h2 = trimmed.match(/^##\s+(.*)/);
      const h1 = trimmed.match(/^#\s+(.*)/);
      if (h3 || h2 || h1) {
        flushPara();
        flushList();
        const raw = (h3?.[1] ?? h2?.[1] ?? h1?.[1] ?? '').trim();
        const inner = inlineFormat(renderLatex(escapeHtml(raw)));
        if (h3) parts.push(`<h4 class="text-[13px] font-semibold text-content-primary mt-3 mb-1">${inner}</h4>`);
        else if (h2) parts.push(`<h3 class="text-sm font-semibold text-content-primary mt-3 mb-1">${inner}</h3>`);
        else parts.push(`<h2 class="text-[15px] font-bold text-content-primary mt-3 mb-1.5">${inner}</h2>`);
        i += 1;
        continue;
      }

      const bullet = trimmed.match(/^[-*]\s+(.*)/);
      if (bullet) {
        flushPara();
        list.push(bullet[1]);
        i += 1;
        continue;
      }

      para.push(trimmed);
      i += 1;
    }
    flushPara();
    flushList();
    return parts.join('');
  }, [text]);

  if (!text.trim()) {
    return <p className="text-sm text-content-tertiary italic">No notes yet — click Edit to write markdown notes.</p>;
  }

  return (
    <div
      className="space-y-2 break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
