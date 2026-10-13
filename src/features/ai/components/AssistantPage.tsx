import React, { useState, useEffect } from 'react';
import { ArrowLeft, Minimize2, PanelLeftClose, PanelLeftOpen, Bot, Settings, Sparkles, History, ChevronDown, Circle, HelpCircle, Copy, Check } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { AssistantSurface } from './AssistantSurface';
import { AssistantChat } from './AssistantChat';
import { AssistantSessionList } from './AssistantSessionList';
import { AssistantHistoryDrawer } from './AssistantHistoryDrawer';
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
 * Renders the same `AssistantSurface` and the same Dexie-backed session list as
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
  const setModel = useAssistantStore((s) => s.setModel);
  const assistantRedesign = useAssistantStore((s) => s.assistantRedesign);
  const historyDrawerOpen = useAssistantStore((s) => s.historyDrawerOpen);
  const setHistoryDrawerOpen = useAssistantStore((s) => s.setHistoryDrawerOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [showWhatCanYouDo, setShowWhatCanYouDo] = useState(false);

  const model = models.find((m) => m.id === selectedModelId);

  // The page owns the conversation even when the bubble is closed.
  React.useEffect(() => {
    setOpen(true);
    void loadSessions();
    return () => {
      setOpen(false);
    };
  }, [loadSessions, setOpen]);

  // Keyboard: Ctrl+/ (Cmd+/ on Mac) focuses the command bar
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        const input = document.querySelector('textarea[aria-label="Message the assistant"]') as HTMLTextAreaElement;
        input?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close model menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuOpen && !(e.target as HTMLElement).closest('[data-model-menu]')) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelMenuOpen]);

  // Close history drawer on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (historyDrawerOpen) setHistoryDrawerOpen(false);
        if (drawerOpen) setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyDrawerOpen, drawerOpen]);

  if (!open) return null;

  // When the redesign flag is ON, render the new shared surface with layout='fullscreen'.
  if (assistantRedesign) {
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
                onClick={() => setHistoryDrawerOpen(true)}
                aria-label="Open history"
                className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                title="History"
              >
                <History className="w-4 h-4" />
              </button>
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
              {/* Model menu with green dot */}
              <div className="relative" data-model-menu>
                <button
                  onClick={() => setModelMenuOpen((v) => !v)}
                  aria-label="Select model"
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="listbox"
                  className="flex items-center gap-1.5 p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-bg-elevated transition-colors"
                >
                  <span className="relative flex items-center">
                    {model && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-assistant-ready border-2 border-bg" aria-label="Model ready" />
                    )}
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-xl bg-bg-elevated border border-border text-xs font-medium text-content-primary">
                      {model ? model.displayName : 'Select model'}
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

          <AssistantSurface layout="fullscreen" />
        </div>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className={`md:hidden fixed inset-0 ${Z.modal} flex`}>
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <aside className="assistant-drawer relative w-72 max-w-[80vw] flex flex-col bg-bg-surface border-r border-border shadow-2xl">
              <AssistantSessionList onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        {/* History drawer */}
        <AssistantHistoryDrawer
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          onNavigate={() => setHistoryDrawerOpen(false)}
        />

        {/* Return to the previous page */}
        <button
          onClick={onExit}
          className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 px-3 min-h-[44px] rounded-xl border border-border bg-bg-surface shadow-lg text-xs font-semibold text-content-primary hover:bg-bg-elevated transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>
    );
  }

  // Old full-screen assistant (flag OFF)
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
          <aside className="assistant-drawer relative w-72 max-w-[80vw] flex flex-col bg-bg-surface border-r border-border shadow-2xl">
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