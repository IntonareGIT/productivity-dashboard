import React, { useState } from 'react';
import { ArrowLeft, Minimize2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { AssistantChat } from './AssistantChat';
import { AssistantSessionList } from './AssistantSessionList';

interface AssistantPageProps {
  onOpenSettings: () => void;
  /** Return to whichever page the user came from. */
  onExit: () => void;
  /** Collapse the panel back into the floating bubble. */
  onCollapse: () => void;
}

/**
 * Full-page assistant.
 *
 * Renders the same `AssistantChat` and the same Dexie-backed session list as
 * the bubble panel, so both surfaces share one conversation and one history.
 * The side panel is persistent on `md+` and a slide-over drawer below it.
 */
export const AssistantPage: React.FC<AssistantPageProps> = ({
  onOpenSettings,
  onExit,
  onCollapse,
}) => {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const loadSessions = useAssistantStore((s) => s.loadSessions);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  // The page owns the conversation even when the bubble is closed.
  React.useEffect(() => {
    setOpen(true);
    void loadSessions();
    return () => {
      setOpen(false);
    };
  }, [loadSessions, setOpen]);

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 bg-bg text-content-primary">
      {/* Desktop rail */}
      {railOpen && (
        <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border/60 bg-bg-surface/40">
          <AssistantSessionList />
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <AssistantChat
          onOpenSettings={onOpenSettings}
          className="min-h-0"
          headerExtra={
            <>
              <button
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label="Toggle session list"
                className="md:hidden p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
              <button
                onClick={() => setRailOpen((v) => !v)}
                aria-label="Toggle session list"
                className="hidden md:inline-flex p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                {railOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
              <button
                onClick={onCollapse}
                aria-label="Collapse to bubble"
                title="Collapse to bubble"
                className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </>
          }
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="relative w-72 max-w-[80vw] flex flex-col bg-bg-surface border-r border-border shadow-2xl">
            <AssistantSessionList onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* Return to the previous page */}
      <button
        onClick={onExit}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 px-3 min-h-[44px] rounded-xl border border-border bg-bg-surface shadow-lg text-xs font-semibold text-content-primary hover:bg-bg-elevated transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
    </div>
  );
};
