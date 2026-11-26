import React, { useState } from 'react';
import { Check, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { Z } from '../../../components/ui/zIndex';
import { groupSessions, formatSessionDate } from '../sessionGroups';

interface AssistantHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigate?: () => void;
}

/**
 * The history drawer: a left slide-over grouped as Today, Yesterday and Earlier,
 * with search, open-on-click and delete-with-confirmation.
 *
 * Renders only on surfaces that have room for it (full screen and split). The
 * bubble is too compact, so it never mounts this — its history lives behind the
 * full-screen button instead.
 */
export const AssistantHistoryDrawer: React.FC<AssistantHistoryDrawerProps> = ({ open, onClose, onNavigate }) => {
  const sessions = useAssistantStore((s) => s.sessions);
  const sessionId = useAssistantStore((s) => s.sessionId);
  const selectSession = useAssistantStore((s) => s.selectSession);
  const removeSession = useAssistantStore((s) => s.removeSession);
  const newSession = useAssistantStore((s) => s.newSession);

  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = sessions.filter((s) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return s.title.toLowerCase().includes(q);
  });

  const groups = groupSessions(filtered);

  const handleDelete = async (id: string) => {
    await removeSession(id);
    setConfirmId(null);
  };

  return (
    <>
      {open && (
        <div
          className={`fixed inset-0 bg-black/50 ${Z.modal}`}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`assistant-drawer fixed top-0 left-0 h-full w-72 max-w-[80vw] flex flex-col bg-bg-surface border-r border-border shadow-2xl transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ zIndex: 'calc(var(--z-modal, 70) + 1)' }}
        aria-label="Chat history"
      >
        <div className="p-3 border-b border-border/60 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content-primary flex-1">History</h2>
          <button onClick={onClose} aria-label="Close history" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-border/60">
          <button
            onClick={() => { void newSession(); onNavigate?.(); }}
            className="w-full flex items-center justify-center gap-2 px-3 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4" /> New chat
          </button>
        </div>

        <div className="p-2 border-b border-border/60">
          <div className="flex items-center gap-1.5 rounded-xl bg-bg-elevated border border-border px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-content-tertiary" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="flex-1 min-w-0 bg-transparent text-sm text-content-primary outline-none placeholder:text-content-tertiary"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4">
          {[
            { label: 'Today', sessions: groups.today },
            { label: 'Yesterday', sessions: groups.yesterday },
            { label: 'Earlier', sessions: groups.earlier },
          ].map((g) =>
            g.sessions.length === 0 ? null : (
              <div key={g.label}>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary px-2 mb-1">
                  {g.label}
                </h3>
                <div className="space-y-1">
                  {g.sessions.map((s) => {
                    const active = s.id === sessionId;
                    const deleting = confirmId === s.id;
                    return (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 ${
                          active ? 'bg-accent/15 border border-accent/40' : 'hover:bg-bg-elevated/60'
                        }`}
                      >
                        {deleting ? (
                          <>
                            <span className="flex-1 min-w-0 text-xs text-content-primary truncate">
                              Delete “{s.title}”?
                            </span>
                            <button
                              onClick={() => void handleDelete(s.id)}
                              aria-label="Confirm delete"
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              aria-label="Cancel delete"
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
                                {formatSessionDate(s.updatedAt)}
                              </span>
                            </button>
                            <button
                              onClick={() => setConfirmId(s.id)}
                              aria-label={`Delete ${s.title}`}
                              className="p-1.5 rounded-lg text-content-tertiary hover:text-rose-500 hover:bg-bg-elevated opacity-0 group-hover:opacity-100 transition-opacity"
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
            ),
          )}
          {filtered.length === 0 && (
            <p className="text-xs text-content-tertiary text-center px-3 py-6">
              {sessions.length === 0 ? 'No conversations yet. Start one above.' : 'No conversations match your search.'}
            </p>
          )}
        </div>
      </aside>
    </>
  );
};