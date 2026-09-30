import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, SendHorizonal, TriangleAlert, Zap } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { ThoughtBlock } from './ThoughtBlock';

/** Roughly six lines at the composer's font size; past this it scrolls. */
const MAX_COMPOSER_HEIGHT_PX = 132;

/**
 * True when the primary input is touch rather than a hardware keyboard.
 *
 * Checked at keydown time rather than cached at mount, because a tablet with a
 * folio keyboard can report both. `pointer: coarse` is the reliable signal that
 * there is no physical Enter key; a touch-capable laptop still has one, so
 * `maxTouchPoints` alone would wrongly turn Enter into a newline there.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

interface AssistantChatProps {
  onOpenSettings: () => void;
  /** Rendered in the header next to the title (e.g. Expand / Close). */
  headerExtra?: React.ReactNode;
  /** Extra classes for the scrolling conversation container. */
  className?: string;
}

/**
 * The conversation itself: transcript, confirmation gate and composer.
 *
 * All chat behaviour lives in `useAssistantStore`; this only renders it. The
 * floating bubble panel and the full-page `/assistant` route both mount this,
 * so neither duplicates chat logic.
 */
export const AssistantChat: React.FC<AssistantChatProps> = ({
  onOpenSettings,
  headerExtra,
  className = '',
}) => {
  const open = useAssistantStore((s) => s.open);
  const busy = useAssistantStore((s) => s.busy);
  const view = useAssistantStore((s) => s.view);
  const pending = useAssistantStore((s) => s.pending);
  const activeTool = useAssistantStore((s) => s.activeTool);
  const configured = useAssistantStore((s) => s.providerReady);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const send = useAssistantStore((s) => s.send);
  const confirmPending = useAssistantStore((s) => s.confirmPending);
  const cancelPending = useAssistantStore((s) => s.cancelPending);

  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Grow with the content, up to ~6 lines, then scroll.
   *
   * The height is reset to `auto` before measuring, because a textarea will not
   * shrink back on its own once it has grown. `scrollHeight` is the content
   * height; clamping it with `maxHeight` + `overflow-y-auto` is what makes the
   * box scroll instead of continuing to grow forever.
   */
  const resize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, []);

  useEffect(resize, [draft, resize]);

  /**
   * Send, then keep focus so the next message can be typed straight away.
   *
   * Focus is restored after the send because clearing the draft and the store
   * updating can otherwise leave the caret in the transcript.
   */
  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text);
    // Focus after paint, so it lands on the now-empty, enabled box.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [draft, busy, send]);

  /**
   * Enter sends, Shift+Enter inserts a newline.
   *
   * Three cases matter and each is easy to get wrong:
   *
   * 1. **IME composition.** While composing (a Japanese or Chinese keyboard
   *    picking a candidate), Enter means "accept this candidate", NOT "send".
   *    `event.isComposing` is the only reliable signal; `keyCode === 229` is
   *    the legacy fallback for browsers that report it inconsistently.
   * 2. **Shift+Enter** always inserts a newline, so we return without
   *    preventing the default.
   * 3. **Mobile.** The on-screen keyboard's Enter key reports `Enter` with no
   *    Shift, which is indistinguishable from a hardware Enter. Treating it as
   *    "send" is the classic mobile chat bug: you cannot start a new line at
   *    all. We detect a hardware keyboard and, on touch, Enter inserts a
   *    newline and the Send button is the way to send.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    // 1. Never send mid-composition.
    if (e.nativeEvent.isComposing || (e.nativeEvent as unknown as { keyCode?: number }).keyCode === 229) {
      return;
    }
    // 2. Shift+Enter is a newline: let the textarea insert it.
    if (e.shiftKey) return;
    // 3. On a touch device, Enter is a newline; Send is the button.
    if (isTouchDevice()) return;
    e.preventDefault();
    submit();
  };

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, view.length, busy, pending]);

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-bg-elevated/50">
        <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent text-white shrink-0">
          <Bot className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-content-primary leading-tight">Assistant</p>
          <p className="text-[11px] text-content-tertiary truncate">
            {configured ? 'Connected — can act on your data' : 'Needs an AI provider'}
          </p>
        </div>
        {headerExtra}
      </div>

      {!configured && (
        <button
          onClick={() => { setOpen(false); onOpenSettings(); }}
          className="m-3 mb-0 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left"
        >
          <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-xs text-content-primary">
            AI is disabled. <span className="font-semibold underline">Add a provider in Settings → AI Providers</span> to enable it.
          </span>
        </button>
      )}

      <div ref={listRef} className={`flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-[180px] ${className}`}>
        {view.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-br-md'
                  : msg.error
                    ? 'bg-rose-500/10 border border-rose-500/40 text-content-primary rounded-bl-md'
                    : 'bg-bg-elevated/60 border border-border text-content-primary rounded-bl-md'
              }`}
            >
              {msg.role === 'tool' && (
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${msg.error ? 'text-rose-500' : 'text-accent'}`}>
                  Action{msg.toolName ? ` · ${msg.toolName}` : ''}
                </p>
              )}
              {/* Reasoning, when the model produced any, sits ABOVE the answer
                  inside its own collapsible block. A standard model sends none,
                  `thought` is undefined, and this renders nothing at all — so
                  the message is byte-for-byte the normal one. */}
              {msg.thought && <ThoughtBlock text={msg.thought} />}
              {msg.text}
            </div>
          </div>
        ))}
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
      </div>

      {pending && (
        <div className="mx-3 mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-content-primary flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
            Confirm schedule change
          </p>
          <p className="text-xs text-content-secondary mt-1">{pending.description}</p>
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={() => void confirmPending()}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> Confirm
            </button>
            <button
              onClick={() => void cancelPending()}
              disabled={busy}
              className="flex-1 px-3 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 p-3 border-t border-border/60"
      >
        {/* A TEXTAREA, not an input: a single-line <input> physically cannot
            hold a newline, so Shift+Enter had nowhere to put one. The box grows
            with its content up to ~6 lines and then scrolls. */}
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={configured ? 'Ask or tell me to do something…' : 'Configure a provider first…'}
          disabled={busy || !configured}
          aria-label="Message the assistant"
          className="flex-1 min-w-0 resize-none overflow-y-auto bg-bg-elevated/60 border border-border rounded-xl px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent placeholder:text-content-tertiary disabled:opacity-50"
          style={{ maxHeight: MAX_COMPOSER_HEIGHT_PX }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim() || !configured}
          aria-label="Send message"
          className="p-3 rounded-xl bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-40 shrink-0"
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </form>
    </>
  );
};

