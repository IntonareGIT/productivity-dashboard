import React, { useEffect, useState } from 'react';
import { Card } from '../../../components/ui/Card';
import { useAssistantStore } from '../../../stores/useAssistantStore';

const STORAGE_KEY = 'assistantRedesignEnabled';

/**
 * Assistant redesign toggle.
 *
 * Reads/writes the `assistantRedesignEnabled` flag in localStorage (device-level,
 * not synced). The URL parameter `?assistantRedesign=1` overrides localStorage
 * for the current session.
 */
export const AssistantRedesignSettings: React.FC = () => {
  const assistantRedesign = useAssistantStore((s) => s.assistantRedesign);
  const setAssistantRedesign = useAssistantStore((s) => s.setAssistantRedesign);
  const [localValue, setLocalValue] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('assistantRedesignEnabled') === 'true';
  });
  const [urlOverride, setUrlOverride] = useState(false);

  // Sync localStorage with store on mount and when localValue changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlHasParam = new URLSearchParams(window.location.search).get('assistantRedesign') === '1';
    setUrlOverride(urlHasParam);
  }, []);

  // When localValue changes (user clicks toggle), update store and localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAssistantRedesign(localValue);
    localStorage.setItem('assistantRedesignEnabled', String(localValue));
  }, [localValue, setAssistantRedesign]);

  // Initialize from localStorage on first render
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('assistantRedesignEnabled') === 'true';
    setLocalValue(stored);
  }, []);

  return (
    <Card title="Assistant redesign (preview)" subtitle="Turns on the new assistant layout on this device. Turn it off to go back to the classic assistant.">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={localValue}
          onChange={(e) => setLocalValue(e.target.checked)}
          className="mt-1 w-4 h-4 accent-[var(--accent-primary)]"
        />
        <span>
          <span className="block text-sm font-medium text-content-primary">Assistant redesign (preview)</span>
          <span className="block text-xs text-content-tertiary mt-0.5">
            Turns on the new assistant layout on this device. Turn it off to go back to the classic assistant.
          </span>
          {localValue && (
            <span className="block text-xs text-accent mt-0.5">✓ Enabled</span>
          )}
        </span>
      </label>
      {localValue && (
        <div className="mt-3 text-xs text-content-tertiary">
          {new URLSearchParams(window.location.search).get('assistantRedesign') === '1' ? (
            <span>On for this link only (URL parameter).</span>
          ) : (
            <span>Saved to this device. Remove <code>?assistantRedesign=1</code> from the URL to use the saved setting.</span>
          )}
        </div>
      )}
    </Card>
  );
};