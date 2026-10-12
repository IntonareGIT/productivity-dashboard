import React, { useState } from 'react';
import { ArrowLeft, Minimize2, PanelLeftClose, PanelLeftOpen, Bot, Settings, Sparkles } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { AssistantChat } from './AssistantChat';
import { AssistantSessionList } from './AssistantSessionList';
import { Z } from '../../../components/ui/zIndex';

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
  const providerReady = useAssistantStore((s) => s.providerReady);
  const providerLabel = useAssistantStore((s) => s.providerLabel);
  const models = useAssistantStore((s) => s.models);
  const selectedModelId = useAssistantStore((s) => s.selectedModelId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  const model = models.find((m) => m.id === selectedModelId);

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
        {/* Compact header with context chip */}
        <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-bg-elevated/50 shrink-0">
          <div className="flex items-center gap-2">
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
                  {model && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-[10px] text-content-secondary">
                      {model.modelId}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
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
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onCollapse}
              aria-label="Collapse to bubble"
              title="Collapse to bubble"
              className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        <AssistantChat
          onOpenSettings={onOpenSettings}
          className="min-h-0"
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className={`md:hidden fixed inset-0 ${Z.modal} flex`}>
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
