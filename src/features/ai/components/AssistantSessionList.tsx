import React, { useState } from 'react';
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';

interface AssistantSessionListProps {
  /** Called after a new chat is started (used to close the mobile drawer). */
  onNavigate?: () => void;
}

/**
 * Session list with New chat, rename and delete.
 *
 * Sessions are per-provider: when the default provider changes the store starts
 * a fresh session instead of replaying the old provider's messages, so this
 * list only ever shows conversations the current provider can continue.
 */
export const AssistantSessionList: React.FC<AssistantSessionListProps> = ({ onNavigate }) => {
  const sessions = useAssistantStore((s) => s.sessions);
  const sessionId = useAssistantStore((s) => s.sessionId);
  const newSession = useAssistantStore((s) => s.newSession);
  const selectSession = useAssistantStore((s) => s.selectSession);
  const removeSession = useAssistantStore((s) => s.removeSession);
  const renameSession = useAssistantStore((s) => s.renameSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };

  const commitRename = async (id: string) => {
    await renameSession(id, draft);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-border/60">
        <button
          onClick={() => { void newSession(); onNavigate?.(); }}
          className="w-full flex items-center justify-center gap-2 px-3 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" /> New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-xs text-content-tertiary text-center px-3 py-6">
            No conversations yet. Start one above.
          </p>
        )}
        {sessions.map((s) => {
          const active = s.id === sessionId;
          const editing = editingId === s.id;
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 ${
                active ? 'bg-accent/15 border border-accent/40' : 'hover:bg-bg-elevated/60'
              }`}
            >
              {editing ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 min-w-0 bg-bg-elevated border border-border rounded-lg px-2 py-1.5 text-xs text-content-primary outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => void commitRename(s.id)}
                    aria-label="Save name"
                    className="p-1.5 rounded-lg text-accent hover:bg-bg-elevated"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel rename"
                    className="p-1.5 rounded-lg text-content-tertiary hover:bg-bg-elevated"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { void selectSession(s.id); onNavigate?.(); }}
                    className="flex-1 min-w-0 text-left px-1 py-1"
                  >
                    <span className="block text-xs text-content-primary truncate">{s.title}</span>
                    <span className="block text-[10px] text-content-tertiary">
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    onClick={() => startRename(s.id, s.title)}
                    aria-label={`Rename ${s.title}`}
                    className="p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void removeSession(s.id)}
                    aria-label={`Delete ${s.title}`}
                    className="p-1.5 rounded-lg text-content-tertiary hover:text-rose-500 hover:bg-bg-elevated"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
