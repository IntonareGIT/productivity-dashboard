import React from 'react';
import { Card } from '../../../components/ui/Card';
import { useFloatingAiStore } from '../../../stores/useFloatingAiStore';

/**
 * "Show floating AI button".
 *
 * One switch for both modes, on purpose. The button now appears in split view
 * as well as standalone, and a single control is the only thing that can honour
 * "covering both modes" without the two drifting apart: two toggles would invite
 * the state where split is off and standalone is on, which is exactly the kind
 * of half-state that makes a support question unanswerable.
 *
 * Turning it off hides the button everywhere. It does not close a conversation
 * that is already running in a pane.
 */
export const FloatingAiSettings: React.FC = () => {
  const enabled = useFloatingAiStore((s) => s.enabled);
  const setEnabled = useFloatingAiStore((s) => s.setEnabled);

  return (
    <Card title="Floating AI button" subtitle="The small button that opens the assistant without using a pane">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 w-4 h-4 accent-[var(--accent-primary)]"
        />
        <span>
          <span className="block text-sm font-medium text-content-primary">Show floating AI button</span>
          <span className="block text-xs text-content-tertiary mt-0.5">
            Docks to a screen edge and can be dragged anywhere along the edges. Hide it to
            reach the assistant only from a pane.
          </span>
        </span>
      </label>
    </Card>
  );
};