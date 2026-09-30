import React from 'react';
import { Expand, Trash2, X } from 'lucide-react';
import { Z } from '../../../components/ui/zIndex';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { AssistantChat } from './AssistantChat';

interface AssistantPanelProps {
  onOpenSettings: () => void;
  /** Navigate to the full-page assistant at /assistant. */
  onExpand: () => void;
}

/**
 * Floating chat bubble panel.
 *
 * A thin wrapper around `AssistantChat` — no chat logic of its own — so the
 * full-page assistant renders exactly the same conversation. Below `sm` it
 * fills the viewport; above it floats beside the launcher.
 */
export const AssistantPanel: React.FC<AssistantPanelProps> = ({ onOpenSettings, onExpand }) => {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const clearChat = useAssistantStore((s) => s.clearChat);

  if (!open) return null;

  return (
    <div className={`fixed ${Z.modal} inset-0 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[380px] sm:max-h-[65vh] flex flex-col bg-bg-surface sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl overflow-hidden`}>
      <AssistantChat
        onOpenSettings={onOpenSettings}
        headerExtra={
          <>
            <button onClick={() => void clearChat()} aria-label="Clear chat" title="Clear chat" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onExpand} aria-label="Open full page" title="Open full page" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <Expand className="w-4 h-4" />
            </button>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors">
              <X className="w-4 h-4" />
            </button>
          </>
        }
      />
    </div>
  );
};
