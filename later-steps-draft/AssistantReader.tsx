import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { AssistantViewMsg } from './AssistantMessage';

/**
 * The reader view: a rendered version of one assistant reply, with headings,
 * lists and code blocks, plus Copy and Back-to-list actions.
 *
 * Opened when a reply is longer than about six lines. The question that
 * produced it shows as a short label on the left, so the reader never opens
 * without context.
 */
export interface AssistantReaderProps {
  msg: AssistantViewMsg;
  question?: string;
  onBack: () => void;
  onCopy?: (text: string) => void;
}

export const AssistantReader: React.FC<AssistantReaderProps> = ({ msg, question, onBack, onCopy }) => {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="assistant-reader flex flex-col h-full min-h-0 bg-bg text-content-primary">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-bg-elevated/50 shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to command bar"
          className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-content-primary leading-tight truncate">
            {question ?? (isTool ? 'Action result' : 'Assistant reply')}
          </p>
          {timeStr && <p className="text-[11px] text-content-tertiary">{timeStr}</p>}
        </div>
        {!isUser && !isTool && (
          <button
            onClick={() => {
              onCopy?.(msg.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            aria-label={copied ? 'Copied' : 'Copy reply'}
            className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-accent" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {isTool && (
          <p className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${msg.error ? 'text-rose-500' : 'text-accent'}`}>
            Action{msg.toolName ? ` · ${msg.toolName}` : ''}
          </p>
        )}
        {msg.thought && (
          <details className="mb-3 rounded-xl border border-border bg-bg-elevated/40 overflow-hidden">
            <summary className="text-[11px] font-medium text-content-tertiary cursor-pointer select-none px-2.5 py-1.5">
              Show reasoning
            </summary>
            <div className="px-2.5 pb-2 pt-0.5 border-t border-border/60">
              <p className="text-xs leading-relaxed text-content-tertiary whitespace-pre-wrap">{msg.thought}</p>
            </div>
          </details>
        )}
        <div className="text-[14px] leading-relaxed text-content-primary">
          <ReactMarkdown
            rehypePlugins={[rehypeHighlight]}
            components={{
              h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
              p: ({ children }) => <p className="my-1.5">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
              code: ({ children, ...props }) => (
                <code {...props} className="font-mono text-[12px] bg-bg-elevated border border-border rounded px-1 py-0.5">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="overflow-x-auto rounded-lg bg-bg-surface border border-border p-3 text-[12px] my-2">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-accent">
                  {children}
                </a>
              ),
            }}
          >
            {msg.text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};