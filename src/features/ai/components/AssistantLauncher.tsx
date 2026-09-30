import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAssistantStore } from '../../../stores/useAssistantStore';
import { Z } from '../../../components/ui/zIndex';

interface AssistantLauncherProps {
  /** Jump to Settings when AI is not configured yet. */
  onOpenSettings: () => void;
  /** True when a default provider exists with a non-empty API key. */
  configured: boolean;
  /**
   * Split view is open. The launcher is a fixed bottom-right button, and in
   * split view that corner is the assistant pane's chat composer and the right
   * PDF pane — the FAB sat on top of the input field. Docking it in split view
   * keeps every control reachable.
   */
  hidden?: boolean;
}

/**
 * Floating chat button (bottom-right, every page). Disabled — but still
 * visible and explanatory — until a provider is configured in Settings.
 */
export const AssistantLauncher: React.FC<AssistantLauncherProps> = ({
  onOpenSettings, configured, hidden = false,
}) => {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);

  // Rendered only when needed, so it cannot overlap anything in split view.
  if (hidden) return null;

  return (
    <button
      onClick={() => {
        if (!configured) {
          onOpenSettings();
          return;
        }
        setOpen(!open);
      }}
      title={configured ? 'Ask the assistant' : 'Configure an AI provider in Settings first'}
      aria-label={configured ? 'Open AI assistant' : 'Configure AI provider in Settings'}
      className={`fixed bottom-20 right-4 sm:bottom-6 sm:right-6 ${Z.nav} w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center transition-all hover:scale-105 ${
        configured ? 'bg-accent hover:bg-accent-hover text-white' : 'bg-bg-elevated border border-dashed border-border-strong text-content-tertiary'
      }`}
    >
      <Sparkles className="w-6 h-6" />
      {!configured && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-bg-surface" />
      )}
    </button>
  );
};
