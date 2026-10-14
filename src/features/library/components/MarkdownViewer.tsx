import React, { useState, useEffect } from 'react';
import { FileText, Save, X, AlertTriangle, RefreshCw, Check } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { db } from '../../../db/db';
import { toast } from '../../../stores/useToastStore';
import type { Note } from '../../../types';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownViewerProps {
  fileId: string;
  fileTitle: string;
  note: Note | null;
  onClose: () => void;
  onReExtract?: () => void;
  onSave?: () => void;
}

const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  fileId,
  fileTitle,
  note,
  onClose,
  onReExtract,
  onSave,
}) => {
  const [markdown, setMarkdown] = useState(note?.markdown ?? '');
  const [originalMarkdown, setOriginalMarkdown] = useState(note?.markdown ?? '');
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (note?.markdown !== undefined) {
      setMarkdown(note.markdown ?? '');
      setOriginalMarkdown(note.markdown ?? '');
      setEdited(false);
    }
  }, [note]);

  const handleSave = async () => {
    if (!edited) return;
    setSaving(true);
    try {
      await db.notes.put({
        ...note!,
        markdown,
        editedByUser: true,
        updatedAt: new Date().toISOString(),
      });
      setOriginalMarkdown(markdown);
      setEdited(false);
      toast('success', 'Saved', 'Your edits have been saved.');
      onSave?.();
    } catch (e) {
      toast('error', 'Save failed', 'Could not save your edits.');
    } finally {
      setSaving(false);
    }
  };

  const handleReExtract = async () => {
    if (edited) {
      if (!window.confirm('Replace your edits with a new extraction?')) return;
    }
    onReExtract?.();
  };

  const hasText = markdown.trim().length > 0;
  const canSave = edited && hasText;

  return (
    <Modal open onClose={onClose} title={fileTitle} subtitle="Markdown viewer" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[60vh] min-h-[400px]">
          {/* Rendered markdown */}
          <div className="flex flex-col border border-border rounded-xl bg-bg-elevated/40 overflow-hidden">
            <div className="p-3 border-b border-border/50 bg-bg-elevated/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-content-secondary">Rendered</span>
              <span className="text-[10px] text-content-tertiary">
                {markdown.length} chars
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 markdown-content">
              {hasText ? (
                <ReactMarkdown
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-1">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-base font-bold mt-2 mb-1">{children}</h3>,
                    p: ({ children }) => <p className="my-2">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    code: ({ children, ...props }) => (
                      <code {...props} className="font-mono text-sm bg-bg-surface border border-border rounded px-1.5 py-0.5">
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="overflow-x-auto rounded-lg bg-bg-surface border border-border p-3 text-sm my-2">
                        {children}
                      </pre>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-accent pl-4 my-2 italic text-content-secondary">
                        {children}
                      </blockquote>
                    ),
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-accent">
                        {children}
                      </a>
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-3">
                        <table className="min-w-full border-collapse border border-border">
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-border px-3 py-1.5 bg-bg-elevated/50 font-semibold text-left">{children}</th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-border px-3 py-1.5">{children}</td>
                    ),
                    tr: ({ children }) => <tr>{children}</tr>,
                    thead: ({ children }) => <thead>{children}</thead>,
                    tbody: ({ children }) => <tbody>{children}</tbody>,
                  }}
                >
                  {markdown}
                </ReactMarkdown>
              ) : (
                <div className="flex items-center justify-center h-full text-content-tertiary text-center px-4">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No text saved yet.</p>
                  <p className="text-xs mt-1">Run extraction to generate markdown.</p>
                </div>
              )}
            </div>
          </div>

          {/* Plain editor */}
          <div className="flex flex-col border border-border rounded-xl bg-bg-elevated/40 overflow-hidden">
            <div className="p-3 border-b border-border/50 bg-bg-elevated/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-content-secondary">Editor</span>
              <div className="flex items-center gap-2">
                {edited && (
                  <span className="text-[10px] text-amber-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Unsaved changes
                  </span>
                )}
                <span className="text-[10px] text-content-tertiary">
                  {markdown.length} chars
                </span>
              </div>
            </div>
            <textarea
              value={markdown}
              onChange={(e) => {
                setMarkdown(e.target.value);
                setEdited(e.target.value !== originalMarkdown);
              }}
              className="flex-1 w-full min-h-0 p-4 font-mono text-sm bg-bg-surface border-none outline-none resize-none text-content-primary placeholder:text-content-tertiary"
              placeholder={hasText ? '' : 'No text saved yet. Run extraction to generate markdown.'}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
          <button onClick={onClose} className="px-4 min-h-[44px] rounded-xl text-sm text-content-secondary hover:text-content-primary transition-colors">
            Close
          </button>
          {onReExtract && (
            <button
              onClick={handleReExtract}
              className="px-4 min-h-[44px] rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4 inline mr-1" /> Re-extract
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-5 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 inline animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Saving…
              </>
            ) : edited ? (
              <>
                <Check className="w-4 h-4 inline mr-1" /> Save changes
              </>
            ) : (
              <span>Save</span>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default MarkdownViewer;