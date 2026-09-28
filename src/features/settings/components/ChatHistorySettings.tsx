import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { clearAllHistory } from '../../../features/ai/chatRepo';
import { useAssistantStore } from '../../../stores/useAssistantStore';

/**
 * Chat history lives in IndexedDB like the rest of the app, so it is included
 * in the export/import backup. This control is the explicit "forget everything"
 * escape hatch.
 */
export const ChatHistorySettings: React.FC = () => {
  const loadSessions = useAssistantStore((s) => s.loadSessions);
  const newSession = useAssistantStore((s) => s.newSession);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await clearAllHistory();
      await newSession();
      await loadSessions();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Assistant Chat History"
      subtitle="Conversations are stored locally in this browser and included in backups"
    >
      {confirming ? (
        <div className="space-y-3">
          <p className="text-xs text-content-secondary">
            This permanently deletes every assistant conversation on this device. It cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void wipe()}
              disabled={busy}
              className="px-3 min-h-[44px] rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Yes, delete all chat history'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-3 min-h-[44px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-2 px-3 min-h-[44px] rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 text-xs font-semibold transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Clear all history
        </button>
      )}
    </Card>
  );
};
