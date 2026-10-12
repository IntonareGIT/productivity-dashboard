import React, { useState } from 'react';
import { Copy, Check, Clock, RotateCcw, Bot, User, Zap, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export interface AssistantViewMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  thought?: string;
  toolName?: string;
  error?: boolean;
  timestamp?: number;
}

interface AssistantMessageProps {
  msg: AssistantViewMsg;
  onCopy?: (text: string) => void;
  onRegenerate?: (msgId: string) => void;
  isStreaming?: boolean;
}

/**
 * Single assistant message with avatar, markdown, timestamp, and actions.
 */
export const AssistantMessage: React.FC<AssistantMessageProps> = ({
  msg,
  onCopy,
  onRegenerate,
  isStreaming = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const role = msg.role;
  const isUser = role === 'user';
  const isTool = role === 'tool';
  const isError = msg.error === true;

  const avatar = isUser ? (
    <User className="w-4 h-4 text-white" />
  ) : isTool ? (
    <Zap className="w-4 h-4 text-accent" />
  ) : isError ? (
    <AlertTriangle className="w-4 h-4 text-rose-500" />
  ) : (
    <Bot className="w-4 h-4 text-white" />
  );

  const avatarBg = isUser
    ? 'bg-accent'
    : isTool
    ? 'bg-accent-subtle'
    : isError
    ? 'bg-rose-500/10'
    : 'bg-accent';

  const bubbleBg = isUser
    ? 'bg-accent text-white'
    : isError
    ? 'bg-rose-500/10 border border-rose-500/40 text-content-primary'
    : isTool
    ? 'bg-accent-subtle border border-accent/30 text-content-primary'
    : 'bg-bg-elevated/60 border border-border text-content-primary';

  const timeStr = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!isUser && (
        <div className={`shrink-0 ${avatarBg} rounded-full w-7 h-7 flex items-center justify-center flex-shrink-0`}>
          {avatar}
        </div>
      )}

      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`${bubbleBg} rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
            isUser ? 'rounded-br-md' : 'rounded-bl-md'
          }`}
        >
          {isTool && (
            <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${isError ? 'text-rose-500' : 'text-accent'}`}>
              Action{msg.toolName ? ` · ${msg.toolName}` : ''}
            </p>
          )}
          {msg.thought && (
            <details className="mb-2">
              <summary className="text-[10px] font-medium text-content-tertiary cursor-pointer select-none">
                Show reasoning
              </summary>
              <div className="mt-1 text-[11px] text-content-secondary whitespace-pre-wrap font-mono bg-bg-surface/50 rounded p-2">
                {msg.thought}
              </div>
            </details>
          )}
          <div className="whitespace-pre-wrap break-words">
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight]}
              components={{
                code: ({ children, ...props }) => (
                  <code {...props} className={`font-mono text-[12px] ${isUser ? 'text-white/90' : 'text-content-primary'}`}>
                    {children}
                  </code>
                ),
                pre: ({ children, ...props }) => (
                  <pre {...props} className="overflow-x-auto rounded-lg bg-bg-surface/50 p-2 text-[11px]">
                    {children}
                  </pre>
                ),
                a: ({ href, children, ...props }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline text-accent" {...props}>
                    {children}
                  </a>
                ),
              }}
            >
              {msg.text}
            </ReactMarkdown>
          </div>
        </div>

        <div
          className={`flex items-center gap-1.5 mt-1 px-1 transition-opacity duration-150 ${
            showActions || isStreaming ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <time className="flex items-center gap-0.5 text-[10px] text-content-tertiary" dateTime={msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined}>
            <Clock className="w-2.5 h-2.5" />
            {timeStr}
          </time>

          {!isUser && !isTool && !isStreaming && (
            <>
              <button
                onClick={() => {
                  onCopy?.(msg.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                aria-label={copied ? 'Copied' : 'Copy message'}
                className="p-1 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                title={copied ? 'Copied!' : 'Copy'}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => onRegenerate?.(msg.id)}
                aria-label="Regenerate response"
                className="p-1 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                title="Regenerate"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {isUser && (
        <div className={`shrink-0 ${avatarBg} rounded-full w-7 h-7 flex items-center justify-center flex-shrink-0`}>
          {avatar}
        </div>
      )}
    </div>
  );
};