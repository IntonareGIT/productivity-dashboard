import React from 'react';
import { useAssistantStore } from '../../../stores/useAssistantStore';

export type AssistantLayout = 'bubble' | 'fullscreen' | 'split';

interface AssistantSurfaceProps {
  layout: AssistantLayout;
}

/**
 * One shared assistant component, rendered by every surface when the
 * `assistantRedesign` flag is on.
 *
 * For now it shows the layout name and message count. The real command bar,
 * reader, history drawer and autoscroll will replace this body in the next step.
 */
export const AssistantSurface: React.FC<AssistantSurfaceProps> = ({ layout }) => {
  const view = useAssistantStore((s) => s.view);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-content-primary p-4">
      <p className="text-sm font-semibold text-content-primary">Assistant surface</p>
      <p className="text-xs text-content-tertiary">
        Layout: <span className="text-content-secondary">{layout}</span> · Messages: {view.length}
      </p>
    </div>
  );
};