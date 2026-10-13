import React from 'react';
import { useAssistantStore } from '../../../stores/useAssistantStore';

export type AssistantLayout = 'bubble' | 'fullscreen' | 'split';

interface AssistantSurfaceProps {
  layout: AssistantLayout;
}

/**
 * One shared assistant component, rendered by every surface.
 *
 * A placeholder for now: it shows which layout is active and how many messages
 * are in the current conversation. The real command bar, reader, history
 * drawer and autoscroll replace this body later, but the three surfaces all
 * mount THIS component so the conversation is shared rather than duplicated.
 */
export const AssistantSurface: React.FC<AssistantSurfaceProps> = ({ layout }) => {
  const view = useAssistantStore((s) => s.view);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-content-primary p-4">
      <p className="text-sm font-semibold text-content-primary">Assistant panel</p>
      <p className="text-xs text-content-tertiary">
        Layout: <span className="text-content-secondary">{layout}</span> · Messages: {view.length}
      </p>
    </div>
  );
};