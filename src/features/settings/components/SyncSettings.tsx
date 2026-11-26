import React from 'react';
import { UNSYNCED_TABLES } from '../../../db/cloudConfig';
import { SyncAccountPanel, SyncStoragePanel } from './SyncAccountPanel';

/**
 * Settings → Sync.
 *
 * Thin wrapper over the shared `SyncAccountPanel`, so the top-bar profile menu
 * and this page read exactly the same account state (one `useCloudAccount()`
 * subscription, no duplicated logic or sign-out rules). Diagnostics stay here.
 */
export const SyncSettings: React.FC = () => (
  <div className="space-y-4">
    <SyncAccountPanel variant="card" showDiagnostics>
      {UNSYNCED_TABLES.length > 0 ? (
        <p className="text-[11px] text-content-tertiary">
          Never synced (kept per-device): {UNSYNCED_TABLES.join(', ')}.
        </p>
      ) : (
        <p className="text-[11px] text-content-tertiary">
          Everything syncs, including your AI providers. The assistant signs each chat request
          with your Dexie Cloud session — no API keys are stored in the app.
        </p>
      )}
    </SyncAccountPanel>

    <SyncStoragePanel />
  </div>
);
