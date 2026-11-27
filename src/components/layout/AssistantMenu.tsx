import React, { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquarePlus } from 'lucide-react';
import { useAssistantStore } from '../../stores/useAssistantStore';
import { formatSessionDate } from '../../features/ai/sessionGroups';
import { Z } from '../ui/zIndex';

/** Top-nav entry for the AI assistant: new chat plus recent chats. */
export const AssistantMenu: React.FC<{ label?: boolean }> = ({ label = true }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const setOpenAssistant = useAssistantStore((s) => s.setOpen);
  const sessions = useAssistantStore((s) => s.sessions);
  const newSession = useAssistantStore((s) => s.newSession);
  const selectSession = useAssistantStore((s) => s.selectSession);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const recent = [...sessions].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).slice(0, 8);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="AI assistant"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-bg-elevated"
      >
        <Bot className="w-[18px] h-[18px]" />
        {label && <span className="hidden lg:inline">Assistant</span>}
      </button>
      {open && (
        <div className={`absolute right-0 mt-2 w-72 ${Z.popover} rounded-xl border border-border bg-bg-surface p-2 card-enter`}>
          <button
            onClick={() => { void newSession(); setOpenAssistant(true); setOpen(false); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" /> New chat
          </button>
          <div className="mt-2 max-h-72 overflow-y-auto space-y-0.5">
            {recent.length === 0 && <p className="px-2 py-3 text-xs text-content-tertiary">No chats yet.</p>}
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={() => { void selectSession(s.id); setOpenAssistant(true); setOpen(false); }}
                className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-bg-elevated"
              >
                <span className="block text-xs text-content-primary truncate">{s.title}</span>
                <span className="block text-[10px] text-content-tertiary">{formatSessionDate(s.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
