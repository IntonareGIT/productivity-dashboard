import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { thoughtPreview } from '../thinking';

interface ThoughtBlockProps {
  /** The extracted reasoning. Never empty — callers bypass this when there is none. */
  text: string;
  /**
   * True while the answer is still being produced. The block starts expanded so
   * the user can watch the reasoning, then collapses the moment the answer
   * arrives — the finished reply is what they actually want to read.
   */
  streaming?: boolean;
}

/**
 * Collapsible model-reasoning disclosure.
 *
 * Rendered ABOVE the final answer and only when `extractThinking` found
 * something; a standard model that returns no reasoning never mounts this, so
 * its messages look exactly as before.
 *
 * Muted and one size down from the transcript, because the reasoning is
 * supporting detail — it must never compete with the answer.
 */
export const ThoughtBlock: React.FC<ThoughtBlockProps> = ({ text, streaming = false }) => {
  const [open, setOpen] = useState(streaming);

  // Collapse once the response completes. Guarded on `streaming` so a user who
  // opened it by hand while it was streaming is not fought with on every render.
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  if (!text.trim()) return null;
  const preview = thoughtPreview(text);

  return (
    <div className="mb-1.5 rounded-xl border border-border bg-bg-elevated/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-content-tertiary hover:text-content-secondary transition-colors"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold shrink-0">💭 Thought process</span>
        {/* While collapsed the first line doubles as a hint, so the disclosure
            is useful without having to be expanded first. */}
        {!open && preview && (
          <span className="text-[11px] truncate opacity-70">{preview}</span>
        )}
      </button>

      {open && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-border/60">
          <p className="text-xs leading-relaxed text-content-tertiary whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};
