import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_NOTE_TITLE } from '../../../db/noteTitle';
import { setTopicTitle } from '../libraryRepo';
import { extractFormatting, restoreFormatting } from '../noteFormat';
import { sanitizeEditorHtml } from '../noteEditor/sanitizeHtml';
import { NoteToolbar, type NoteToolbarApi } from './NoteToolbar';
import type { Topic } from '../../../types';

/** Idle time before the title is written, so typing stays smooth. */
const AUTOSAVE_MS = 600;

/**
 * The editable note title.
 *
 * Owns its own draft so the user can type freely — including clearing the field
 * mid-edit — and commits on a debounce, on blur, or on Enter. Saving on every
 * keystroke would push a Dexie write (and a sync round-trip) per character and
 * make the input fight the cursor.
 *
 * Rendered in BOTH the split-pane notes view and the standalone Library editor,
 * so a title typed in either place is the same title.
 */
export const NoteTitleInput: React.FC<{
  topic: Topic;
  className?: string;
}> = ({ topic, className }) => {
  const [draft, setDraft] = useState(topic.title);
  const draftRef = useRef(topic.title);
  const timer = useRef<number | null>(null);
  draftRef.current = draft;

  const stored = (topic.title ?? '').trim();

  // Adopt an external change (topic switch, or a sync landing) — but never while
  // the user has unsaved edits of their own, or the input would fight them.
  useEffect(() => {
    if (draftRef.current.trim() !== stored) return;
    setDraft(topic.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.id, topic.title]);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = () => {
    clearTimer();
    const next = draftRef.current.trim();
    // An empty title falls back to the default in the repo, so a note is never
    // left unlabelled in a list.
    if (!next || next === stored) return;
    void setTopicTitle(topic.id, draftRef.current);
  };

  useEffect(() => () => {
    // Never lose a pending edit when the pane unmounts.
    clearTimer();
  }, []);

  return (
    <input
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        clearTimer();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          const next = draftRef.current.trim();
          if (next && next !== stored) void setTopicTitle(topic.id, draftRef.current);
        }, AUTOSAVE_MS);
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        flush();
        (e.target as HTMLInputElement).blur();
      }}
      placeholder={DEFAULT_NOTE_TITLE}
      aria-label="Note title"
      className={className
        ?? 'w-full bg-transparent border-none outline-none text-base font-semibold text-content-primary placeholder:text-content-tertiary/60'}
    />
  );
};

interface MarkdownNotesProps {
  /** The original markdown. Always the fallback and never ignored. */
  text: string;
  /** Rich-text body, used only when `hasHtml` is true. */
  html?: string;
  /** Whether `contentFormat` says this note is stored as HTML. */
  hasHtml?: boolean;
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

/**
 * Render LaTeX-ish math as styled text.
 *
 * The SINGLE seam for math. It is deliberately a self-contained function that
 * takes already-escaped text and returns HTML, so replacing it with a real KaTeX
 * (or MathJax) renderer later is a change to this function alone: the
 * formatting sanitizer, the toolbar and the markdown pipeline around it do not
 * move. Today it styles `$..$` and `$$..$$` rather than typesetting them.
 */
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
 * The one place the whole pipeline is applied, in the order that matters:
 *
 *   1. SANITIZE — pull the allowlisted `span`/`div` tags out of the raw text
 *      and hold them as placeholders. Everything else is now plain text.
 *   2. ESCAPE + markdown + math — exactly as before, on text that now provably
 *      contains no markup. Neither the markdown rules nor `renderLatex` can
 *      manufacture a tag, and a formatting tag cannot break a `$..$` span
 *      because the tag is not in the text while the math runs.
 *   3. RESTORE — put the sanitized tags back where their placeholders were.
 *
 * Doing it in this order is what lets formatting and math coexist: `$x^2$`
 * inside a colored span still matches, because the span is a placeholder at the
 * time the `$..$` regex runs.
 */
const renderNoteHtml = (raw: string): string => {
  const { text, tags } = extractFormatting(raw);
  const html = renderMarkdown(text);
  return restoreFormatting(html, tags);
};

/**
 * Tiny markdown renderer: headings, bold/italic, inline + fenced code,
 * bullet lists, links, and LaTeX spans (styled, no katex). Paragraphs otherwise.
 *
 * Takes text that has ALREADY been through `extractFormatting`, so it provably
 * contains no HTML of its own. Pure, so both the notes view and the verification
 * script call the same code.
 */
function renderMarkdown(text: string): string {
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
}

/**
 * The note body editor: formatting toolbar + textarea.
 *
 * SHARED by the standalone Library editor and the split-pane notes view so the
 * two cannot drift apart — one of the explicit requirements is that the same
 * controls appear in both.
 *
 * The toolbar needs the textarea's LIVE text and selection (not the `value`
 * prop, which can lag by a render), so the ref is read imperatively and the
 * caret is restored after a format action.
 */
export const NotesEditorBody: React.FC<{
  value: string;
  onChange: (next: string) => void;
  minHeight?: string;
  textareaClassName?: string;
}> = ({ value, onChange, minHeight = 'min-h-[280px]', textareaClassName = 'resize-y' }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Restored after a toolbar action; applied once the textarea re-renders.
  const pending = useRef<{ start: number; end: number } | null>(null);

  const api: NoteToolbarApi = {
    read: () => {
      const el = ref.current;
      return {
        // Prefer the live DOM value: a toolbar click can land before the
        // controlled value has propagated, and using a stale one would drop
        // the characters typed in that gap.
        text: el ? el.value : value,
        selection: el
          ? { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
          : { start: value.length, end: value.length },
      };
    },
    write: (text, selection) => {
      onChange(text);
      pending.current = selection;
    },
  };

  return (
    <>
      <NoteToolbar api={api} />
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) => {
          const el = e.currentTarget;
          if (!pending.current) return;
          // Restore the caret the toolbar asked for, then stop tracking.
          if (el.selectionStart !== pending.current.start || el.selectionEnd !== pending.current.end) {
            el.setSelectionRange(pending.current.start, pending.current.end);
          }
          pending.current = null;
        }}
        placeholder={'# Heading\n**bold** *italic* `code`\n- list item'}
        className={`flex-1 ${minHeight} w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent font-mono ${textareaClassName}`}
      />
    </>
  );
};

/** Exported for `verify-note-formatting.mjs`, which asserts the rendered HTML. */
export const __renderNoteHtml = renderNoteHtml;

/** Exported for tests: math rendering is its own seam. */
export const __renderLatex = renderLatex;

/**
 * Rendered notes.
 *
 * The output is sanitized inside `renderNoteHtml` before it ever reaches
 * `dangerouslySetInnerHTML` — see the comment there for the ordering.
 */
export const MarkdownNotes: React.FC<MarkdownNotesProps> = ({ text, html, hasHtml = false }) => {
  // A note edited in the rich-text editor is rendered from its stored HTML; a
  // legacy note is rendered from markdown. `html` is only trusted when
  // `hasHtml` is set by the caller that read `contentFormat`, so a stray field
  // cannot change which renderer is used.
  const out = hasHtml && html
    ? sanitizeEditorHtml(html)
    : renderNoteHtml(text);
  const body = useMemo(() => out, [out]);

  if (!body.trim()) {
    return <p className="text-sm text-content-tertiary italic">No notes yet. Click Edit to write your notes.</p>;
  }

  return (
    <div
      // `note-body` is the hook for `noteRichMedia.css`, so a callout, a
      // highlight and a floated image look identical here and in the editor.
      // Without it the preview would render the editor's rules against a
      // wrapper that does not exist and images would lose their layout.
      className="note-body space-y-2 break-words"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
};
