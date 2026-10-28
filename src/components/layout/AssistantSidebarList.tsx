import React from 'react';
import { Bot, ChevronDown, ChevronUp, MessageSquarePlus } from 'lucide-react';
import { useAssistantStore } from '../../stores/useAssistantStore';
import { groupSessions, formatSessionDate } from '../../features/ai/sessionGroups';

interface AssistantSidebarListProps {
  isCollapsed: boolean;
  chatsOpen: boolean;
  onToggleChats: () => void;
  onOpenAssistant: () => void;
}

/**
 * Collapsible chat list under the AI assistant sidebar item.
 *
 * Shares the Today / Yesterday / Earlier grouping with the history drawer via
 * `groupSessions`, so both surfaces always agree. Rendered only in the expanded
 * sidebar; the collapsed sidebar shows only the assistant icon and opens the
 * assistant on click.
 */
export const AssistantSidebarList: React.FC<AssistantSidebarListProps> = ({
  isCollapsed,
  chatsOpen,
  onToggleChats,
  onOpenAssistant,
}) => {
  const sessions = useAssistantStore((s) => s.sessions);
  const newSession = useAssistantStore((s) => s.newSession);
  const selectSession = useAssistantStore((s) => s.selectSession);

  const groups = groupSessions(sessions);
  const handleClick = isCollapsed ? onOpenAssistant : onToggleChats;

  const renderGroup = (label: string, rows: typeof sessions) => {
    if (rows.length === 0) return null;
    return (
      <div key={label}>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary px-2 mb-1">
          {label}
        </h3>
        <div className="space-y-1">
          {rows.map((s) => (
            <button
              key={s.id}
              onClick={() => { void selectSession(s.id); onOpenAssistant(); }}
              className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-left hover:bg-bg-elevated/60"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-content-primary truncate">{s.title}</span>
                <span className="block text-[10px] text-content-tertiary">
                  {formatSessionDate(s.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="px-2 space-y-1">
      <button
        onClick={handleClick}
        aria-label={chatsOpen ? 'Collapse AI chats' : 'Expand AI chats'}
        className="w-full flex items-center space-x-3 rounded-xl text-sm font-medium transition-colors duration-150 justify-center p-3"
        title={isCollapsed ? 'Open AI assistant' : undefined}
      >
        <Bot className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        {!isCollapsed && (
          <>
            <span className="truncate">AI assistant</span>
            {chatsOpen ? (
              <ChevronUp className="w-4 h-4 ml-auto text-content-tertiary" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4 ml-auto text-content-tertiary" aria-hidden="true" />
            )}
          </>
        )}
      </button>
      {!isCollapsed && chatsOpen && (
        <div className="space-y-1">
          <button
            onClick={() => { void newSession(); onOpenAssistant(); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" /> New chat
          </button>
          <div className="flex-1 overflow-y-auto p-1 space-y-1">
            {renderGroup('Today', groups.today)}
            {renderGroup('Yesterday', groups.yesterday)}
            {renderGroup('Earlier', groups.earlier)}
          </div>
        </div>
      )}
    </div>
  );
};
