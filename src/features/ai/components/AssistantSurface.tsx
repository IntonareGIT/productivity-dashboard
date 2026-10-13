import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, RotateCcw, SendHorizonal, Square, Zap, AlertTriangle, User, Sparkles, Info, X, ChevronDown, Circle, HelpCircle, History } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { useAssistantStore, assistantUndo } from '../../../stores/useAssistantStore';
import { AssistantMessage } from './AssistantMessage';

export type AssistantLayout = 'bubble' | 'fullscreen' | 'split';

interface AssistantSurfaceProps {
  layout: AssistantLayout;
}

const SUGGESTIONS = [
  "What's on today?",
  'Next deadline',
  'Start a 25-minute focus',
  'Find a lecture',
];

const MAX_COMPOSER_HEIGHT_PX = 132;

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

/**
 * One shared assistant component with command-bar layout.
 *
 * Layout (all surfaces):
 *   - Centered input with placeholder
 *   - Suggestion chips (4-6) below input
 *   - Replies as cards below, oldest at top, newest at bottom
 *   - Each surface has its own scroll container
 */
export const AssistantSurface: React.FC<AssistantSurfaceProps> = ({ layout }) => {
  const open = useAssistantStore((s) => s.open);
  const busy = useAssistantStore((s) => s.busy);
  const view = useAssistantStore((s) => s.view);
  const pending = useAssistantStore((s) => s.pending);
  const activeTool = useAssistantStore((s) => s.activeTool);
  const providerReady = useAssistantStore((s) => s.providerReady);
  const providerLabel = useAssistantStore((s) => s.providerLabel);
  const retryStatus = useAssistantStore((s) => s.retryStatus);
  const failure = useAssistantStore((s) => s.failure);
  const fallbackNotice = useAssistantStore((s) => s.fallbackNotice);
  const models = useAssistantStore((s) => s.models);
  const selectedModelId = useAssistantStore((s) => s.selectedModelId);
  const setModel = useAssistantStore((s) => s.setModel);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const send = useAssistantStore((s) => s.send);
  const stop = useAssistantStore((s) => s.stop);
  const retryLast = useAssistantStore((s) => s.retryLast);
  const confirmPending = useAssistantStore((s) => s.confirmPending);
  const cancelPending = useAssistantStore((s) => s.cancelPending);

  const draft = useAssistantStore((s) => s.draft);
  const setDraft = useAssistantStore((s) => s.setDraft);
  const listScrollTop = useAssistantStore((s) => s.listScrollTop);
  const setListScrollTop = useAssistantStore((s) => s.setListScrollTop);
  const readerMsgId = useAssistantStore((s) => s.readerMsgId);
  const readerQuestion = useAssistantStore((s) => s.readerQuestion);
  const openReader = useAssistantStore((s) => s.openReader);
  const closeReader = useAssistantStore((s) => s.closeReader);
  const undoToast = useAssistantStore((s) => s.undoToast);
  const setUndoToast = useAssistantStore((s) => s.setUndoToast);
  const setHistoryDrawerOpen = useAssistantStore((s) => s.setHistoryDrawerOpen);

  const [showDetails, setShowDetails] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [showWhatCanYouDo, setShowWhatCanYouDo] = useState(false);

  // Keyboard: Ctrl+/ (Cmd+/ on Mac) focuses the command bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Composer gate: enabled when selected model has a key
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;
  const hasUsableModel = Boolean(selectedModel);

  /** Restore scroll position after remount. */
  useEffect(() => {
    const el = listRef.current;
    if (!el || listScrollTop <= 0) return;
    const raf = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listScrollTop;
    });
    return () => cancelAnimationFrame(raf);
  }, [view.length, listScrollTop]);

  /** Remember scroll offset as user scrolls. */
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setListScrollTop(el.scrollTop);
  }, [setListScrollTop]);

  const resize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, []);

  useEffect(resize, [draft, resize]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [draft, busy, send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      if (busy) {
        e.preventDefault();
        stop();
        return;
      }
      if (readerMsgId) {
        e.preventDefault();
        closeReader();
        return;
      }
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || (e.nativeEvent as unknown as { keyCode?: number }).keyCode === 229) {
      return;
    }
    if (e.shiftKey) return;
    if (isTouchDevice()) return;
    if (busy) return;
    e.preventDefault();
    submit();
  };

  useEffect(() => {
    if (failure) setShowDetails(false);
  }, [failure]);

  /** Autoscroll: pin to bottom when near bottom, else show jump button. */
  const [showJump, setShowJump] = useState(false);
  const pinnedRef = useRef(true);

  // Test helper: expose showJump state globally for browser tests
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__assistantShowJump = showJump;
    }
  }, [showJump]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
  }, [view.length, busy, pending]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    pinnedRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  const jump = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  };

  const timeStr = (ts?: number) =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <>
      {/* Top bar (fullscreen/split only) */}
      {(layout === 'fullscreen' || layout === 'split') && (
        <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-bg-elevated/50 shrink-0">
          <div className="flex items-center gap-2" data-model-menu>
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent text-white shrink-0">
              <Bot className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-content-primary leading-tight">Assistant</h1>
              {providerReady && providerLabel && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-[10px] font-medium text-accent-text">
                    <Sparkles className="w-3 h-3" />
                    {providerLabel}
                  </span>
                  {selectedModel && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-[10px] text-content-secondary">
                      {selectedModel.modelId}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" data-model-menu>
            {/* Model menu with green dot */}
            <div className="relative">
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                aria-label="Select model"
                aria-expanded={modelMenuOpen}
                aria-haspopup="listbox"
                className="flex items-center gap-1.5 p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <span className="relative flex items-center">
                  {selectedModel && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-assistant-ready border-2 border-bg" aria-label="Model ready" />
                  )}
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-xl bg-bg-elevated border border-border text-xs font-medium text-content-primary">
                    {selectedModel ? selectedModel.displayName : 'Select model'}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </span>
                </span>
              </button>
              {modelMenuOpen && (
                <ul
                  role="listbox"
                  aria-label="Select model"
                  className="absolute right-0 mt-1 min-w-[180px] rounded-xl border border-border bg-bg-surface shadow-lg overflow-hidden z-10"
                >
                  {models.map((m) => (
                    <li key={m.id} role="option" aria-selected={m.id === selectedModelId}>
                      <button
                        onClick={() => { void setModel(m.id); setModelMenuOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-content-primary hover:bg-bg-elevated transition-colors ${
                          m.id === selectedModelId ? 'bg-accent/10 font-semibold' : ''
                        }`}
                      >
                        {m.id === selectedModelId && <Check className="w-4 h-4 text-accent" />}
                        <span className="flex-1 truncate">{m.displayName}</span>
                        <span className="text-[10px] text-content-tertiary">{m.modelId}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setHistoryDrawerOpen(true)}
              aria-label="Open history"
              className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              title="History"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}

      {/* Bubble header */}
      {layout === 'bubble' && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-bg-elevated/50">
          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent text-white shrink-0">
            <Bot className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-content-primary leading-tight">Assistant</p>
            <p className="text-[11px] text-content-tertiary truncate">
              {hasUsableModel ? 'Ready — can act on your data' : models.length > 0 ? 'Select a model to start' : 'Needs an AI model'}
            </p>
          </div>
          {models.length > 0 && (
            <div className="flex items-center gap-1 ml-auto mr-2" data-model-menu>
              <div className="relative">
                <button
                  onClick={() => setModelMenuOpen((v) => !v)}
                  aria-label="Select model"
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="listbox"
                  className="flex items-center gap-1.5 p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                >
                  <span className="relative flex items-center">
                    {selectedModel && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-assistant-ready border-2 border-bg" aria-label="Model ready" />
                    )}
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-xl bg-bg-elevated border border-border text-xs font-medium text-content-primary">
                      {selectedModel ? selectedModel.displayName : 'Select model'}
                      <ChevronDown className="w-3.5 h-3.5" />
                    </span>
                  </span>
                </button>
                {modelMenuOpen && (
                  <ul
                    role="listbox"
                    aria-label="Select model"
                    className="absolute right-0 mt-1 min-w-[180px] rounded-xl border border-border bg-bg-surface shadow-lg overflow-hidden z-10"
                  >
                    {models.map((m) => (
                      <li key={m.id} role="option" aria-selected={m.id === selectedModelId}>
                        <button
                          onClick={() => { void setModel(m.id); setModelMenuOpen(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-content-primary hover:bg-bg-elevated transition-colors ${
                            m.id === selectedModelId ? 'bg-accent/10 font-semibold' : ''
                          }`}
                        >
                          {m.id === selectedModelId && <Check className="w-4 h-4 text-accent" />}
                          <span className="flex-1 truncate">{m.displayName}</span>
                          <span className="text-[10px] text-content-tertiary">{m.modelId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No models banner */}
      {models.length === 0 && (
        <button
          onClick={() => { setOpen(false); }}
          className="m-3 mb-0 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-xs text-content-primary">
            AI is disabled. <span className="font-semibold underline">Add a model in Settings → AI Models</span> to enable it.
          </span>
        </button>
      )}

      {/* Undo toast */}
      {undoToast && (
        <div className="m-3 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-subtle px-3 py-2 text-sm text-accent-text animate-slide-in">
          <span className="flex-1">{undoToast.message}</span>
          <button
            onClick={() => {
              assistantUndo.actUndo();
            }}
            className="px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors shrink-0"
          >
            Undo
          </button>
          <button
            onClick={() => {
              assistantUndo.dismissUndo();
            }}
            aria-label="Dismiss"
            className="p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Command bar: centered input + chips */}
      <div className="p-3 border-b border-border/60 bg-bg-elevated/50 shrink-0">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-2"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={hasUsableModel ? 'Ask about today, a file, or a task.' : 'Add a model in Settings'}
              disabled={!hasUsableModel}
              aria-label="Message the assistant"
              className="flex-1 min-w-0 resize-none overflow-y-auto bg-bg-elevated/60 border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary disabled:opacity-50"
              style={{ maxHeight: MAX_COMPOSER_HEIGHT_PX }}
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop responding"
                className="p-3 rounded-xl bg-accent hover:bg-accent-hover text-white transition-colors shrink-0 self-end"
              >
                <Square className="w-4 h-4 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || !hasUsableModel}
                aria-label="Send message"
                className="p-3 rounded-xl bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-40 shrink-0 self-end"
              >
                <SendHorizonal className="w-4 h-4" />
              </button>
            )}

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft(s)}
                  disabled={!hasUsableModel || busy}
                  className="px-3 py-1.5 rounded-full bg-bg-elevated border border-border text-xs text-content-primary hover:bg-bg-surface hover:border-accent/40 transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
              <button
                key="what-can-you-do"
                type="button"
                onClick={() => setShowWhatCanYouDo(true)}
                disabled={!hasUsableModel || busy}
                className="px-3 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                What can you do?
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Reply list */}
      <div
        ref={listRef}
        data-autoscroll-list
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-[180px}`}
      >
        {view.map((msg, idx) => {
          const isLastError = msg.error && idx === view.length - 1;
          const isLong = (msg.text?.length ?? 0) > 800 || (msg.text?.match(/\n/g)?.length ?? 0) > 5;
          return (
            <React.Fragment key={msg.id}>
              <AssistantMessage
                msg={msg}
                onCopy={(text) => navigator.clipboard.writeText(text)}
                onRegenerate={(msgId) => {
                  const idx = view.findIndex((m) => m.id === msgId);
                  if (idx > 0 && view[idx - 1].role === 'user') {
                    const userMsg = view[idx - 1];
                    setDraft(userMsg.text);
                    void send(userMsg.text, true);
                  }
                }}
                onRetry={isLastError ? (msgId) => void retryLast() : undefined}
                isLastError={isLastError}
                isStreaming={busy && view[view.length - 1]?.id === msg.id}
              />
              {isLong && !msg.error && msg.role === 'assistant' && (
                <button
                  type="button"
                  onClick={() => openReader(msg.id, view[idx - 1]?.text ?? '')}
                  className="mx-auto mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-semibold hover:bg-accent/20 transition-colors"
                >
                  <span className="w-3 h-3">📖</span>
                  Read in reader
                </button>
              )}
            </React.Fragment>
          );
        })}

        {activeTool ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-subtle px-2.5 py-1 text-[11px] font-semibold text-accent-text">
              <Zap className="w-3 h-3 animate-pulse" aria-hidden="true" />
              {activeTool.label}
            </div>
          </div>
        ) : busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-bg-elevated/60 border border-border px-3 py-2 text-content-tertiary text-xs">
              Working…
            </div>
          </div>
        )}

        {retryStatus && (
          <div className="flex justify-start" data-retry-status>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-subtle px-2.5 py-1 text-[11px] font-semibold text-accent-text">
              <span className="w-3 h-3 animate-spin">⟳</span>
              {retryStatus}
            </div>
          </div>
        )}

        {fallbackNotice && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-[11px] text-content-secondary">
              <Info className="w-3 h-3" aria-hidden="true" />
              {fallbackNotice}
            </div>
          </div>
        )}
      </div>

      {/* Jump to latest button */}
      {showJump && (
        <button
          onClick={jump}
          className="mx-auto mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-semibold hover:bg-accent/25 transition-colors"
        >
          <span className="w-3 h-3 animate-bounce">↓</span>
          Jump to latest
        </button>
      )}

      {/* Reader pane */}
      {readerMsgId && (
        <div
          className={`fixed inset-0 z-50 flex assistant-reader ${layout === 'bubble' ? 'md:inset-auto md:max-w-3xl md:max-h-[80vh] md:m-auto' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Message reader"
        >
          <div className="absolute inset-0 bg-black/50" onClick={closeReader} aria-hidden="true" />
          <div className={`relative flex flex-col bg-bg-surface border border-border ${layout === 'bubble' ? 'md:w-full md:h-full' : 'w-full h-full'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-bg-elevated/50 shrink-0">
              <button
                onClick={closeReader}
                aria-label="Back to command bar"
                className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content-primary leading-tight truncate">
                  {readerQuestion?.slice(0, 50) ?? 'Assistant reply'}
                </p>
              </div>
              <button
                onClick={() => {
                  const msg = view.find((m) => m.id === readerMsgId);
                  if (msg) navigator.clipboard.writeText(msg.text);
                }}
                aria-label="Copy reply"
                className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
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
                  {view.find((m) => m.id === readerMsgId)?.text ?? ''}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What can you do? modal */}
      {showWhatCanYouDo && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="What can you do?"
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowWhatCanYouDo(false)} aria-hidden="true" />
          <div className="relative w-full max-w-md mx-auto my-auto bg-bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-bg-elevated/50 shrink-0">
              <h2 className="text-sm font-semibold text-content-primary">What can you do?</h2>
              <button
                onClick={() => setShowWhatCanYouDo(false)}
                aria-label="Close"
                className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-content-tertiary">The assistant can:</p>
              <ul className="space-y-2 text-sm text-content-primary">
                <li>• Read and search your files, notes, and calendar</li>
                <li>• Create subjects, topics, notes, and assessments</li>
                <li>• Add calendar events, PTO, and shift exceptions</li>
                <li>• Start and stop focus timers</li>
                <li>• Change your status (Studying, Working, etc.)</li>
                <li>• List and switch AI models</li>
                <li>• Manage conversations (list, open, delete, new)</li>
                <li>• Extract text from PDFs and mark them as checked</li>
                <li>• Search notes and read specific pages</li>
                <li>• Edit and revert notes</li>
              </ul>
              <p className="text-xs text-content-tertiary mt-2">
                It cannot add, view, or copy API keys — if asked, it points to Settings → AI Keys.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-border/60 bg-bg-elevated/50 flex justify-end">
              <button
                onClick={() => setShowWhatCanYouDo(false)}
                className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};